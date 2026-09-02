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

export function OtaView() {
  const { t, lang } = useLanguage();
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);

  // Fetch version info (live)
  const { data: versionData, isLoading: versionLoading } = useQuery({
    queryKey: ['version'],
    queryFn: () => api.version(),
    staleTime: 60_000,
  });

  // Fetch OTA history
  const { data: historyData, isLoading: historyLoading } = useQuery({
    queryKey: ['ota-history'],
    queryFn: () => api.otaHistory(),
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
                        >
                          {h.status}
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
