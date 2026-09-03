'use client';

// =============================================================================
// AC Output View — ACS712 AC current + estimated power (brief §26-28, §56)
// -----------------------------------------------------------------------------
// KEY DISCIPLINES:
//   - ACS712 measures AC CURRENT only. Power is ESTIMATED based on assumed
//     220V / 0.9 PF (configurable in DeviceConfig). The UI MUST visibly mark
//     estimated values (brief §91, §92 — "Never fake PV metrics").
//   - Signal quality (GOOD/DEGRADED/POOR/INVALID) reflects ACS712 noise floor
//     + sampling window integrity.
//   - NaN-safe: null → "N/A", never "0".
// =============================================================================

import { useStatus } from '@/hooks/useApi';
import { useLanguage } from '@/components/providers/language-provider';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertTriangle, Zap, AlertCircle, Gauge } from 'lucide-react';
import {
  QualityBadge,
  SourceBadge,
  FreshnessIndicator,
} from '@/components/dashboard/measurement-card';
import { fmtA, fmtW, fmtV, fmtWh } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { AcTelemetry, AcMeterMeasurement } from '@/lib/types';
import type { TranslationKey } from '@/lib/i18n';

const SIGNAL_QUALITY_LABEL: Record<AcTelemetry['signalQuality'], { color: string; key: string }> = {
  GOOD: { color: 'text-status-on', key: 'ac.signal_quality_good' },
  DEGRADED: { color: 'text-status-warn', key: 'ac.signal_quality_degraded' },
  POOR: { color: 'text-status-warn', key: 'ac.signal_quality_poor' },
  INVALID: { color: 'text-status-error', key: 'ac.signal_quality_invalid' },
  UNKNOWN: { color: 'text-muted-foreground', key: 'common.unknown' },
};

// v1.7.0 [W12-2] — PZEM locals (null → "N/A", never 0).
const fmtHz = (v: number | null) => (v != null ? `${v.toFixed(1)} Hz` : 'N/A');
const fmtPf = (v: number | null) => (v != null ? v.toFixed(2) : 'N/A');

function MeterSection({ meter, t }: { meter: AcMeterMeasurement; t: (key: TranslationKey) => string }) {
  if (!meter.connected) {
    // Honest absence: the firmware carries the meter but it stopped
    // answering — never fall back to a fabricated 0 W.
    return (
      <Card className="border-status-warn/40 bg-status-warn/5">
        <CardContent className="p-3 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-status-warn mt-0.5 flex-shrink-0" />
          <p className="text-xs text-status-warn">{t('ac.meter_disconnected')}</p>
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Gauge className="w-4 h-4 text-status-on" />
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          {t('ac.meter_title')}
        </h2>
        <span className="text-[10px] text-muted-foreground">{t('ac.meter_note')}</span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {/* Measured Power — MEASURED (PZEM-004T, headline) */}
        <Card className="border-status-on/30 bg-status-on/5">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">
                {t('ac.meter_power')}
              </p>
              <SourceBadge source="MEASURED" />
            </div>
            <p className="text-2xl font-bold font-mono text-status-on">
              {fmtW(meter.power)}
            </p>
            <p className="text-[10px] text-muted-foreground mt-1">PZEM-004T</p>
          </CardContent>
        </Card>
        {/* Measured Voltage */}
        <Card className="border-border/60">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">
                {t('ac.meter_voltage')}
              </p>
              <SourceBadge source="MEASURED" />
            </div>
            <p className="text-2xl font-bold font-mono">{fmtV(meter.voltage)}</p>
          </CardContent>
        </Card>
        {/* Frequency */}
        <Card className="border-border/60">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">
                {t('ac.meter_frequency')}
              </p>
              <SourceBadge source="MEASURED" />
            </div>
            <p className="text-2xl font-bold font-mono">{fmtHz(meter.frequency)}</p>
          </CardContent>
        </Card>
        {/* Measured Power Factor */}
        <Card className="border-border/60">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">
                {t('ac.meter_power_factor')}
              </p>
              <SourceBadge source="MEASURED" />
            </div>
            <p className="text-2xl font-bold font-mono">{fmtPf(meter.powerFactor)}</p>
          </CardContent>
        </Card>
      </div>
      {/* Cumulative import energy (PZEM register) */}
      <Card className="border-border/60">
        <CardContent className="p-3 flex items-center justify-between text-xs">
          <span className="text-muted-foreground uppercase tracking-wider">
            {t('ac.meter_energy')}:
          </span>
          <span className="font-mono font-semibold">{fmtWh(meter.energy)}</span>
        </CardContent>
      </Card>
    </div>
  );
}

export function AcOutputView() {
  const { t } = useLanguage();
  const { data: status, isLoading } = useStatus();

  if (isLoading || !status) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-12 w-64" />
        <Skeleton className="h-16 rounded-xl" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  const ac = status.ac;
  const sig = SIGNAL_QUALITY_LABEL[ac.signalQuality];
  const assumptions = ac.estimatedPower?.assumptions;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Zap className="w-6 h-6 text-primary" />
          {t('ac.title')}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">{t('ac.subtitle')}</p>
      </div>

      {/* Warning banner — estimated power disclaimer (brief §26-28) */}
      <Card className="border-status-warn/40 bg-status-warn/5">
        <CardContent className="p-3 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-status-warn mt-0.5 flex-shrink-0" />
          <p className="text-xs text-status-warn">
            {t('ac.estimated_power_disclaimer')}
          </p>
        </CardContent>
      </Card>

      {/* Assumptions strip */}
      {assumptions && (
        <Card className="border-border/60">
          <CardContent className="p-3 flex items-center justify-between text-xs">
            <span className="text-muted-foreground uppercase tracking-wider">
              {t('ac.assumed_voltage')}:
            </span>
            <span className="font-mono font-semibold">{assumptions.voltage} V</span>
            <span className="text-muted-foreground mx-3">·</span>
            <span className="text-muted-foreground uppercase tracking-wider">
              {t('ac.assumed_power_factor')}:
            </span>
            <span className="font-mono font-semibold">{assumptions.powerFactor}</span>
            <span className="text-muted-foreground mx-3">·</span>
            <span className="text-muted-foreground uppercase tracking-wider">
              {t('ac.signal_quality')}:
            </span>
            <span className={cn('font-mono font-semibold', sig.color)}>
              {t(sig.key as never)}
            </span>
          </CardContent>
        </Card>
      )}

      {/* Primary measurement grid — 4 cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {/* RMS Current — MEASURED */}
        <Card className="border-border/60">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">
                {t('ac.rms_current')}
              </p>
              <QualityBadge quality={ac.rmsCurrent.quality} />
            </div>
            <p className="text-2xl font-bold font-mono">
              {fmtA(ac.rmsCurrent.value)}
            </p>
            <FreshnessIndicator
              timestamp={ac.rmsCurrent.timestamp}
              intervalSec={status.config.telemetryIntervalSec}
            />
          </CardContent>
        </Card>

        {/* Peak Current — MEASURED */}
        <Card className="border-border/60">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">
                {t('ac.peak_current')}
              </p>
              <QualityBadge quality={ac.peakCurrent.quality} />
            </div>
            <p className="text-2xl font-bold font-mono">
              {fmtA(ac.peakCurrent.value)}
            </p>
            <FreshnessIndicator
              timestamp={ac.peakCurrent.timestamp}
              intervalSec={status.config.telemetryIntervalSec}
            />
          </CardContent>
        </Card>

        {/* Average Current — MEASURED */}
        <Card className="border-border/60">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">
                {t('ac.average_current')}
              </p>
              <QualityBadge quality={ac.averageCurrent.quality} />
            </div>
            <p className="text-2xl font-bold font-mono">
              {fmtA(ac.averageCurrent.value)}
            </p>
            <FreshnessIndicator
              timestamp={ac.averageCurrent.timestamp}
              intervalSec={status.config.telemetryIntervalSec}
            />
          </CardContent>
        </Card>

        {/* Estimated Power — ESTIMATED (always marked) */}
        <Card className="border-status-warn/30 bg-status-warn/5">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">
                {t('ac.estimated_power')}
              </p>
              <SourceBadge source="ESTIMATED" />
            </div>
            <p className="text-2xl font-bold font-mono text-status-warn">
              {fmtW(ac.estimatedPower?.value ?? null)}
            </p>
            <p className="text-[10px] text-muted-foreground mt-1">
              = V<sub>assumed</sub> × I<sub>rms</sub> × PF<sub>assumed</sub>
            </p>
          </CardContent>
        </Card>
      </div>

      {/* [W12-2 v1.7.0] — PZEM-004T real AC meter. Renders ONLY when the
          firmware reports the block (undefined = no meter — honest absence,
          the estimate above stays the headline). */}
      {ac.meter && <MeterSection meter={ac.meter} t={t} />}

      {/* Invalid signal warning */}
      {ac.signalQuality === 'INVALID' && (
        <Card className="border-status-error/40 bg-status-error/5">
          <CardContent className="p-3 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-status-error" />
            <p className="text-xs text-status-error">
              ACS712 signal quality is INVALID — current readings may be unreliable.
              Check sensor wiring and ADC calibration.
            </p>
          </CardContent>
        </Card>
      )}

      {/* [E-WAVE v1.7.0] — 2nd ACS712 channel (genset→inverter feed).
          Renders ONLY when the firmware reports it (undefined on < 1.6.0 —
          honest absence, never a fake 0 A). */}
      {ac.gensetRmsCurrent && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Card className="border-border/60">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-muted-foreground uppercase tracking-wider">
                  {t('emergency.acs_gen_title')}
                </p>
                <QualityBadge quality={ac.gensetRmsCurrent.quality} />
              </div>
              <p className="text-2xl font-bold font-mono">
                {fmtA(ac.gensetRmsCurrent.value)}
              </p>
              <FreshnessIndicator
                timestamp={ac.gensetRmsCurrent.timestamp}
                intervalSec={status.config.telemetryIntervalSec}
              />
            </CardContent>
          </Card>
          <Card className="border-status-warn/30 bg-status-warn/5">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-muted-foreground uppercase tracking-wider">
                  {t('ac.estimated_power')} (jenset)
                </p>
                <SourceBadge source="ESTIMATED" />
              </div>
              <p className="text-2xl font-bold font-mono text-status-warn">
                {fmtW(ac.gensetRmsCurrent.value != null ? ac.gensetRmsCurrent.value * 220 : null)}
              </p>
              <p className="text-[10px] text-muted-foreground mt-1">
                = V<sub>assumed</sub> × I<sub>rms</sub> (PF jenset tidak diukur)
              </p>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
