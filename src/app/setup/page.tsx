'use client';

import { useState, useMemo, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CheckCircle2, XCircle, Loader2, Zap, Upload, Save, Timer, KeyRound, Link as LinkIcon, Cpu, Tag, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import {
  DEFAULT_DASHBOARD_SETTINGS,
  HandshakeResult,
  PltsSysConfig,
  pingGasEndpoint,
  validateSysConfig,
} from '@/lib/sysConfig';
import { useSysConfig } from '@/components/providers/sys-config-provider';
import { QrScannerButton } from '@/components/setup/qr-scanner-button';

type HandshakeStatus = 'idle' | 'testing' | 'success' | 'failed';

function SetupPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isAddMode = searchParams.get('mode') === 'add-device';
  const { config, ready, save, addDevice, updateActive } = useSysConfig();

  // [AUDIT 2026-08-28 F3] 'ready' gate: during SSR/hydration the config
  // snapshot is intentionally null (getServerSnapshot) — initializing the
  // form states from it would lock EMPTY values on a hard load even when a
  // config exists. Wait for the client store before first render, mirroring
  // the ConfigGuard pattern.
  const source = isAddMode ? null : config;

  const [gasUrl, setGasUrl] = useState(source?.gas_webapp_url ?? '');
  const [authToken, setAuthToken] = useState(source?.auth_token ?? '');
  // v1.7.0 [E-WAVE] — operator-only secret (GAS Config sheet ADMIN_TOKEN).
  // Optional: gates ARM/DISARM/CONFIG emergency commands. Empty → disabled.
  const [adminToken, setAdminToken] = useState(
    source?.devices.find((d) => d.device_id === source?.active_device_id)?.admin_token ?? ''
  );
  const [deviceId, setDeviceId] = useState(source?.device_id ?? 'PLTS_MONITOR_01');
  const [label, setLabel] = useState(
    source?.devices.find((d) => d.device_id === source?.active_device_id)?.label ?? ''
  );
  const [refreshSec, setRefreshSec] = useState(
    source?.dashboard_settings.telemetry_refresh_interval_sec ?? DEFAULT_DASHBOARD_SETTINGS.telemetry_refresh_interval_sec
  );
  const [nominalV, setNominalV] = useState(
    source?.dashboard_settings.battery_nominal_voltage ?? DEFAULT_DASHBOARD_SETTINGS.battery_nominal_voltage
  );
  const [capacityAh, setCapacityAh] = useState(
    source?.dashboard_settings.battery_capacity_ah ?? DEFAULT_DASHBOARD_SETTINGS.battery_capacity_ah
  );
  // [AUDIT 2026-08-28 F2] read from `source` (not `config`) so add-device
  // mode starts from the SAME defaults as every other preference field —
  // previously these two leaked the active device's values.
  const [lowV, setLowV] = useState(
    source?.dashboard_settings.low_battery_warning_threshold ?? DEFAULT_DASHBOARD_SETTINGS.low_battery_warning_threshold
  );
  const [audio, setAudio] = useState(
    source?.dashboard_settings.enable_audio_alarm ?? DEFAULT_DASHBOARD_SETTINGS.enable_audio_alarm
  );

  const [handshakeStatus, setHandshakeStatus] = useState<HandshakeStatus>('idle');
  const [handshake, setHandshake] = useState<HandshakeResult | null>(null);

  const handshakeStale = handshakeStatus !== 'success';

  // [AUDIT 2026-08-28 F8] In add-device mode a device_id that already exists
  // would SILENTLY REPLACE the existing profile (addDeviceToConfig upserts by
  // id) — block the save and tell the operator instead.
  const duplicateDeviceId =
    isAddMode && !!config?.devices.some((d) => d.device_id === deviceId.trim());

  const formValid = useMemo(
    () =>
      gasUrl.trim().startsWith('http') &&
      authToken.trim().length > 0 &&
      deviceId.trim().length > 0 &&
      refreshSec >= 1 &&
      !duplicateDeviceId,
    [gasUrl, authToken, deviceId, refreshSec, duplicateDeviceId]
  );

  // [AUDIT 2026-08-28 F5] keep the polling interval inside the documented
  // 1..300 s window (the HTML max attribute was never enforced in JS).
  const clampRefresh = (v: number) => Math.min(300, Math.max(1, Number.isFinite(v) ? v : 5));

  const runHandshake = useCallback(async () => {
    if (!formValid) {
      toast.error('Lengkapi URL GAS, token, dan device ID terlebih dahulu.');
      return;
    }
    setHandshakeStatus('testing');
    setHandshake(null);
    // [WAVE-4 / GAS-2-S] device ID ikut dikirim — GAS ≥ Wave 4 menjawab
    // dengan laporan registrasi jujur di data.device_registered.
    const result = await pingGasEndpoint(gasUrl.trim(), authToken.trim(), 7000, deviceId.trim());
    setHandshake(result);
    setHandshakeStatus(result.ok ? 'success' : 'failed');
    if (result.ok) {
      if (result.device_registered === false) {
        // Jujur tapi mengganggu: handshake OK, namun device belum terdaftar
        // di sheet DEVICES — telemetri akan ditolak 400 sampai didaftarkan.
        toast.warning(result.message, { duration: 9000 });
      } else {
        toast.success('Handshake sukses! Anda dapat menyimpan konfigurasi.');
      }
    } else {
      toast.error(`Handshake gagal: ${result.message}`);
    }
    // [AUDIT 2026-08-28 G1] deps cukup: runHandshake membaca gasUrl /
    // authToken / deviceId / formValid.
  }, [gasUrl, authToken, deviceId, formValid]);

  const persist = useCallback(() => {
    if (!formValid || handshakeStatus !== 'success') return;
    const dashboard = {
      telemetry_refresh_interval_sec: clampRefresh(refreshSec),
      battery_nominal_voltage: nominalV,
      battery_capacity_ah: capacityAh,
      low_battery_warning_threshold: lowV,
      enable_audio_alarm: audio,
      theme: DEFAULT_DASHBOARD_SETTINGS.theme,
    };
    if (isAddMode && config) {
      addDevice({
        device_id: deviceId.trim(),
        label: label.trim() || deviceId.trim(),
        gas_webapp_url: gasUrl.trim(),
        auth_token: authToken.trim(),
        admin_token: adminToken.trim() || undefined,
        dashboard_settings: dashboard,
      });
      toast.success(`Perangkat ${deviceId.trim()} ditambahkan & di-set aktif.`);
    } else if (config) {
      // [AUDIT 2026-08-28 F1] EDIT path — upsert the active device in place.
      // save()/writeSysConfig() would overwrite devices[] with a single entry
      // and silently destroy the rest of the fleet.
      updateActive({
        device_id: deviceId.trim(),
        label: label.trim() || deviceId.trim(),
        gas_webapp_url: gasUrl.trim(),
        auth_token: authToken.trim(),
        admin_token: adminToken.trim() || undefined,
        dashboard_settings: dashboard,
      });
      toast.success(`Konfigurasi ${deviceId.trim()} tersimpan (fleet dipertahankan).`);
    } else {
      save({
        gas_webapp_url: gasUrl.trim(),
        auth_token: authToken.trim(),
        device_id: deviceId.trim(),
        label: label.trim() || deviceId.trim(),
        dashboard_settings: dashboard,
      });
      toast.success('Konfigurasi tersimpan di browser Anda.');
    }
    router.replace('/');
  }, [
    formValid,
    handshakeStatus,
    gasUrl,
    authToken,
    adminToken,
    deviceId,
    label,
    refreshSec,
    nominalV,
    capacityAh,
    lowV,
    audio,
    save,
    addDevice,
    updateActive,
    router,
    isAddMode,
    config,
  ]);

  const handleImport = useCallback(
    async (file: File) => {
      try {
        const text = await file.text();
        const parsed = JSON.parse(text) as unknown;
        const validated = validateSysConfig(parsed);
        if (!validated) {
          toast.error('File konfigurasi tidak valid.');
          return;
        }
        const restored: PltsSysConfig = validated;
        setGasUrl(restored.gas_webapp_url);
        setAuthToken(restored.auth_token);
        setDeviceId(restored.device_id);
        const activeProfile = restored.devices.find((d) => d.device_id === restored.active_device_id);
        setLabel(activeProfile?.label ?? restored.device_id);
        setRefreshSec(restored.dashboard_settings.telemetry_refresh_interval_sec);
        setNominalV(restored.dashboard_settings.battery_nominal_voltage);
        setCapacityAh(restored.dashboard_settings.battery_capacity_ah);
        setLowV(restored.dashboard_settings.low_battery_warning_threshold);
        setAudio(restored.dashboard_settings.enable_audio_alarm);
        setHandshakeStatus('idle');
        setHandshake(null);
        // [AUDIT 2026-08-28 F4] This form only carries the ACTIVE device —
        // saving here persists just that one profile. A multi-device backup
        // must be restored via Settings → Impor Konfigurasi (full fleet).
        if (restored.devices.length > 1) {
          toast.warning(
            `Backup berisi ${restored.devices.length} perangkat — form ini hanya memuat "${restored.device_id}". ` +
            `Untuk restore seluruh fleet, gunakan Settings → System Configuration → Impor Konfigurasi.`,
            { duration: 9000 }
          );
        }
        toast.success('Konfigurasi berhasil di-restore. Silakan uji handshake lalu simpan.');
      } catch {
        toast.error('Gagal membaca file konfigurasi.');
      }
    },
    []
  );

  /** Decode a QR text — accepts either `#plts=<b64>` URL or raw JSON payload. */
  const handleQrPayload = useCallback((raw: string) => {
    try {
      let jsonText = raw.trim();
      const hashMatch = jsonText.match(/#plts=([^&]+)/);
      if (hashMatch) {
        jsonText = decodeURIComponent(escape(window.atob(hashMatch[1])));
      } else if (/^[A-Za-z0-9+/=]+$/.test(jsonText) && jsonText.length > 40) {
        try {
          jsonText = decodeURIComponent(escape(window.atob(jsonText)));
        } catch {
          /* keep as-is */
        }
      }
      const parsed = JSON.parse(jsonText) as Record<string, unknown>;
      if (typeof parsed.gas_url === 'string') setGasUrl(parsed.gas_url);
      if (typeof parsed.auth_token === 'string') setAuthToken(parsed.auth_token);
      if (typeof parsed.device_key === 'string') setDeviceId(parsed.device_key);
      if (typeof parsed.label === 'string') setLabel(parsed.label);
      if (typeof parsed.telemetry_interval_sec === 'number') setRefreshSec(parsed.telemetry_interval_sec);
      // Both new (i_calib_dc/i_calib_ac) and legacy (i_calib) keys silently
      // ignored here — Fleet-side calibration is stored elsewhere.
      setHandshakeStatus('idle');
      setHandshake(null);
    } catch {
      toast.error('QR tidak valid — payload harus JSON PLTS onboarding.');
    }
  }, []);

  // [AUDIT 2026-08-28 F3] Don't render the form until the localStorage store
  // is live on the client — otherwise a hard load shows an EMPTY form even
  // when a saved config exists (hydration snapshot is null by design).
  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground py-8 px-4">
      <div className="max-w-3xl mx-auto space-y-6">
        <header className="space-y-2">
          <div className="flex items-center gap-2 text-primary">
            <Zap className="w-6 h-6" />
            <h1 className="text-2xl font-semibold tracking-tight" data-testid="setup-title">
              {isAddMode ? 'Tambah Perangkat Baru' : 'Setup Awal PLTS Monitor'}
            </h1>
          </div>
          <p className="text-sm text-muted-foreground">
            {isAddMode
              ? 'Perangkat baru akan disimpan di daftar dan otomatis dijadikan perangkat aktif.'
              : 'Aplikasi ini bersifat stateless: seluruh kredensial Anda disimpan lokal di browser (localStorage) — tidak pernah dikirim ke server pihak ketiga selain Google Apps Script yang Anda daftarkan sendiri.'}
          </p>
        </header>

        <Card data-testid="setup-connection-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <LinkIcon className="w-4 h-4" /> 1. Google Apps Script Endpoint
            </CardTitle>
            <CardDescription>
              Tempel URL Web App hasil deploy Apps Script Anda beserta token otentikasi dari tab <code>Config</code>.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="gas-url">GAS Web App URL</Label>
              <Input
                id="gas-url"
                data-testid="setup-input-gas-url"
                type="url"
                autoComplete="off"
                placeholder="https://script.google.com/macros/s/.../exec"
                value={gasUrl}
                onChange={(e) => {
                  setGasUrl(e.target.value);
                  setHandshakeStatus('idle');
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="auth-token" className="flex items-center gap-1.5">
                <KeyRound className="w-3.5 h-3.5" /> Auth Token
              </Label>
              <Input
                id="auth-token"
                data-testid="setup-input-token"
                type="password"
                autoComplete="off"
                placeholder="plts_sec_88x99y77z66a55b44"
                value={authToken}
                onChange={(e) => {
                  setAuthToken(e.target.value);
                  setHandshakeStatus('idle');
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="admin-token" className="flex items-center gap-1.5">
                <ShieldAlert className="w-3.5 h-3.5" /> Admin Token (Kontrol Darurat — opsional)
              </Label>
              <Input
                id="admin-token"
                data-testid="setup-input-admin-token"
                type="password"
                autoComplete="off"
                placeholder="ADMIN_TOKEN dari Config sheet GAS (untuk ARM/DISARM)"
                value={adminToken}
                onChange={(e) => setAdminToken(e.target.value)}
              />
              <p className="text-[11px] text-muted-foreground">
                Rahasia operator dari Config sheet GAS (ADMIN_TOKEN). Diperlukan untuk perintah
                ARM / EMERGENCY STOP di menu Kontrol Darurat. Kosong = fitur nonaktif (fail-closed).
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="device-id" className="flex items-center gap-1.5">
                <Cpu className="w-3.5 h-3.5" /> Device ID
              </Label>
              <Input
                id="device-id"
                data-testid="setup-input-device-id"
                placeholder="PLTS_MONITOR_01"
                value={deviceId}
                onChange={(e) => setDeviceId(e.target.value)}
              />
              {duplicateDeviceId && (
                <p className="text-xs text-destructive" data-testid="setup-duplicate-warning">
                  Device ID ini sudah terdaftar — menyimpan akan MENIMPA profil yang ada.
                  Gunakan Device ID lain, atau edit perangkat lewat Setup (mode edit).
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="device-label" className="flex items-center gap-1.5">
                <Tag className="w-3.5 h-3.5" /> Label Perangkat
              </Label>
              <Input
                id="device-label"
                data-testid="setup-input-label"
                placeholder="Basecamp Tebo, Site A, dst."
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </div>

            <Separator />

            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">Scan QR Onboarding</p>
                <p className="text-xs text-muted-foreground">
                  Arahkan kamera ke QR yang di-print dari PWA lain — form akan terisi otomatis.
                </p>
              </div>
              <QrScannerButton
                onDetected={handleQrPayload}
                label="Buka Kamera"
                data-testid="setup-qr-scan"
              />
            </div>

            <Separator />

            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">Live Connection Test (PING/PONG)</p>
                <p className="text-xs text-muted-foreground">
                  Handshake wajib sukses sebelum tombol Simpan dapat aktif (§2.4).
                </p>
              </div>
              <Button
                onClick={runHandshake}
                disabled={!formValid || handshakeStatus === 'testing'}
                data-testid="setup-test-handshake"
                variant="secondary"
              >
                {handshakeStatus === 'testing' ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Mengetes...
                  </>
                ) : (
                  <>
                    <Timer className="w-4 h-4 mr-2" /> Test Handshake
                  </>
                )}
              </Button>
            </div>

            {handshake && (
              <Alert
                variant={handshake.ok ? 'default' : 'destructive'}
                data-testid={handshake.ok ? 'handshake-alert-success' : 'handshake-alert-error'}
                className={handshake.ok ? 'border-emerald-500/40' : ''}
              >
                {handshake.ok ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                <AlertTitle>
                  {handshake.ok ? 'Handshake Sukses' : 'Handshake Gagal'}
                  {handshake.latency_ms != null && (
                    <span className="ml-2 text-xs text-muted-foreground">({handshake.latency_ms} ms)</span>
                  )}
                </AlertTitle>
                <AlertDescription>{handshake.message}</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>2. Preferensi Dashboard</CardTitle>
            <CardDescription>Preferensi visual dan alarm sistem monitoring.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="refresh-sec">Refresh Telemetri (detik)</Label>
              <Input
                id="refresh-sec"
                type="number"
                min={1}
                max={300}
                value={refreshSec}
                data-testid="setup-input-refresh"
                onChange={(e) => setRefreshSec(clampRefresh(Number(e.target.value)))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nominal-v">Tegangan Nominal Baterai (V)</Label>
              <Input
                id="nominal-v"
                type="number"
                step={0.1}
                value={nominalV}
                // [P0-007] 48V default — aligned with firmware/GAS canonical config
                onChange={(e) => setNominalV(Number(e.target.value) || 48)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="capacity-ah">Kapasitas (Ah)</Label>
              <Input
                id="capacity-ah"
                type="number"
                value={capacityAh}
                onChange={(e) => setCapacityAh(Number(e.target.value) || 200)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="low-v">Threshold Low Battery (V)</Label>
              <Input
                id="low-v"
                type="number"
                step={0.1}
                value={lowV}
                onChange={(e) => setLowV(Number(e.target.value) || 45)}
              />
            </div>
            <div className="col-span-1 sm:col-span-2 flex items-center justify-between rounded-md border border-border p-3">
              <div>
                <Label htmlFor="audio-alarm" className="cursor-pointer">
                  Audio Alarm
                </Label>
                <p className="text-xs text-muted-foreground">Bunyikan alarm saat baterai kritis.</p>
              </div>
              <Switch id="audio-alarm" checked={audio} onCheckedChange={setAudio} data-testid="setup-switch-audio" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>3. Import / Restore (Opsional)</CardTitle>
            <CardDescription>Muat file <code>plts_config_backup.json</code> yang pernah Anda ekspor.</CardDescription>
          </CardHeader>
          <CardContent>
            <label className="flex items-center gap-3 cursor-pointer text-sm">
              <span className="inline-flex items-center gap-2 rounded-md border border-border bg-secondary px-3 py-2 hover:bg-secondary/80 transition">
                <Upload className="w-4 h-4" /> Pilih file JSON
              </span>
              <span className="text-muted-foreground">Konfigurasi akan mengisi form namun tetap wajib melalui handshake.</span>
              <input
                type="file"
                accept="application/json"
                className="hidden"
                data-testid="setup-input-import"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleImport(file);
                  e.target.value = '';
                }}
              />
            </label>
          </CardContent>
        </Card>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 justify-end">
          {handshakeStale && (
            <p className="text-xs text-amber-400 self-center" data-testid="setup-stale-warning">
              Handshake wajib sukses sebelum menyimpan.
            </p>
          )}
          <Button
            onClick={persist}
            disabled={!formValid || handshakeStatus !== 'success'}
            data-testid="setup-save-button"
            size="lg"
          >
            <Save className="w-4 h-4 mr-2" />
            {isAddMode ? 'Tambah Perangkat' : 'Simpan Konfigurasi & Buka Dashboard'}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function SetupPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-background">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
      }
    >
      <SetupPageInner />
    </Suspense>
  );
}
