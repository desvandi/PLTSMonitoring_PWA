'use client';

// =============================================================================
// PushAlarmPanel — panel Settings untuk push-alarm server (Web Push + VAPID).
// -----------------------------------------------------------------------------
// Berbeda dari BrowserNotificationPanel (notifikasi LOKAL low-battery yang
// hanya jalan saat aplikasi terbuka), panel ini mengelola langganan Web Push
// ke GAS PushService: notifikasi alarm tetap tampil WALAU aplikasi ditutup.
// Konfigurasi (URL GAS Push + kunci publik VAPID) mengikuti pola zero-touch:
// ditempel operator di sini, tersimpan di localStorage + IndexedDB (untuk SW).
//
// Editor konfigurasi sengaja dipecah jadi sub-komponen ber-`key` (seed dari
// konfigurasi efektif): perubahan konfigurasi me-remount editor sehingga
// draf input otomatis sinkron — tanpa setState-dalam-effect (React Compiler).
// =============================================================================

import { useState } from 'react';
import { BellRing, CloudOff, RadioTower, ShieldAlert, TestTube2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { usePushAlarm } from '@/hooks/usePushAlarm';
import { hasBuildTimeDefault } from '@/lib/push-alarm/client';
import { validatePushAlarmConfig, type PushAlarmConfig } from '@/lib/push-alarm/shared';

interface PushFeedback {
  ok: boolean | null;
  message: string | null;
}

const BUILD_DEFAULTS = hasBuildTimeDefault();

export function PushAlarmPanel() {
  const {
    supported,
    permission,
    config,
    hasStoredConfig,
    subscribed,
    endpointHost,
    busy,
    enable,
    disable,
    saveConfig,
    clearConfig,
    sendTestPush,
  } = usePushAlarm();

  const [feedback, setFeedback] = useState<PushFeedback>({ ok: null, message: null });
  const configValid = validatePushAlarmConfig(config).ok;

  const onToggle = async (value: boolean) => {
    const result = value ? await enable() : await disable();
    setFeedback({ ok: result.ok, message: result.message });
  };

  const onTestPush = async () => {
    setFeedback({ ok: null, message: 'Mengirim uji push ke GAS…' });
    const result = await sendTestPush();
    setFeedback({ ok: result.ok, message: result.message });
  };

  return (
    <Card data-testid="push-alarm-panel">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <RadioTower className="w-4 h-4 text-primary" />
          Server Push Alarm (GAS PushService)
        </CardTitle>
        <CardDescription>
          Notifikasi alarm terenkripsi (Web Push + VAPID) dari Google Apps Script — tetap
          muncul <strong>meski aplikasi ditutup</strong>. Klik notifikasi membuka view
          Alarms; aksi <em>Tandai Ditangani</em> mengirim ACK ke GAS.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!supported && (
          <Alert variant="destructive">
            <CloudOff className="w-4 h-4" />
            <AlertTitle>Tidak Didukung</AlertTitle>
            <AlertDescription>
              Browser ini tidak mendukung Push API. Gunakan Chrome/Edge (desktop/Android), atau
              Safari 16.4+ dengan PWA terpasang di layar utama (iOS).
            </AlertDescription>
          </Alert>
        )}
        {supported && permission === 'denied' && (
          <Alert>
            <ShieldAlert className="w-4 h-4" />
            <AlertTitle>Izin Ditolak</AlertTitle>
            <AlertDescription>
              Izin notifikasi diblokir. Buka pengaturan situs pada browser lalu ubah izin
              Notifications menjadi <em>Allow</em>.
            </AlertDescription>
          </Alert>
        )}
        {supported && !configValid && (
          <Alert>
            <ShieldAlert className="w-4 h-4" />
            <AlertTitle>Konfigurasi Belum Lengkap</AlertTitle>
            <AlertDescription>
              Isi URL Web App GAS PushService dan kunci publik VAPID di bawah ini, lalu simpan.
              Keduanya tersedia setelah Anda men-deploy <code>push-alarm/gas/Code.gs</code> dan
              menempel <code>VAPID_PUBLIC_KEY</code> ke Script Properties (lihat panduan deploy).
            </AlertDescription>
          </Alert>
        )}

        {/* key = konfigurasi efektif -> remount meng-seed ulang draf input */}
        <PushAlarmConfigEditor
          key={`${config.apiBase}\u0000${config.vapidPublicKey}`}
          apiBase={config.apiBase}
          vapidPublicKey={config.vapidPublicKey}
          hasStoredConfig={hasStoredConfig}
          configValid={configValid}
          busy={busy}
          onSave={saveConfig}
          onReset={clearConfig}
          onFeedback={setFeedback}
        />

        {/* ---- Langganan push ---- */}
        <div className="flex items-center justify-between rounded-md border border-border p-3">
          <div className="min-w-0">
            <Label htmlFor="push-alarm-toggle" className="cursor-pointer">
              Langganan notifikasi alarm (server push)
            </Label>
            <p className="text-xs text-muted-foreground">
              {subscribed
                ? `Aktif — terdaftar di push service (${endpointHost ?? 'endpoint tidak diketahui'}).`
                : 'Belum berlangganan — aktifkan dari perangkat ini.'}
            </p>
          </div>
          <Switch
            id="push-alarm-toggle"
            checked={subscribed}
            onCheckedChange={(v) => void onToggle(v)}
            disabled={!supported || busy || !configValid}
            data-testid="push-alarm-toggle"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => void onTestPush()}
            disabled={!supported || !subscribed || !configValid || busy}
            data-testid="push-alarm-test"
          >
            <TestTube2 className="w-3.5 h-3.5 mr-1.5" />
            Kirim Uji Push
          </Button>
          <span className="text-xs text-muted-foreground">
            GAS memberi rate-limit 60 detik pada uji push.
          </span>
        </div>

        {feedback.message !== null && (
          <p
            className={
              feedback.ok === true
                ? 'text-sm text-status-on flex items-center gap-1.5'
                : feedback.ok === false
                  ? 'text-sm text-status-error flex items-center gap-1.5'
                  : 'text-sm text-muted-foreground flex items-center gap-1.5'
            }
            data-testid="push-alarm-feedback"
          >
            <BellRing className="w-3.5 h-3.5 shrink-0" />
            {feedback.message}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// -----------------------------------------------------------------------------
// Sub-komponen: editor konfigurasi runtime (pola zero-touch PLTS_SYS_CONFIG)
// -----------------------------------------------------------------------------

interface PushAlarmConfigEditorProps {
  apiBase: string;
  vapidPublicKey: string;
  hasStoredConfig: boolean;
  configValid: boolean;
  busy: boolean;
  onSave: (config: PushAlarmConfig) => Promise<{ ok: boolean; message: string }>;
  onReset: () => Promise<void>;
  onFeedback: (feedback: PushFeedback) => void;
}

function PushAlarmConfigEditor({
  apiBase,
  vapidPublicKey,
  hasStoredConfig,
  configValid,
  busy,
  onSave,
  onReset,
  onFeedback,
}: PushAlarmConfigEditorProps) {
  const [apiBaseDraft, setApiBaseDraft] = useState(apiBase);
  const [vapidKeyDraft, setVapidKeyDraft] = useState(vapidPublicKey);

  const dirty = apiBaseDraft.trim() !== apiBase || vapidKeyDraft.trim() !== vapidPublicKey;

  const handleSave = async () => {
    const result = await onSave({ apiBase: apiBaseDraft.trim(), vapidPublicKey: vapidKeyDraft.trim() });
    onFeedback({ ok: result.ok, message: result.message });
  };

  const handleReset = async () => {
    await onReset();
    onFeedback({
      ok: true,
      message: 'Konfigurasi tersimpan dihapus — kembali ke default build-time (bila ada).',
    });
  };

  return (
    <div className="rounded-md border border-border p-3 space-y-3" data-testid="push-alarm-config">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">Konfigurasi Backend Push</p>
          <p className="text-xs text-muted-foreground">
            Default build-time: URL GAS {BUILD_DEFAULTS.apiBase ? 'tersedia' : 'tidak ada'} ·
            kunci VAPID {BUILD_DEFAULTS.vapidPublicKey ? 'tersedia' : 'tidak ada'}
            {BUILD_DEFAULTS.apiBase || BUILD_DEFAULTS.vapidPublicKey
              ? ' — isian di bawah menimpa default.'
              : ' — wajib diisi manual.'}
          </p>
        </div>
        {configValid ? (
          <Badge variant="outline" className="text-xs text-status-on border-status-on/30">
            Valid
          </Badge>
        ) : (
          <Badge variant="outline" className="text-xs text-amber-500 border-amber-500/30">
            Belum valid
          </Badge>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="push-alarm-api-base">URL Web App GAS (…/exec)</Label>
          <Input
            id="push-alarm-api-base"
            placeholder="https://script.google.com/macros/s/…/exec"
            value={apiBaseDraft}
            onChange={(e) => setApiBaseDraft(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            data-testid="push-alarm-api-base"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="push-alarm-vapid">Kunci Publik VAPID (base64url)</Label>
          <Input
            id="push-alarm-vapid"
            placeholder="B… (65 byte, prefiks 04 setelah decode)"
            value={vapidKeyDraft}
            onChange={(e) => setVapidKeyDraft(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            data-testid="push-alarm-vapid"
          />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => void handleSave()} disabled={!dirty || busy} data-testid="push-alarm-save">
          Simpan Konfigurasi
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void handleReset()}
          disabled={!hasStoredConfig || busy}
          data-testid="push-alarm-reset"
        >
          Hapus Konfigurasi Tersimpan
        </Button>
      </div>
    </div>
  );
}
