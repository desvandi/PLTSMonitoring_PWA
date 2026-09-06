'use client';

// =============================================================================
// Calibration Center — 3-point voltage calibration + ACS712 zero + SHT31 offset
// -----------------------------------------------------------------------------
// Brief §11-14, §59:
//   - Voltage calibration: 3 reference points (LOW ~45V, NOMINAL ~51V, FULL ~54V).
//     Operator applies known reference voltage (multimeter), reads raw ADC,
//     submits (reference, raw) to /api/calibration/voltage/point/{which}.
//   - ACS712 zero-cal: samples ~1s at zero current to determine ADC offset.
//     Triggered by POST /api/calibration/acs712/zero.
//   - SHT31 offset: small ±°C / ±% offset for ambient T/H.
//   - Versioned: every change bumps calibration.version + persists to NVS.
//   - All mutations require CSRF token (handled in api.ts) + requestId.
// =============================================================================

import { useState } from 'react';
import { useCalibration, useStatus } from '@/hooks/useApi';
import { api } from '@/lib/api';
import { useLanguage } from '@/components/providers/language-provider';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertTriangle, Gauge, Zap, Thermometer, Droplets, Save } from 'lucide-react';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

type PointKey = 'low' | 'nominal' | 'full';

export function CalibrationCenter() {
  const { t } = useLanguage();
  const { data: status } = useStatus();
  const { data: calibration, isLoading } = useCalibration();
  const qc = useQueryClient();

  // Form state — 3 voltage points
  const [refLow, setRefLow] = useState('');
  const [rawLow, setRawLow] = useState('');
  const [refNominal, setRefNominal] = useState('');
  const [rawNominal, setRawNominal] = useState('');
  const [refFull, setRefFull] = useState('');
  const [rawFull, setRawFull] = useState('');

  // SHT31 offsets
  const [tempOffset, setTempOffset] = useState('');
  const [humOffset, setHumOffset] = useState('');

  // Capture raw ADC reading from current telemetry (convenience)
  const captureRawFromLive = (which: PointKey) => {
    if (!status) return;
    const v = status.battery.voltage.value;
    if (v == null) {
      toast.error('Cannot capture — live voltage is invalid');
      return;
    }
    // [PARITY-3 2026-09-06] The firmware now exposes the live UNCALIBRATED
    // reading in GET /api/calibration as `voltageRaw` (volts, pre-3-point
    // map) — exactly the `raw` value the point routes expect. Prefill BOTH
    // fields when available; the reference stays the multimeter's job (we
    // prefill with the live value as a starting hint, the operator corrects
    // it with the real reference measurement).
    // Legacy firmware without voltageRaw: raw stays manual (honest note).
    const rawV = calibration?.voltageRaw;
    const rawPrefilled = rawV != null && Number.isFinite(rawV);
    if (which === 'low') {
      setRefLow(v.toFixed(2));
      if (rawPrefilled) setRawLow(rawV.toFixed(2));
    } else if (which === 'nominal') {
      setRefNominal(v.toFixed(2));
      if (rawPrefilled) setRawNominal(rawV.toFixed(2));
    } else {
      setRefFull(v.toFixed(2));
      if (rawPrefilled) setRawFull(rawV.toFixed(2));
    }
    toast.success(rawPrefilled
      ? `Captured: reference ${v.toFixed(2)}V (verify with multimeter), raw ${rawV.toFixed(2)}V (live uncalibrated reading)`
      : `Captured reference voltage: ${v.toFixed(2)}V (enter raw value manually — firmware < PARITY-3)`);
  };

  // Submit one voltage calibration point
  const submitPoint = async (which: PointKey) => {
    const ref = which === 'low' ? refLow : which === 'nominal' ? refNominal : refFull;
    const raw = which === 'low' ? rawLow : which === 'nominal' ? rawNominal : rawFull;
    const refN = parseFloat(ref);
    const rawN = parseFloat(raw);
    if (Number.isNaN(refN) || Number.isNaN(rawN)) {
      toast.error('Invalid reference or raw value');
      return;
    }
    try {
      await api.voltageCalibrationPoint(which, refN, rawN);
      toast.success(`Voltage calibration point ${which.toUpperCase()} saved`);
      qc.invalidateQueries({ queryKey: ['calibration'] });
      qc.invalidateQueries({ queryKey: ['status'] });
    } catch (e) {
      toast.error(`Calibration failed: ${e instanceof Error ? e.message : 'unknown'}`);
    }
  };

  // ACS712 zero-calibration (operator must ensure ZERO load on AC side)
  const runAcs712Zero = async () => {
    try {
      const r = await api.acs712ZeroCal();
      toast.success(`ACS712 zero-calibrated. New offset: ${r.newOffset.toFixed(2)}`);
      qc.invalidateQueries({ queryKey: ['calibration'] });
    } catch (e) {
      toast.error(`ACS712 zero-cal failed: ${e instanceof Error ? e.message : 'unknown'}`);
    }
  };

  // Save SHT31 offsets
  const saveSht31 = async () => {
    const tOff = parseFloat(tempOffset);
    const hOff = parseFloat(humOffset);
    const payload: { sht31TempOffset?: number; sht31HumOffset?: number } = {};
    if (!Number.isNaN(tOff)) payload.sht31TempOffset = tOff;
    if (!Number.isNaN(hOff)) payload.sht31HumOffset = hOff;
    if (Object.keys(payload).length === 0) {
      toast.error('Enter at least one offset value');
      return;
    }
    try {
      await api.updateCalibration(payload);
      toast.success('SHT31 offsets saved');
      qc.invalidateQueries({ queryKey: ['calibration'] });
    } catch (e) {
      toast.error(`SHT31 offset save failed: ${e instanceof Error ? e.message : 'unknown'}`);
    }
  };

  if (isLoading || !calibration) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-12 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-48 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  const cal = calibration; // request<Calibration> already unwraps
  const tz = status?.config.timezone;

  const points: Array<{
    key: PointKey;
    titleKey: string;
    ref: string;
    raw: string;
    setRef: (v: string) => void;
    setRaw: (v: string) => void;
    captured: typeof cal.voltageLow;
    icon: typeof Gauge;
    iconColor: string;
  }> = [
    {
      key: 'low',
      titleKey: t('calibration.voltage_low'),
      ref: refLow, raw: rawLow,
      setRef: setRefLow, setRaw: setRawLow,
      captured: cal.voltageLow,
      icon: Gauge, iconColor: 'text-status-error',
    },
    {
      key: 'nominal',
      titleKey: t('calibration.voltage_nominal'),
      ref: refNominal, raw: rawNominal,
      setRef: setRefNominal, setRaw: setRawNominal,
      captured: cal.voltageNominal,
      icon: Gauge, iconColor: 'text-status-on',
    },
    {
      key: 'full',
      titleKey: t('calibration.voltage_full'),
      ref: refFull, raw: rawFull,
      setRef: setRefFull, setRaw: setRawFull,
      captured: cal.voltageFull,
      icon: Gauge, iconColor: 'text-primary',
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Gauge className="w-6 h-6 text-primary" />
          {t('calibration.title')}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">{t('calibration.subtitle')}</p>
      </div>

      {/* Calibration metadata strip */}
      <Card className="border-border/60">
        <CardContent className="p-3 flex items-center justify-between text-xs flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <span className="text-muted-foreground uppercase tracking-wider">
              {t('calibration.version')}:
            </span>
            <span className="font-mono font-semibold">v{cal.version}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-muted-foreground uppercase tracking-wider">
              {t('calibration.timestamp')}:
            </span>
            <span className="font-mono">
              {cal.timestamp ? formatDateTime(cal.timestamp, tz) : '—'}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-muted-foreground uppercase tracking-wider">
              {t('calibration.source')}:
            </span>
            <Badge variant="outline" className="text-[9px] px-1.5 h-4">
              {cal.source ?? 'unknown'}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* 3-point voltage calibration grid */}
      <div>
        <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
          <Gauge className="w-4 h-4" />
          {t('calibration.voltage_3_point')}
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {points.map((p) => {
            const Icon = p.icon;
            return (
              <Card key={p.key} className="border-border/60">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Icon className={cn('w-4 h-4', p.iconColor)} />
                    {p.titleKey}
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Reference: {p.captured ? `${p.captured.reference.toFixed(2)}V` : '—'} · Raw: {p.captured ? p.captured.raw : '—'}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase tracking-wider">
                      {t('calibration.reference')} (V)
                    </Label>
                    <div className="flex gap-2">
                      <Input
                        type="number" step="0.01" placeholder="45.00"
                        value={p.ref} onChange={(e) => p.setRef(e.target.value)}
                      />
                      <Button
                        variant="outline" size="sm" type="button"
                        onClick={() => captureRawFromLive(p.key)}
                        title="Capture live voltage as reference"
                      >
                        Live
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase tracking-wider">
                      {t('calibration.raw')} (ADC counts)
                    </Label>
                    <Input
                      type="number" step="1" placeholder="2048"
                      value={p.raw} onChange={(e) => p.setRaw(e.target.value)}
                    />
                  </div>
                  <Button
                    size="sm" className="w-full"
                    onClick={() => submitPoint(p.key)}
                  >
                    <Save className="w-3 h-3 mr-1" />
                    {t('common.save')}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* ACS712 zero-calibration */}
      <Card className="border-border/60">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Zap className="w-4 h-4 text-status-warn" />
            {t('calibration.acs712_zero')}
          </CardTitle>
          <CardDescription className="text-xs">
            Current offset: {cal.acs712Offset?.toFixed(2) ?? '—'} · Sensitivity: {cal.acs712Sensitivity?.toFixed(3) ?? '—'} V/A
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-start gap-2 mb-3">
            <AlertTriangle className="w-4 h-4 text-status-warn mt-0.5 flex-shrink-0" />
            <p className="text-xs text-muted-foreground">
              Disconnect all AC load before running zero-calibration. The sensor
              samples ~1s of zero-current readings to determine the ADC offset.
            </p>
          </div>
          <Button variant="default" size="sm" onClick={runAcs712Zero}>
            <Zap className="w-3 h-3 mr-1" />
            Run Zero-Calibration
          </Button>
        </CardContent>
      </Card>

      {/* SHT31 offset */}
      <Card className="border-border/60">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Thermometer className="w-4 h-4 text-primary" />
            {t('calibration.sht31_offset')}
          </CardTitle>
          <CardDescription className="text-xs">
            Current offsets: T={cal.sht31TempOffset?.toFixed(2) ?? '0.00'}°C · H={cal.sht31HumOffset?.toFixed(2) ?? '0.00'}%
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-[10px] uppercase tracking-wider flex items-center gap-1">
                <Thermometer className="w-3 h-3" />
                Temperature offset (°C)
              </Label>
              <Input
                type="number" step="0.1" placeholder="0.0"
                value={tempOffset} onChange={(e) => setTempOffset(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] uppercase tracking-wider flex items-center gap-1">
                <Droplets className="w-3 h-3" />
                Humidity offset (%)
              </Label>
              <Input
                type="number" step="0.1" placeholder="0.0"
                value={humOffset} onChange={(e) => setHumOffset(e.target.value)}
              />
            </div>
          </div>
          <Button size="sm" onClick={saveSht31}>
            <Save className="w-3 h-3 mr-1" />
            {t('common.save')}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
