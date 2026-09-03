'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2, RadioTower, ShieldCheck, Upload, RefreshCw, CircleDot } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { hmacSha256Hex, sha256Hex } from '@/lib/sysConfig';
// [P1-3 REMEDIATION 2026-09] session-scoped admin token prefill.
import { getAdminToken } from '@/lib/adminTokenSession';
import { useSysConfig } from '@/components/providers/sys-config-provider';

interface OtaManifest {
  version: string;
  url: string;
  sha256: string;
  hmac: string;
  size?: number;
  target?: string;
  published_at?: string;
}

async function callGasAction<T = unknown>(
  gasUrl: string,
  payload: Record<string, unknown>,
  timeoutMs = 15000
): Promise<{ ok: boolean; body: T | null; message: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(gasUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      signal: controller.signal,
      redirect: 'follow',
    });
    clearTimeout(timer);
    if (!res.ok) return { ok: false, body: null, message: `HTTP ${res.status}` };
    const body = (await res.json().catch(() => null)) as { status?: string; message?: string; data?: T } | null;
    if (!body) return { ok: false, body: null, message: 'Respons GAS bukan JSON.' };
    const ok = body.status === 'SUCCESS';
    return { ok, body: (body.data ?? null) as T, message: body.message || (ok ? 'OK' : 'ERROR') };
  } catch (err) {
    clearTimeout(timer);
    return { ok: false, body: null, message: (err as Error).message };
  }
}

export function OtaSigningPanel() {
  const { config } = useSysConfig();
  const [current, setCurrent] = useState<OtaManifest | null>(null);
  const [loading, setLoading] = useState(false);
  const [publishing, setPublishing] = useState(false);

  // [WAVE-3 / GAS-2-K] Admin token operator — sengaja TIDAK dipersist ke
  // localStorage: hanya dipegang di memori sesi ini (publish OTA adalah
  // aksi langka; meminta ulang lebih aman daripada menyimpan secret yang
  // mengungguli semua device di fleet).
  // [P1-3 REMEDIATION 2026-09] di-inisialisasi dari session store — jika
  // operator sudah memasukkan token sesi ini di halaman Setup/Kontrol
  // Darurat, panel OTA terisi otomatis (kualitas hidup) tanpa pernah
  // menyimpannya permanen di browser.
  const [adminToken, setAdminToken] = useState(
    () => getAdminToken(config?.active_device_id ?? config?.device_id ?? '') ?? ''
  );

  const [version, setVersion] = useState('1.0.1');
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  // [W13-2] Manifest target — firmware tree discrimination for mixed fleets.
  // '' = fleet-wide (pre-W13 behavior); 'generic' / 'modular' = only devices
  // whose DEVICES!firmware_type matches will be offered the image (the device
  // self-checks the echoed target too — defense in depth).
  const [target, setTarget] = useState('');
  // [AUDIT 2026-08-28 G7] Hash disimpan BERSAMA referensi file yang
  // di-hash-nya; `computedSha`/`computedSize` di-derive saat render dan hanya
  // valid selama file itu masih terpilih. Menutup hazard: pengguna memilih
  // file B saat hash file A masih tampil → publish url-B dengan sha-A
  // (firmware menolak, tapi UI-nya menyesatkan operator).
  const [hashResult, setHashResult] = useState<{ file: File; sha: string; size: number } | null>(null);
  const computedSha = hashResult?.file === file && file != null ? hashResult.sha : null;
  const computedSize = hashResult?.file === file && file != null ? hashResult.size : null;

  const canPublish = useMemo(
    () => Boolean(config) && version.trim().length > 0 && url.startsWith('http') && computedSha && adminToken.trim().length > 0,
    [config, version, url, computedSha, adminToken]
  );

  const refreshManifest = async () => {
    if (!config) return;
    setLoading(true);
    const res = await callGasAction<OtaManifest>(config.gas_webapp_url, {
      action: 'OTA_MANIFEST',
      token: config.auth_token,
    });
    setLoading(false);
    if (!res.ok) {
      setCurrent(null);
      return;
    }
    setCurrent(res.body);
  };

  useEffect(() => {
    if (!config) return;
    // [G6] Kickoff ditunda satu macrotask — setState di refreshManifest
    // tidak sinkron-reachable dari badan effect (set-state-in-effect).
    const kickoff = window.setTimeout(() => void refreshManifest(), 0);
    return () => window.clearTimeout(kickoff);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.gas_webapp_url, config?.auth_token]);

  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    (async () => {
      const buf = await file.arrayBuffer();
      const hash = await sha256Hex(buf);
      if (!cancelled) setHashResult({ file, sha: hash, size: buf.byteLength });
    })();
    return () => {
      cancelled = true;
    };
  }, [file]);

  const publish = async () => {
    if (!config || !canPublish || !computedSha) return;
    setPublishing(true);
    const message = `${version.trim()}|${url.trim()}|${computedSha}`;
    const hmac = await hmacSha256Hex(config.auth_token, message);
    const res = await callGasAction(config.gas_webapp_url, {
      action: 'OTA_PUBLISH',
      token: config.auth_token,
      // [WAVE-3 / GAS-2-K] Gerbang admin: kredensial device/token biasa
      // TIDAK cukup untuk mendorong firmware ke seluruh fleet.
      admin_token: adminToken.trim(),
      manifest: {
        version: version.trim(),
        url: url.trim(),
        sha256: computedSha,
        hmac,
        size: computedSize,
        target: target.trim(),
      },
    });
    setPublishing(false);
    if (res.ok) {
      toast.success('Manifest OTA dipublish. Perangkat akan meng-update saat polling berikutnya.');
      void refreshManifest();
    } else {
      toast.error(`Gagal publish: ${res.message}`);
    }
  };

  if (!config) return null;

  return (
    <Card data-testid="ota-signing-panel">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4" /> Signed OTA — Publish Firmware
        </CardTitle>
        <CardDescription>
          Upload firmware <code>.bin</code>, lalu PWA menghitung <code>SHA-256</code> dan
          menandatanganinya dengan <code>HMAC-SHA256(AUTH_TOKEN)</code>. ESP32 akan menolak
          artefak yang HMAC-nya tidak cocok. Sejak backend Gel-3, publish juga memerlukan
          <code> ADMIN_TOKEN</code> (baris di sheet Config) — kredensial device tidak
          pernah cukup untuk mendorong firmware ke fleet.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-md border border-border p-3 text-sm space-y-1">
          <div className="flex items-center justify-between">
            <span className="font-medium flex items-center gap-1.5">
              <RadioTower className="w-3.5 h-3.5" /> Manifest aktif
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void refreshManifest()}
              disabled={loading}
              data-testid="ota-refresh"
            >
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            </Button>
          </div>
          {current ? (
            <div className="text-xs text-muted-foreground grid grid-cols-1 gap-1 mt-2">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="font-mono">v{current.version}</Badge>
                <span className="truncate">{current.published_at ?? '—'}</span>
              </div>
              <p className="truncate font-mono">{current.url}</p>
              <p className="truncate font-mono">
                <CircleDot className="w-3 h-3 inline mr-1" /> sha256: {current.sha256}
              </p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground mt-2">
              Belum ada manifest terpublish untuk device ini.
            </p>
          )}
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ota-version">Versi Baru</Label>
              <Input
                id="ota-version"
                placeholder="1.0.1"
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                data-testid="ota-input-version"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ota-url">URL Firmware .bin (publik / signed)</Label>
              <Input
                id="ota-url"
                placeholder="https://storage.googleapis.com/.../plts_firmware_v1.0.1.bin"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                data-testid="ota-input-url"
              />
            </div>
          </div>

          <div>
            <Label htmlFor="ota-file" className="flex items-center gap-1.5">
              <Upload className="w-3.5 h-3.5" /> File <code>.bin</code> (untuk hashing lokal)
            </Label>
            <Input
              id="ota-file"
              type="file"
              accept=".bin,application/octet-stream"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="mt-1.5"
              data-testid="ota-input-file"
            />
            {computedSha && (
              <div className="text-[11px] text-muted-foreground mt-2 font-mono break-all">
                sha256: {computedSha}
                <br />
                size: {computedSize} bytes
              </div>
            )}
          </div>

          {/* [W13-2] Target firmware tree */}
          <div className="space-y-1.5">
            <Label htmlFor="ota-target">Target Armada (firmware tree)</Label>
            <select
              id="ota-target"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              data-testid="ota-input-target"
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="">Semua armada (fleet-wide — perilaku lama)</option>
              <option value="generic">generic (flat, GAS manifest + HMAC)</option>
              <option value="modular">modular (nested, MQTT/REST + Ed25519)</option>
            </select>
            <p className="text-[11px] text-muted-foreground">
              Manifest bertarget hanya ditawarkan ke perangkat yang kolom{' '}
              <code>firmware_type</code> di sheet Devices sesuai (perangkat yang
              belum dideklarasikan hanya menerima manifest fleet-wide).
              Perangkat juga menolak target yang tidak cocok (REFUSED).
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ota-admin-token">Admin Token (baris ADMIN_TOKEN di sheet Config)</Label>
            <Input
              id="ota-admin-token"
              type="password"
              placeholder="secret operator — tidak disimpan di browser"
              value={adminToken}
              autoComplete="off"
              onChange={(e) => setAdminToken(e.target.value)}
              data-testid="ota-input-admin-token"
            />
            <p className="text-[11px] text-muted-foreground">
              Hanya dipegang di memori sesi ini. Kosong di sheet Config = publish OTA
              dinonaktifkan total (fail-closed) oleh backend.
            </p>
          </div>

          <Alert>
            <ShieldCheck className="w-4 h-4" />
            <AlertTitle>Skema tanda tangan</AlertTitle>
            <AlertDescription className="text-xs">
              <code>hmac = HMAC-SHA256(AUTH_TOKEN, &quot;{version}|{url || 'https://...'}|&lt;sha256&gt;&quot;)</code>
              <br />
              ESP32 memverifikasi HMAC + SHA-256 sebelum menulis image ke partisi OTA.
            </AlertDescription>
          </Alert>

          <div className="flex justify-end">
            <Button
              onClick={publish}
              disabled={!canPublish || publishing}
              data-testid="ota-publish-btn"
            >
              {publishing ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Publishing...
                </>
              ) : (
                <>
                  <RadioTower className="w-4 h-4 mr-2" /> Publish Signed Manifest
                </>
              )}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
