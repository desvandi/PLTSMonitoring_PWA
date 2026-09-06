'use client';

// =============================================================================
// Configuration Center — device + battery + alarm thresholds configuration
// -----------------------------------------------------------------------------
// [PARITY-4 2026-09-06] Every field below is a REAL authoritative contract:
//   - Device: name, site, timezone → POST /api/config/device (requestId +
//     transaction journal on the firmware side)
//   - Battery: capacityAh, fullV, lowV, idleCurrentThreshold,
//     fullChargeCurrentThreshold, fullChargePersistenceSec,
//     telemetryIntervalSec → POST /api/config (canonical command path)
//   - Alarm thresholds (two-tier): voltageLow/High Warn+Critical,
//     currentHigh Warn+Critical, temperatureHigh Warn+Critical,
//     humidityHighWarn, socLow Warn+Critical → POST /api/config — the SAME
//     field names the firmware persists in NVS "plts_alarm" and evaluates
//     live in AnomalyDetector. Served back flat + nested `alarmThresholds`.
//   - Export/Import: full config JSON (CRC32-protected; import carries an
//     X-Request-Id header so the firmware journals the transaction).
//   REMOVED (feature ghosts, registry F-SOC-002/F-CAL-002): the read-only
//   `socParams` and `calibrationParams` cards — no authoritative firmware
//   implementation ever existed; they only rendered from demo mock data.
// =============================================================================

import { useRef, useState } from 'react';
import { useConfig, useStatus } from '@/hooks/useApi';
import { api } from '@/lib/api';
import { useLanguage } from '@/components/providers/language-provider';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Settings, Battery, AlertTriangle, FileDown, FileUp, Save } from 'lucide-react';
import { formatDateTime } from '@/lib/format';
import { toast } from 'sonner';
import { deviceConfigOf } from '@/lib/config-shape';

// [PARITY-4] Two-tier alarm threshold fields — EXACT names of the firmware
// canonicalizer whitelist (config.update) and the NVS plts_alarm store.
const ALARM_FIELDS = [
  'voltageLowWarn', 'voltageLowCritical',
  'voltageHighWarn', 'voltageHighCritical',
  'currentHighWarn', 'currentHighCritical',
  'temperatureHighWarn', 'temperatureHighCritical',
  'humidityHighWarn',
  'socLowWarn', 'socLowCritical',
] as const;

type AlarmField = (typeof ALARM_FIELDS)[number];

const ALARM_META: { field: AlarmField; label: string; unit: string; step: string }[] = [
  { field: 'voltageLowWarn', label: 'Voltage Low Warn', unit: 'V', step: '0.1' },
  { field: 'voltageLowCritical', label: 'Voltage Low Critical', unit: 'V', step: '0.1' },
  { field: 'voltageHighWarn', label: 'Voltage High Warn', unit: 'V', step: '0.1' },
  { field: 'voltageHighCritical', label: 'Voltage High Critical', unit: 'V', step: '0.1' },
  { field: 'currentHighWarn', label: 'Current High Warn (|I|)', unit: 'A', step: '1' },
  { field: 'currentHighCritical', label: 'Current High Critical (|I|)', unit: 'A', step: '1' },
  { field: 'temperatureHighWarn', label: 'Temp High Warn', unit: '°C', step: '0.5' },
  { field: 'temperatureHighCritical', label: 'Temp High Critical', unit: '°C', step: '0.5' },
  { field: 'humidityHighWarn', label: 'Humidity High Warn', unit: '%', step: '1' },
  { field: 'socLowWarn', label: 'SOC Low Warn', unit: '%', step: '1' },
  { field: 'socLowCritical', label: 'SOC Low Critical', unit: '%', step: '1' },
];

export function ConfigurationCenter() {
  const { t } = useLanguage();
  const { data: status } = useStatus();
  const { data: configData, isLoading } = useConfig();
  const qc = useQueryClient();

  // Local form state — populated from config when loaded
  const [deviceName, setDeviceName] = useState('');
  const [siteName, setSiteName] = useState('');
  const [timezone, setTimezone] = useState('');
  const [batteryCapacityAh, setBatteryCapacityAh] = useState('');
  const [fullVoltage, setFullVoltage] = useState('');
  const [lowVoltage, setLowVoltage] = useState('');
  const [idleCurrentThreshold, setIdleCurrentThreshold] = useState('');
  const [fullChargeCurrentThreshold, setFullChargeCurrentThreshold] = useState('');
  const [fullChargePersistenceSec, setFullChargePersistenceSec] = useState('');
  const [telemetryIntervalSec, setTelemetryIntervalSec] = useState('');
  // [PARITY-4] two-tier alarm threshold form state (authoritative NVS
  // plts_alarm on the device; demo mock mirrors the same defaults).
  const [alarmForm, setAlarmForm] = useState<Record<string, string>>({});

  // [AUDIT 2026-08-28 G4] Pola resmi React "adjust state during render":
  // form disinkronkan dari configData SEKALI per identitas data (bukan via
  // useEffect). setState sinkron di dalam effect memicu cascading render —
  // di sini pembaruan terjadi pada render yang sama dengan data baru, tanpa
  // pass ekstra. Penanda syncedFrom mencegah reset saat re-render biasa
  // (ketika operator sedang mengetik).
  const [syncedFrom, setSyncedFrom] = useState<unknown>(configData);
  if (configData !== syncedFrom) {
    setSyncedFrom(configData);
    const c = configData ? deviceConfigOf(configData) : null;
    setDeviceName(c?.deviceName ?? '');
    setSiteName(c?.siteName ?? '');
    // deviceConfigOf sudah flatten: nested SystemConfig.config dilebur
    // + identitas top-level menang; mode firmware-flat kembali apa adanya.
    setTimezone(c?.timezone ?? '');
    setBatteryCapacityAh(String(c?.batteryCapacityAh ?? ''));
    setFullVoltage(String(c?.fullVoltage ?? ''));
    setLowVoltage(String(c?.lowVoltage ?? ''));
    setIdleCurrentThreshold(String(c?.idleCurrentThreshold ?? ''));
    setFullChargeCurrentThreshold(String(c?.fullChargeCurrentThreshold ?? ''));
    setFullChargePersistenceSec(String(c?.fullChargePersistenceSec ?? ''));
    setTelemetryIntervalSec(String(c?.telemetryIntervalSec ?? ''));
    // [PARITY-4] sync alarm form from the nested readback (flat and nested
    // are served with identical values by the firmware).
    const at = (c as { alarmThresholds?: Record<string, number> } | undefined)?.alarmThresholds;
    const nextForm: Record<string, string> = {};
    for (const k of ALARM_FIELDS) {
      const v = at?.[k];
      nextForm[k] = v != null && Number.isFinite(v) ? String(v) : '';
    }
    setAlarmForm(nextForm);
  }

  const saveDevice = async () => {
    try {
      await api.updateDevice({ deviceName, siteName, timezone });
      toast.success('Device settings saved');
      qc.invalidateQueries({ queryKey: ['config'] });
      qc.invalidateQueries({ queryKey: ['status'] });
    } catch (e) {
      toast.error(`Save failed: ${e instanceof Error ? e.message : 'unknown'}`);
    }
  };

  const saveBattery = async () => {
    const payload: Record<string, number> = {};
    const f = parseFloat(batteryCapacityAh);
    if (!Number.isNaN(f)) payload.batteryCapacityAh = f;
    const fv = parseFloat(fullVoltage);
    if (!Number.isNaN(fv)) payload.fullVoltage = fv;
    const lv = parseFloat(lowVoltage);
    if (!Number.isNaN(lv)) payload.lowVoltage = lv;
    const i = parseFloat(idleCurrentThreshold);
    if (!Number.isNaN(i)) payload.idleCurrentThreshold = i;
    const fc = parseFloat(fullChargeCurrentThreshold);
    if (!Number.isNaN(fc)) payload.fullChargeCurrentThreshold = fc;
    const fp = parseInt(fullChargePersistenceSec, 10);
    if (!Number.isNaN(fp)) payload.fullChargePersistenceSec = fp;
    const ti = parseInt(telemetryIntervalSec, 10);
    if (!Number.isNaN(ti)) payload.telemetryIntervalSec = ti;
    if (Object.keys(payload).length === 0) {
      toast.error('No values to save');
      return;
    }
    try {
      await api.updateConfig(payload);
      toast.success('Battery configuration saved');
      qc.invalidateQueries({ queryKey: ['config'] });
      qc.invalidateQueries({ queryKey: ['status'] });
    } catch (e) {
      toast.error(`Save failed: ${e instanceof Error ? e.message : 'unknown'}`);
    }
  };

  // [PARITY-4] Alarm thresholds — editable, flat field names EXACTLY as the
  // firmware canonicalizer whitelists them (config.update). Ranges + tier
  // order are validated by the device (and mirrored in demo mode by the
  // mock). Only numeric values the operator actually filled are sent.
  const saveAlarmThresholds = async () => {
    const payload: Record<string, number> = {};
    for (const k of ALARM_FIELDS) {
      const raw = alarmForm[k] ?? '';
      if (raw === '') continue;
      const f = parseFloat(raw);
      if (!Number.isNaN(f)) payload[k] = f;
    }
    if (Object.keys(payload).length === 0) {
      toast.error('No values to save');
      return;
    }
    try {
      await api.updateConfig(payload);
      toast.success('Alarm thresholds saved — applied live by the device');
      qc.invalidateQueries({ queryKey: ['config'] });
      qc.invalidateQueries({ queryKey: ['status'] });
    } catch (e) {
      toast.error(`Save failed: ${e instanceof Error ? e.message : 'unknown'}`);
    }
  };

  const exportConfig = async () => {
    try {
      const r = await api.exportConfig();
      const blob = new Blob([JSON.stringify(r, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `plts-config-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Config exported');
    } catch (e) {
      toast.error(`Export failed: ${e instanceof Error ? e.message : 'unknown'}`);
    }
  };

  // [PARITY-3 2026-09-06] The Import button was disabled ("Not implemented
  // in this build") while BOTH sides of the contract existed: firmware
  // POST /api/config/import (CRC32-verified, reboot required) and
  // deviceApi.importConfig — only the UI wiring was missing.
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [importing, setImporting] = useState(false);

  const importConfig = async (file: File) => {
    setImporting(true);
    try {
      const text = await file.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error('File bukan JSON yang valid.');
      }
      // Shape check: the device expects the export payload (config object
      // with batteryConfig/calibration/_crc keys — see ConfigStore.cpp).
      const obj = parsed as Record<string, unknown>;
      if (!obj || typeof obj !== 'object' || !('batteryConfig' in obj)) {
        throw new Error(
          'Struktur file tidak dikenali — gunakan file hasil Export dari perangkat (harus mengandung kunci batteryConfig).');
      }
      await api.importConfig(parsed as Parameters<typeof api.importConfig>[0]);
      toast.success('Config imported — perangkat butuh REBOOT untuk menerapkan (menu System → Reboot).');
      qc.invalidateQueries({ queryKey: ['config'] });
    } catch (e) {
      toast.error(`Import gagal: ${e instanceof Error ? e.message : 'unknown'}`);
    } finally {
      setImporting(false);
      if (importInputRef.current) importInputRef.current.value = '';
    }
  };

  if (isLoading || !configData) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-12 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-48 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  const c = deviceConfigOf(configData);
  const cfg = c;
  const tz = status?.config.timezone;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Settings className="w-6 h-6 text-primary" />
          {t('config.title')}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">{t('config.subtitle')}</p>
      </div>

      {/* Metadata strip */}
      <Card className="border-border/60">
        <CardContent className="p-3 flex items-center justify-between text-xs flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <span className="text-muted-foreground uppercase tracking-wider">
              {t('config.revision')}:
            </span>
            <span className="font-mono font-semibold">r{cfg.revision ?? '?'}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-muted-foreground uppercase tracking-wider">
              {t('config.source')}:
            </span>
            <Badge variant="outline" className="text-[9px] px-1.5 h-4">
              {cfg.source ?? 'unknown'}
            </Badge>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-muted-foreground uppercase tracking-wider">
              {t('config.checksum')}:
            </span>
            <span className="font-mono text-[10px]">
              {cfg.checksum ? cfg.checksum.slice(0, 12) + '…' : '—'}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-muted-foreground uppercase tracking-wider">
              Updated:
            </span>
            <span className="font-mono">
              {cfg.timestamp ? formatDateTime(cfg.timestamp, tz) : '—'}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Device settings */}
      <Card className="border-border/60">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Settings className="w-4 h-4 text-primary" />
            Device
          </CardTitle>
          <CardDescription className="text-xs">
            Operator-facing device identity + timezone.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-wider">
              {t('config.device_name')}
            </Label>
            <Input value={deviceName} onChange={(e) => setDeviceName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-wider">
              {t('config.site_name')}
            </Label>
            <Input value={siteName} onChange={(e) => setSiteName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-wider">
              {t('config.timezone')}
            </Label>
            <Input
              value={timezone} placeholder="Asia/Jakarta"
              onChange={(e) => setTimezone(e.target.value)}
            />
          </div>
          <div className="md:col-span-3">
            <Button size="sm" onClick={saveDevice}>
              <Save className="w-3 h-3 mr-1" />
              {t('common.save')}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Battery configuration */}
      <Card className="border-border/60">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Battery className="w-4 h-4 text-primary" />
            Battery
          </CardTitle>
          <CardDescription className="text-xs">
            15S LiFePO4 pack — nominal 48V, full 54V, low 45V.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-wider">
              {t('config.battery_capacity')} (Ah)
            </Label>
            <Input
              type="number" step="1"
              value={batteryCapacityAh}
              onChange={(e) => setBatteryCapacityAh(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-wider">
              {t('config.full_voltage')} (V)
            </Label>
            <Input
              type="number" step="0.1"
              value={fullVoltage}
              onChange={(e) => setFullVoltage(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-wider">
              {t('config.low_voltage')} (V)
            </Label>
            <Input
              type="number" step="0.1"
              value={lowVoltage}
              onChange={(e) => setLowVoltage(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-wider">
              {t('config.idle_current_threshold')} (A)
            </Label>
            <Input
              type="number" step="0.1"
              value={idleCurrentThreshold}
              onChange={(e) => setIdleCurrentThreshold(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-wider">
              {t('config.full_charge_current_threshold')} (A)
            </Label>
            <Input
              type="number" step="0.1"
              value={fullChargeCurrentThreshold}
              onChange={(e) => setFullChargeCurrentThreshold(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-wider">
              {t('config.full_charge_persistence')} (s)
            </Label>
            <Input
              type="number" step="1"
              value={fullChargePersistenceSec}
              onChange={(e) => setFullChargePersistenceSec(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-wider">
              {t('config.telemetry_interval')} (s)
            </Label>
            <Input
              type="number" step="1" min="1"
              value={telemetryIntervalSec}
              onChange={(e) => setTelemetryIntervalSec(e.target.value)}
            />
          </div>
          <div className="md:col-span-4 flex items-center gap-2 mt-2">
            <Button size="sm" onClick={saveBattery}>
              <Save className="w-3 h-3 mr-1" />
              {t('common.save')}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Alarm thresholds — EDITABLE (authoritative device config since
          PARITY-4; hidden honestly on firmware that does not serve them) */}
      {cfg.alarmThresholds ? (
        <Card className="border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-status-warn" />
              {t('config.alarm_thresholds')}
            </CardTitle>
            <CardDescription className="text-xs">
              {t('config.alarm_thresholds_note')}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {ALARM_META.map((m) => (
              <div key={m.field} className="space-y-1">
                <Label className="text-[10px] uppercase tracking-wider">
                  {m.label} ({m.unit})
                </Label>
                <Input
                  type="number"
                  step={m.step}
                  data-testid={`alarm-input-${m.field}`}
                  value={alarmForm[m.field] ?? ''}
                  onChange={(e) =>
                    setAlarmForm((prev) => ({ ...prev, [m.field]: e.target.value }))}
                />
              </div>
            ))}
            <div className="md:col-span-4 flex items-center gap-2 mt-2">
              <Button
                size="sm"
                data-testid="alarm-save-button"
                onClick={saveAlarmThresholds}
              >
                <Save className="w-3 h-3 mr-1" />
                {t('common.save')}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-border/60">
          <CardContent className="p-3 text-xs text-muted-foreground flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-muted-foreground shrink-0" />
            <span>
              {t('config.alarm_unavailable')}
            </span>
          </CardContent>
        </Card>
      )}

      {/* [PARITY-4 REMOVED] SOC params card deleted — socParams was a
          mockStore-only ghost (no authoritative firmware implementation,
          registry F-SOC-002). The REAL SOC sync knobs live in the Battery
          card: fullChargeCurrentThreshold + fullChargePersistenceSec. */}

      {/* Export / Import */}
      <Card className="border-border/60">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <FileDown className="w-4 h-4 text-primary" />
            Export / Import
          </CardTitle>
          <CardDescription className="text-xs">
            Full config JSON (CRC32-protected). Restore to a new device by uploading the file.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex gap-2">
          <Button variant="outline" size="sm" onClick={exportConfig}>
            <FileDown className="w-3 h-3 mr-1" />
            {t('common.export')}
          </Button>
          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            data-testid="config-import-file"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importConfig(f);
            }}
          />
          <Button
            variant="outline"
            size="sm"
            disabled={importing}
            data-testid="config-import-button"
            title="Upload the exported config JSON — device reboot required to apply"
            onClick={() => importInputRef.current?.click()}
          >
            <FileUp className="w-3 h-3 mr-1" />
            {importing ? 'Importing…' : t('common.import')}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
