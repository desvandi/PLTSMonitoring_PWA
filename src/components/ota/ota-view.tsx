'use client';

// =============================================================================
// OTA Update View — firmware upload + check + history (brief §72, §67)
// -----------------------------------------------------------------------------
// Disciplines (canonical contract §3.13 + brief §72):
//   - SHA-256 streaming verify (ESP32 can't buffer full binary in RAM)
//   - Ed25519 signature verification (PRODUCTION_BUILD fail-closed if empty key)
//   - Anti-downgrade: strict SemVer > current
//   - URL allowlist for HTTPS OTA (MQTT-driven path)
//   - Boot health check + auto-rollback (3 failed boots → revert)
//   - Two-step: upload → verify → apply → reboot → mark healthy
//
// This view exposes:
//   1. Upload binary (.bin) — REST multipart upload, streaming SHA-256
//   2. Check for updates — queries GitHub releases (manifest URL)
//   3. History — last N OTA operations with status + duration
//   4. Power warning — operator MUST ensure stable power during update
// =============================================================================

import { useState, useRef } from 'react';
import { api } from '@/lib/api';
import { readSysConfig } from '@/lib/sysConfig';
import { getCanonicalRelease, type CanonicalRelease } from '@/lib/release-identity';
import { useLanguage } from '@/components/providers/language-provider';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Upload, CheckCircle2, Download, AlertTriangle, History, Shield,
} from 'lucide-react';
import { formatDateTime, formatRelativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { OtaHistoryEntry, FirmwareInfo } from '@/lib/types';

const OTA_STATUS_STYLE: Record<FirmwareInfo['otaStatus'], { color: string; label: string }> = {
  'up-to-date': { color: 'text-status-on border-status-on/30', label: 'Up to date' },
  'update-available': { color: 'text-status-info border-status-info/30', label: 'Update available' },
  'uploading': { color: 'text-status-info border-status-info/30', label: 'Uploading…' },
  'verifying': { color: 'text-status-warn border-status-warn/30', label: 'Verifying signature…' },
  'installing': { color: 'text-status-warn border-status-warn/30', label: 'Installing…' },
  'failed': { color: 'text-status-error border-status-error/30', label: 'Failed' },
  'rollback': { color: 'text-status-warn border-status-warn/30', label: 'Rolled back' },
  'unknown': { color: 'text-muted-foreground border-border/50', label: 'Unknown' },
};

// [W13-3] GAS OTA_LOG — real device-reported OTA events. The OtaEvents sheet
// has been written by firmware-generic since WAVE-6 (ACTIVATED / ROLLBACK /
// DOWNLOAD_FAILED / REFUSED); OTA_LOG is the new read action. Falls back to
// the local mock when GAS is unconfigured or unreachable — the panel must
// never hard-fail on an offline backend.
interface GasOtaEvent {
  timestamp: string;
  event: string;
  version: string;
  message: string;
}

async function fetchGasOtaHistory(deviceId: string): Promise<OtaHistoryEntry[] | null> {
  const config = readSysConfig();
  if (!config?.gas_webapp_url || !config.auth_token) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(config.gas_webapp_url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'OTA_LOG',
        token: config.auth_token,
        device_key: deviceId || config.device_id,
        limit: 50,
      }),
      signal: controller.signal,
      redirect: 'follow',
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const body = (await res.json().catch(() => null)) as
      | { status?: string; data?: { events?: GasOtaEvent[] } }
      | null;
    if (!body || body.status !== 'SUCCESS' || !Array.isArray(body.data?.events)) {
      return null;
    }
    return body.data.events.map((e, i): OtaHistoryEntry => ({
      id: i,
      timestamp: Date.parse(e.timestamp) || Date.now(),
      fromVersion: '',
      toVersion: e.version ?? '',
      status:
        e.event === 'ACTIVATED'
          ? 'success'
          : e.event === 'ROLLBACK'
            ? 'rollback'
            : 'failed',
      durationSeconds: 0,
      event: e.event,
      message: e.message,
    }));
  } catch {
    clearTimeout(timer);
    return null;
  }
}

export function OtaView() {
  const { t, lang } = useLanguage();
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [canonicalRelease, setCanonicalRelease] = useState<CanonicalRelease | null>(null);
  const [canonicalLoading, setCanonicalLoading] = useState(false);
  const [canonicalError, setCanonicalError] = useState<string | null>(null);
  const [pushingCanonical, setPushingCanonical] = useState(false);
  const [pushProgress, setPushProgress] = useState<number | null>(null);
  const [pushStatus, setPushStatus] = useState<string | null>(null);

  // Fetch canonical release identity from GitHub Releases API
  const fetchCanonicalRelease = async () => {
    setCanonicalLoading(true);
    setCanonicalError(null);
    try {
      const rel = await getCanonicalRelease();
      if (!rel) {
        setCanonicalError('Could not fetch canonical release from GitHub');
      } else {
        setCanonicalRelease(rel);
      }
    } catch (e) {
      setCanonicalError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setCanonicalLoading(false);
    }
  };

  // [Audit 2026-09-04] Push canonical release to device:
  // 1. Fetch canonical release identity (version, SHA, release URL)
  // 2. Download modular-firmware.bin from GitHub Release
  // 3. Download modular-firmware.bin.sig (Ed25519 hex signature)
  // 4. Compute SHA-256 client-side, verify against canonical release
  // 5. Upload to device with X-Expected-SHA256 + X-Signature + X-Firmware-Version
  const handlePushCanonical = async () => {
    if (!canonicalRelease) {
      toast.error('Canonical release not loaded');
      return;
    }
    setPushingCanonical(true);
    setPushProgress(0);
    setPushStatus('Downloading firmware from GitHub Release…');
    try {
      // 1. Download firmware binary
      const binUrl = canonicalRelease.releaseUrl.replace(
        '/releases/tag/',
        '/releases/download/',
      ) + '/modular-firmware.bin';
      const binResp = await fetch(binUrl);
      if (!binResp.ok) throw new Error(`Download failed: HTTP ${binResp.status}`);
      const binBlob = await binResp.blob();

      // 2. Download Ed25519 signature (hex text, 128 chars)
      const sigUrl = canonicalRelease.releaseUrl.replace(
        '/releases/tag/',
        '/releases/download/',
      ) + '/modular-firmware.bin.sig';
      const sigResp = await fetch(sigUrl);
      if (!sigResp.ok) throw new Error(`Signature download failed: HTTP ${sigResp.status}`);
      const signature = (await sigResp.text()).trim();

      // 3. Compute SHA-256 client-side
      setPushStatus('Computing SHA-256…');
      const arrayBuf = await binBlob.arrayBuffer();
      const hashBuf = await crypto.subtle.digest('SHA-256', arrayBuf);
      const hashHex = Array.from(new Uint8Array(hashBuf))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

      // 4. Verify SHA matches canonical release
      if (hashHex !== canonicalRelease.firmwareSha256) {
        throw new Error(
          `SHA-256 mismatch: computed ${hashHex.slice(0, 16)}… != expected ${canonicalRelease.firmwareSha256.slice(0, 16)}…`,
        );
      }

      // 5. Upload to device with production OTA headers
      setPushStatus(`Uploading v${canonicalRelease.version} to device…`);
      const file = new File([binBlob], 'modular-firmware.bin', { type: 'application/octet-stream' });
      const result = await api.otaUpload(file, (pct) => setPushProgress(pct), {
        sha256: hashHex,
        signature,
        version: canonicalRelease.version,
      });

      toast.success(`OTA complete: device now running v${result.newVersion ?? canonicalRelease.version}`);
      qc.invalidateQueries({ queryKey: ['version'] });
      qc.invalidateQueries({ queryKey: ['ota-history'] });
      setPushStatus(`Device updated to v${result.newVersion ?? canonicalRelease.version}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      toast.error(`Canonical OTA failed: ${msg}`);
      setPushStatus(`Failed: ${msg}`);
    } finally {
      setPushingCanonical(false);
      setPushProgress(null);
    }
  };

  // Fetch version info (live)
  const { data: versionData, isLoading: versionLoading } = useQuery({
    queryKey: ['version'],
    queryFn: () => api.version(),
    staleTime: 60_000,
  });

  // Fetch OTA history — [W13-3] real GAS OTA_LOG first (device-reported
  // lifecycle events), mock fallback when GAS is unconfigured/unreachable.
  const { data: historyData, isLoading: historyLoading } = useQuery({
    queryKey: ['ota-history'],
    queryFn: async (): Promise<{ entries: OtaHistoryEntry[] }> => {
      const config = readSysConfig();
      const deviceId = config?.active_device_id ?? config?.device_id ?? '';
      const gasEntries = await fetchGasOtaHistory(deviceId);
      if (gasEntries) return { entries: gasEntries };
      return api.otaHistory();
    },
    staleTime: 30_000,
  });

  const version: FirmwareInfo | undefined = versionData; // already unwrapped
  const history: OtaHistoryEntry[] = historyData?.entries ?? [];
  const otaStatus = OTA_STATUS_STYLE[version?.otaStatus ?? 'unknown'];

  const handleCheck = async () => {
    try {
      const r = await api.otaCheck();
      if (r.available) {
        toast.success(`Update available: ${r.latestVersion}`);
      } else {
        toast.info('Firmware is up to date');
      }
      qc.invalidateQueries({ queryKey: ['version'] });
    } catch (e) {
      toast.error(`Check failed: ${e instanceof Error ? e.message : 'unknown'}`);
    }
  };

  const handleFile = async (file: File) => {
    if (!file.name.endsWith('.bin')) {
      toast.error('Please select a .bin firmware file');
      return;
    }
    if (file.size > 1.5 * 1024 * 1024) {
      toast.error('Firmware too large (max 1.5 MB)');
      return;
    }
    setUploading(true);
    setUploadProgress(0);
    try {
      const r = await api.otaUpload(file, (pct) => setUploadProgress(pct));
      toast.success(`OTA upload complete: v${r.newVersion ?? '?'}`);
      qc.invalidateQueries({ queryKey: ['version'] });
      qc.invalidateQueries({ queryKey: ['ota-history'] });
    } catch (e) {
      toast.error(`OTA failed: ${e instanceof Error ? e.message : 'unknown'}`);
    } finally {
      setUploading(false);
      setUploadProgress(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  if (versionLoading || historyLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-12 w-64" />
        <Skeleton className="h-16 rounded-xl" />
        <Skeleton className="h-32 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Download className="w-6 h-6 text-primary" />
          {t('ota.title')}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">{t('ota.subtitle')}</p>
      </div>

      {/* Power warning */}
      <Alert className="border-status-warn/40 bg-status-warn/5">
        <AlertTriangle className="w-4 h-4 text-status-warn" />
        <AlertDescription className="text-xs text-status-warn">
          {t('ota.warning_stable_power')}
        </AlertDescription>
      </Alert>

      {/* Current version + status strip */}
      <Card className="border-border/60">
        <CardContent className="p-3 grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
              {t('ota.current_version')}
            </div>
            <div className="text-base font-mono font-semibold">
              {version?.currentVersion ?? '—'}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
              {t('ota.latest_version')}
            </div>
            <div className="text-base font-mono font-semibold">
              {version?.latestAvailable ?? '—'}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
              {t('ota.update_available')}
            </div>
            <Badge variant="outline" className={cn('text-[9px] px-1.5 h-4', otaStatus.color)}>
              {otaStatus.label}
            </Badge>
          </div>
          <div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
              {t('ota.signature_verified')}
            </div>
            <div className="flex items-center gap-1">
              <Shield
                className={cn(
                  'w-3.5 h-3.5',
                  version?.signatureVerified === true
                    ? 'text-status-on'
                    : version?.signatureVerified === false
                      ? 'text-status-error'
                      : 'text-muted-foreground',
                )}
              />
              <span className="text-xs font-mono">
                {version?.signatureVerified === true
                  ? 'verified'
                  : version?.signatureVerified === false
                    ? 'FAILED'
                    : '—'}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Upload binary */}
        <Card className="border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Upload className="w-4 h-4 text-primary" />
              {t('ota.upload_binary')}
            </CardTitle>
            <CardDescription className="text-xs">
              Stream upload .bin firmware to ESP32. SHA-256 verified on-the-fly.
              Ed25519 signature checked in PRODUCTION_BUILD (fail-closed).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <input
              ref={fileInputRef}
              type="file" accept=".bin" className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
            <Button
              variant="default" size="sm"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="w-3 h-3 mr-1" />
              {uploading ? t('ota.uploading') : t('ota.upload_binary')}
            </Button>
            {uploadProgress != null && (
              <div className="space-y-1">
                <Progress value={uploadProgress} className="h-2" />
                <p className="text-[10px] text-muted-foreground text-center">
                  {uploadProgress}%
                </p>
              </div>
            )}
            {uploading && (
              <p className="text-[10px] text-muted-foreground">
                {t('ota.verifying')} (this can take 30–60s)
              </p>
            )}
          </CardContent>
        </Card>

        {/* Check for updates */}
        <Card className="border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-primary" />
              {t('ota.check_update')}
            </CardTitle>
            <CardDescription className="text-xs">
              Query the release manifest for a newer SemVer. Anti-downgrade enforced.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" size="sm" onClick={handleCheck}>
              <CheckCircle2 className="w-3 h-3 mr-1" />
              {t('ota.check_update')}
            </Button>
            {version?.updateAvailable && (
              <p className="text-xs text-status-info mt-2">
                Update available: v{version.latestAvailable}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Push Canonical Release — production OTA flow */}
      {/* [Audit 2026-09-04] This card implements the production OTA path:
          fetch canonical release → download binary + sig → verify SHA →
          upload with X-Expected-SHA256/X-Signature/X-Firmware-Version headers.
          The manual upload card above is for development; this card is for
          fleet OTA from the immutable GitHub Release. */}
      <Card className="border-primary/30 bg-primary/5">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Shield className="w-4 h-4 text-primary" />
            Push Canonical Release (Production OTA)
          </CardTitle>
          <CardDescription className="text-xs">
            Fetches the latest signed firmware from the GitHub Release, verifies
            SHA-256 client-side, and pushes to the device with Ed25519 signature
            headers. This is the production OTA path — the device verifies both
            SHA-256 and Ed25519 signature before flashing.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {!canonicalRelease && !canonicalLoading && !canonicalError && (
            <Button variant="default" size="sm" onClick={fetchCanonicalRelease}>
              <Download className="w-3 h-3 mr-1" />
              Fetch Latest Release
            </Button>
          )}
          {canonicalLoading && (
            <p className="text-xs text-muted-foreground">Fetching release info…</p>
          )}
          {canonicalError && (
            <div className="space-y-2">
              <p className="text-xs text-status-error">{canonicalError}</p>
              <Button variant="outline" size="sm" onClick={fetchCanonicalRelease}>
                Retry
              </Button>
            </div>
          )}
          {canonicalRelease && (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-muted-foreground">Version:</span>{' '}
                  <span className="font-mono font-semibold">v{canonicalRelease.version}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Build:</span>{' '}
                  <span className="font-mono text-[10px]">{canonicalRelease.releaseId}</span>
                </div>
                <div className="col-span-2">
                  <span className="text-muted-foreground">SHA-256:</span>{' '}
                  <span className="font-mono text-[10px] break-all">
                    {canonicalRelease.firmwareSha256.slice(0, 32)}…
                  </span>
                </div>
                <div className="col-span-2">
                  <span className="text-muted-foreground">Git commit:</span>{' '}
                  <span className="font-mono text-[10px]">
                    {canonicalRelease.gitCommit.slice(0, 12)}
                  </span>
                </div>
              </div>
              <Button
                variant="default"
                size="sm"
                disabled={pushingCanonical || uploading}
                onClick={handlePushCanonical}
              >
                <Upload className="w-3 h-3 mr-1" />
                {pushingCanonical ? 'Pushing…' : `Push v${canonicalRelease.version} to Device`}
              </Button>
              {pushProgress != null && (
                <div className="space-y-1">
                  <Progress value={pushProgress} className="h-2" />
                  <p className="text-[10px] text-muted-foreground text-center">{pushProgress}%</p>
                </div>
              )}
              {pushStatus && (
                <p className="text-[10px] text-muted-foreground">{pushStatus}</p>
              )}
              <p className="text-[10px] text-muted-foreground">
                Release URL:{' '}
                <a
                  href={canonicalRelease.releaseUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  {canonicalRelease.releaseUrl}
                </a>
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* History table */}
      <Card className="border-border/60">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <History className="w-4 h-4 text-primary" />
            {t('ota.history')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground text-sm">
              No OTA operations recorded yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>From</TableHead>
                    <TableHead>To</TableHead>
                    <TableHead className="text-center">Status</TableHead>
                    <TableHead className="text-right">Duration</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.map((h) => (
                    <TableRow key={h.id}>
                      <TableCell className="font-mono text-xs">
                        {formatRelativeTime(h.timestamp, lang)}
                        <div className="text-[10px] text-muted-foreground">
                          {formatDateTime(h.timestamp)}
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{h.fromVersion}</TableCell>
                      <TableCell className="font-mono text-xs">{h.toVersion}</TableCell>
                      <TableCell className="text-center">
                        <Badge
                          variant="outline"
                          className={cn(
                            'text-[9px] px-1.5 h-4',
                            h.status === 'success'
                              ? 'border-status-on/30 text-status-on'
                              : h.status === 'failed'
                                ? 'border-status-error/30 text-status-error'
                                : 'border-status-warn/30 text-status-warn',
                          )}
                          title={h.message}
                        >
                          {/* [W13-3] prefer the raw device event verb (GAS source);
                              fall back to the coarse mock status word */}
                          {h.event ?? h.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {h.durationSeconds.toFixed(1)}s
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
