'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Battery, Bolt, Gauge, Loader2, RefreshCw, RotateCcw, ShieldCheck, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import { useSysConfig } from '@/components/providers/sys-config-provider';

const DEFAULT_FACTORS = { v_calib: 11, i_calib_dc: 1, i_calib_ac: 1 } as const;

interface LatestReading {
  v_bat: number | null;
  i_bat_dc: number | null;
  i_ac_load: number | null;
  timestamp: string | null;
}

type ChannelKey = 'v' | 'dc' | 'ac';

interface ChannelState {
  raw: number | null;      // current reading from device (pre-calibration adjusted)
  reference: string;       // multimeter / clamp meter value entered by user
  currentFactor: number;   // current calibration factor stored in PWA
  newFactor: number | null;
}

const CHANNEL_META: Record<ChannelKey, { label: string; unit: string; icon: React.ElementType; hint: string }> = {
  v:  { label: 'Tegangan Baterai',       unit: 'V', icon: Battery, hint: 'Pakai multimeter, ukur langsung di terminal baterai.' },
  dc: { label: 'Arus DC (INA219)',       unit: 'A', icon: Bolt,   hint: 'Beri beban DC dummy (mis. lampu 100W). Ukur arus dengan clamp meter DC.' },
  ac: { label: 'Arus AC (ACS712)',       unit: 'A', icon: Gauge,  hint: 'Beri beban AC dummy (mis. setrika 300W). Ukur dengan clamp meter AC.' },
};

// [PARITY-3 2026-09-06 FIX — dual bug]: (1) device_key was NEVER sent, so
// GAS resolved the Config-sheet DEFAULT device — a multi-device fleet would
// calibrate against the wrong device's readings; (2) only the legacy FLAT
// fields were parsed, while GAS ≥ v2 answers the canonical NESTED envelope
// (data.battery.voltage.value, …) — on a v2 backend every raw reading
// resolved to null and the wizard computed factors against nothing.
async function fetchLatest(
  gasUrl: string,
  token: string,
  deviceKey?: string,
): Promise<LatestReading | null> {
  try {
    const body: Record<string, string> = { action: 'LATEST', token };
    if (deviceKey && deviceKey.trim()) body.device_key = deviceKey.trim();
    const res = await fetch(gasUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
      redirect: 'follow',
    });
    if (!res.ok) return null;
    const bodyJson = (await res.json().catch(() => null)) as { status?: string; data?: Record<string, unknown> } | null;
    if (!bodyJson || bodyJson.status !== 'SUCCESS' || !bodyJson.data) return null;
    const d = bodyJson.data;
    const num = (v: unknown) => (v === '' || v == null ? null : Number(v));
    // Nested (canonical v2) first, flat legacy fallback second.
    const bat = (d.battery ?? {}) as Record<string, unknown>;
    const ac = (d.ac ?? {}) as Record<string, unknown>;
    const measVal = (m: unknown) =>
      m && typeof m === 'object' ? num((m as Record<string, unknown>).value) : num(m);
    return {
      v_bat: num(d.v_bat) ?? measVal(bat.voltage),
      i_bat_dc: num(d.i_bat_dc ?? d.i_bat) ?? measVal(bat.current),
      i_ac_load: num(d.i_ac_load) ?? measVal(ac.rmsCurrent),
      timestamp: (d.eventTime as string | null) ?? (d.timestamp as string | null) ?? null,
    };
  } catch {
    return null;
  }
}

async function publishCalibration(
  gasUrl: string,
  token: string,
  deviceKey: string,
  factors: { v_calib: number; i_calib_dc: number; i_calib_ac: number }
): Promise<{ ok: boolean; message: string; command_id?: string }> {
  try {
    const res = await fetch(gasUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'CALIBRATION_PUBLISH',
        token,
        device_key: deviceKey,
        ...factors,
        note: 'Auto Calibration Wizard',
      }),
      redirect: 'follow',
    });
    if (!res.ok) return { ok: false, message: `HTTP ${res.status}` };
    const body = (await res.json().catch(() => null)) as {
      status?: string; message?: string; data?: { command_id?: string };
    } | null;
    if (!body) return { ok: false, message: 'Respons GAS bukan JSON' };
    return {
      ok: body.status === 'SUCCESS',
      message: body.message ?? '',
      command_id: body.data?.command_id,
    };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

/**
 * Auto Calibration Wizard — 4 langkah:
 *   0 → V-Bat (multimeter)
 *   1 → I-DC  (clamp meter DC)
 *   2 → I-AC  (clamp meter AC)
 *   3 → Review & Publish (POST CALIBRATION_PUBLISH)
 */
export function CalibrationWizard() {
  const { config } = useSysConfig();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [, setReading] = useState<LatestReading | null>(null);
  const [loading, setLoading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [resetting, setResetting] = useState(false);

  const [channels, setChannels] = useState<Record<ChannelKey, ChannelState>>({
    v:  { raw: null, reference: '', currentFactor: 11, newFactor: null },
    dc: { raw: null, reference: '', currentFactor: 1,  newFactor: null },
    ac: { raw: null, reference: '', currentFactor: 1,  newFactor: null },
  });

  const refreshReading = useCallback(async () => {
    if (!config) return;
    setLoading(true);
    const latest = await fetchLatest(
      config.gas_webapp_url, config.auth_token, config.device_id);
    setReading(latest);
    if (latest) {
      setChannels((prev) => ({
        v:  { ...prev.v,  raw: latest.v_bat },
        dc: { ...prev.dc, raw: latest.i_bat_dc },
        ac: { ...prev.ac, raw: latest.i_ac_load },
      }));
    }
    setLoading(false);
  }, [config]);

  useEffect(() => {
    if (!open) return;
    // [AUDIT 2026-08-28 G9] Kickoff ditunda satu macrotask — setLoading(true)
    // di awal refreshReading tidak sinkron-reachable dari badan effect.
    const kickoff = window.setTimeout(() => void refreshReading(), 0);
    return () => window.clearTimeout(kickoff);
  }, [open, refreshReading]);

  const activeKey: ChannelKey | null = useMemo(() => {
    if (step === 0) return 'v';
    if (step === 1) return 'dc';
    if (step === 2) return 'ac';
    return null;
  }, [step]);

  const updateReference = (key: ChannelKey, ref: string) => {
    setChannels((prev) => {
      const raw = prev[key].raw;
      const refNum = Number(ref);
      const factor = raw && refNum && Number.isFinite(refNum) && raw !== 0
        ? (refNum / raw) * prev[key].currentFactor
        : null;
      return {
        ...prev,
        [key]: { ...prev[key], reference: ref, newFactor: factor },
      };
    });
  };

  const nextDisabled = useMemo(() => {
    if (activeKey == null) return false;
    const ch = channels[activeKey];
    return !ch.newFactor || !Number.isFinite(ch.newFactor);
  }, [activeKey, channels]);

  const doPublish = useCallback(async () => {
    if (!config) return;
    const factors = {
      v_calib:    channels.v.newFactor    ?? channels.v.currentFactor,
      i_calib_dc: channels.dc.newFactor   ?? channels.dc.currentFactor,
      i_calib_ac: channels.ac.newFactor   ?? channels.ac.currentFactor,
    };
    setPublishing(true);
    const result = await publishCalibration(
      config.gas_webapp_url, config.auth_token, config.device_id, factors
    );
    setPublishing(false);
    if (result.ok) {
      toast.success(
        `Kalibrasi terkirim (cmd ${result.command_id?.slice(0, 8) ?? '—'}). ` +
        'ESP32 akan menerapkan pada polling berikutnya (max 5 menit).'
      );
      setOpen(false);
      setStep(0);
    } else {
      toast.error(`Publish gagal: ${result.message}`);
    }
  }, [channels, config]);

  const doResetDefaults = useCallback(async () => {
    if (!config) return;
    setResetting(true);
    const result = await publishCalibration(
      config.gas_webapp_url,
      config.auth_token,
      config.device_id,
      DEFAULT_FACTORS,
    );
    setResetting(false);
    if (result.ok) {
      toast.success(
        `Reset default terkirim (cmd ${result.command_id?.slice(0, 8) ?? '—'}). ` +
        'ESP32 akan menerapkan V=11.0, I-DC=1.0, I-AC=1.0 pada polling berikutnya.'
      );
      setChannels((prev) => ({
        v:  { ...prev.v,  reference: '', currentFactor: DEFAULT_FACTORS.v_calib,    newFactor: null },
        dc: { ...prev.dc, reference: '', currentFactor: DEFAULT_FACTORS.i_calib_dc, newFactor: null },
        ac: { ...prev.ac, reference: '', currentFactor: DEFAULT_FACTORS.i_calib_ac, newFactor: null },
      }));
    } else {
      toast.error(`Reset default gagal: ${result.message}`);
    }
  }, [config]);

  if (!config) return null;

  const renderStep = () => {
    if (activeKey == null) {
      // Review step
      const rows: Array<{ key: ChannelKey; from: number; to: number | null }> = [
        { key: 'v',  from: channels.v.currentFactor,  to: channels.v.newFactor  },
        { key: 'dc', from: channels.dc.currentFactor, to: channels.dc.newFactor },
        { key: 'ac', from: channels.ac.currentFactor, to: channels.ac.newFactor },
      ];
      return (
        <div className="space-y-3">
          <Alert>
            <ShieldCheck className="w-4 h-4" />
            <AlertTitle>Konfirmasi kalibrasi</AlertTitle>
            <AlertDescription className="text-xs">
              Data akan di-queue di sheet <code>Calibration</code>. ESP32 mengambilnya
              dalam maks. 5 menit dan ACK setelah menulis ke <code>/config.json</code>.
            </AlertDescription>
          </Alert>
          <div className="rounded-md border border-border divide-y">
            {rows.map(({ key, from, to }) => {
              const meta = CHANNEL_META[key];
              const Icon = meta.icon;
              return (
                <div key={key} className="flex items-center gap-3 p-3 text-sm">
                  <Icon className="w-4 h-4 text-primary shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium">{meta.label}</p>
                    <p className="text-xs text-muted-foreground font-mono">
                      {from.toFixed(4)} → {to != null ? to.toFixed(4) : '— (tetap)'}
                    </p>
                  </div>
                  <Badge variant={to != null ? 'default' : 'outline'} className="text-[10px]">
                    {to != null ? 'Berubah' : 'Skip'}
                  </Badge>
                </div>
              );
            })}
          </div>
        </div>
      );
    }

    const ch = channels[activeKey];
    const meta = CHANNEL_META[activeKey];
    const Icon = meta.icon;
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-md border border-border p-3 bg-muted/40">
          <Icon className="w-5 h-5 text-primary mt-0.5 shrink-0" />
          <div className="min-w-0">
            <p className="font-medium text-sm">{meta.label}</p>
            <p className="text-xs text-muted-foreground">{meta.hint}</p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Pembacaan Perangkat (raw)</Label>
            <div className="rounded-md border border-border px-3 py-2 font-mono text-sm">
              {ch.raw != null ? `${ch.raw.toFixed(3)} ${meta.unit}` : '—'}
            </div>
            <p className="text-[10px] text-muted-foreground">
              Diambil dari GAS <code>LATEST</code> untuk device aktif.
            </p>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`wiz-ref-${activeKey}`} className="text-xs">
              Nilai Referensi ({meta.unit})
            </Label>
            <Input
              id={`wiz-ref-${activeKey}`}
              data-testid={`wiz-ref-${activeKey}`}
              type="number"
              inputMode="decimal"
              step="0.01"
              placeholder={`Ketik ${meta.unit} dari alat ukur`}
              value={ch.reference}
              onChange={(e) => updateReference(activeKey, e.target.value)}
            />
            {ch.newFactor != null && Number.isFinite(ch.newFactor) && (
              <p className="text-[11px] text-emerald-500 font-mono">
                Faktor baru: {ch.newFactor.toFixed(4)}
                <span className="text-muted-foreground ml-1">
                  (dari {ch.currentFactor.toFixed(4)})
                </span>
              </p>
            )}
          </div>
        </div>
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void refreshReading()}
            disabled={loading}
          >
            {loading ? (
              <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Menyegarkan...</>
            ) : (
              <><RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Refresh Reading</>
            )}
          </Button>
        </div>
      </div>
    );
  };

  // [PARITY-3 2026-09-06] Device-type gate: the multiplier model
  // (v_calib / i_calib_dc / i_calib_ac) ONLY exists in firmware-generic
  // (config.json factors, polled via CALIBRATION_PENDING). The MODULAR
  // firmware never polls that sheet — its calibration is the 3-point
  // voltage map + ACS712 zero + SHT31 offsets (CalibrationCenter, REST).
  // Previously the wizard silently published factors a modular device would
  // never apply; now it refuses with an honest pointer.
  const activeDevice = config?.devices.find(
    (d) => d.device_id === config.active_device_id) ?? config?.devices[0];
  const firmwareType = activeDevice?.firmware_type ?? null;
  const isModular = firmwareType === 'modular';

  return (
    <Card data-testid="calibration-wizard-panel">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wand2 className="w-4 h-4" /> Auto Calibration Wizard
        </CardTitle>
        <CardDescription>
          Wizard 3-langkah untuk V-Bat, I-DC, dan I-AC. Faktor kalibrasi
          dikirim OTA ke ESP32 lewat GAS — tidak perlu USB atau reboot.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isModular ? (
          <Alert data-testid="calibration-wizard-modular-gate">
            <ShieldCheck className="w-4 h-4" />
            <AlertTitle>Wizard tidak berlaku untuk firmware modular</AlertTitle>
            <AlertDescription className="text-xs">
              Perangkat aktif ini terdaftar di GAS sebagai <code>firmware_type =
              modular</code>. Firmware modular tidak memakai faktor pengali —
              kalibrasinya adalah 3-point voltage + ACS712 zero + offset SHT31
              yang dikelola lewat <b>Calibration Center</b> (REST langsung ke
              perangkat). Mengirim faktor pengali ke perangkat modular tidak
              akan pernah diterapkan, jadi wizard ini menolak jalan (fail-closed).
            </AlertDescription>
          </Alert>
        ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => setOpen(true)}
            data-testid="calibration-wizard-open"
          >
            <Wand2 className="w-4 h-4 mr-2" /> Mulai Wizard
          </Button>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
                disabled={resetting}
                data-testid="calibration-reset-defaults"
              >
                {resetting ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Mengirim...</>
                ) : (
                  <><RotateCcw className="w-4 h-4 mr-2" /> Reset ke Default</>
                )}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent data-testid="calibration-reset-confirm">
              <AlertDialogHeader>
                <AlertDialogTitle className="flex items-center gap-2">
                  <RotateCcw className="w-4 h-4" /> Reset Faktor Kalibrasi
                </AlertDialogTitle>
                <AlertDialogDescription>
                  Tindakan ini akan mengirim faktor default ke ESP32:
                  <span className="mt-2 block font-mono text-xs bg-muted rounded-md px-3 py-2">
                    v_calib = 11.0<br />
                    i_calib_dc = 1.0<br />
                    i_calib_ac = 1.0
                  </span>
                  Perangkat akan menerapkan pada polling berikutnya (maks. 5 menit).
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel data-testid="calibration-reset-cancel">Batal</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => void doResetDefaults()}
                  data-testid="calibration-reset-confirm-yes"
                >
                  Ya, Reset
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg" data-testid="calibration-wizard-modal">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wand2 className="w-4 h-4" /> Auto Calibration — Step {Math.min(step + 1, 4)} / 4
            </DialogTitle>
            <DialogDescription>
              Perangkat aktif: <code>{config.device_id}</code>
            </DialogDescription>
          </DialogHeader>

          {/* Stepper */}
          <div className="flex items-center gap-1 pt-1">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className={cn(
                  'flex-1 h-1 rounded-full',
                  i <= step ? 'bg-primary' : 'bg-muted'
                )}
              />
            ))}
          </div>

          <div className="pt-2">{renderStep()}</div>

          <DialogFooter className="flex-row justify-between sm:justify-between gap-2">
            <Button
              variant="ghost"
              onClick={() => setStep((s) => Math.max(0, s - 1))}
              disabled={step === 0 || publishing}
              data-testid="wiz-prev"
            >
              Sebelumnya
            </Button>
            {step < 3 ? (
              <Button
                onClick={() => setStep((s) => s + 1)}
                disabled={nextDisabled}
                data-testid="wiz-next"
              >
                Berikutnya
              </Button>
            ) : (
              <Button
                onClick={() => void doPublish()}
                disabled={publishing}
                data-testid="wiz-publish"
              >
                {publishing ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Publishing...</>
                ) : (
                  <><ShieldCheck className="w-4 h-4 mr-2" /> Publish ke ESP32</>
                )}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
