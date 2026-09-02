'use client';

// =============================================================================
// Shared measurement display components.
// -----------------------------------------------------------------------------
// KEY DISCIPLINES:
//   1. null → "N/A", never "0".
//   2. Text label + color (never color alone) — accessibility §37.
//   3. Distinguish MEASURED / DERIVED / ESTIMATED visually (badge color).
//   4. STALE data visibly marked with timestamp.
//   5. UNAVAILABLE card when subsystem omitted.
// =============================================================================

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import {
  computeFreshness,
  effectiveQuality,
  type DataFreshness,
  type Measurement,
  type MeasurementQuality,
  type MeasurementSource,
} from '@/lib/types';
import type { TranslationKey } from '@/lib/i18n';
import { useLanguage } from '@/components/providers/language-provider';
import { fmtV, fmtA, fmtW, fmtPct, fmtTemp, formatRelativeTime } from '@/lib/format';
import { AlertCircle, Clock, HelpCircle } from 'lucide-react';
import { ReactNode } from 'react';

export function QualityBadge({ quality }: { quality: MeasurementQuality }) {
  const { t } = useLanguage();
  const map: Record<MeasurementQuality, { color: string; dot: string }> = {
    VALID: { color: 'border-status-on/30 text-status-on', dot: 'status-dot-on' },
    STALE: { color: 'border-status-warn/30 text-status-warn', dot: 'status-dot-warn' },
    INVALID: { color: 'border-status-error/30 text-status-error', dot: 'status-dot-error' },
    OUT_OF_RANGE: { color: 'border-status-error/30 text-status-error', dot: 'status-dot-error' },
    SENSOR_ERROR: { color: 'border-status-error/30 text-status-error', dot: 'status-dot-error' },
    NOT_AVAILABLE: { color: 'opacity-50', dot: 'status-dot-off' },
    ESTIMATED: { color: 'border-status-warn/30 text-status-warn', dot: 'status-dot-warn' },
    DERIVED: { color: 'border-status-info/30 text-status-info', dot: 'status-dot-info' },
    CALIBRATING: { color: 'border-status-warn/30 text-status-warn', dot: 'status-dot-warn' },
    SUSPECT: { color: 'border-status-warn/30 text-status-warn', dot: 'status-dot-warn' },
  };
  const m = map[quality];
  return (
    <Badge variant="outline" className={cn('text-[9px] px-1.5 h-4', m.color)}>
      <span className={cn('status-dot mr-1', m.dot)} style={{ width: 5, height: 5 }} />
      {t(`quality.${quality}` as TranslationKey)}
    </Badge>
  );
}

export function SourceBadge({ source }: { source: MeasurementSource }) {
  const { t } = useLanguage();
  const map: Record<MeasurementSource, { color: string }> = {
    MEASURED: { color: 'border-status-on/30 text-status-on' },
    DERIVED: { color: 'border-status-info/30 text-status-info' },
    ESTIMATED: { color: 'border-status-warn/30 text-status-warn' },
  };
  const m = map[source];
  const key: TranslationKey = source === 'MEASURED' ? 'common.measured' : source === 'DERIVED' ? 'common.derived' : 'common.estimated';
  return (
    <Badge variant="outline" className={cn('text-[9px] px-1.5 h-4', m.color)}>
      {t(key)}
    </Badge>
  );
}

// [P1-015 REMEDIATION 2026-08] Freshness ladder — LIVE (<10 s) / DELAYED
// (10–60 s) / STALE (≥60 s) / NO_DATA — replacing the old binary
// "fresh vs 2×interval" check. The displayed quality is the EFFECTIVE quality
// (P1-011): a STALE envelope can never render as VALID, whatever the payload
// claims about itself.
export function FreshnessIndicator({
  timestamp,
}: {
  timestamp: number;
  /** Accepted for API compatibility (dashboard-view still passes it) but the
   * P1-015 freshness ladder is fixed by design: LIVE <10 s / DELAYED 10-60 s /
   * STALE >=60 s — it deliberately ignores the configured interval. */
  intervalSec?: number;
}) {
  const { t, lang } = useLanguage();
  const freshness: DataFreshness = computeFreshness(timestamp);
  if (freshness === 'NO_DATA') {
    return (
      <div className="flex items-center gap-1.5 text-[10px] text-status-error">
        <Clock className="w-3 h-3" />
        <span>{t('common.no_data')}</span>
      </div>
    );
  }
  if (freshness === 'STALE' || freshness === 'DELAYED') {
    return (
      <div
        className={cn(
          'flex items-center gap-1.5 text-[10px]',
          freshness === 'STALE' ? 'text-status-warn' : 'text-muted-foreground',
        )}
      >
        <Clock className="w-3 h-3" />
        <span>{freshness === 'STALE' ? t('common.stale') : t('common.delayed')}</span>
        <span className="text-muted-foreground">·</span>
        <span>{formatRelativeTime(timestamp, lang)}</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5 text-[10px] text-status-on">
      <Clock className="w-3 h-3" />
      <span>{t('common.fresh')}</span>
    </div>
  );
}

// Wrapper for an unavailable subsystem (brief v4.1.1 audit fix).
export function UnavailableCard({
  label,
  reason,
  icon: Icon,
}: {
  label: string;
  reason?: string;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <Card className="border-dashed border-border/50 opacity-70">
      <CardContent className="p-4 flex items-center gap-3">
        {Icon ? (
          <div className="rounded-lg bg-muted p-2">
            <Icon className="w-4 h-4 text-muted-foreground" />
          </div>
        ) : (
          <div className="rounded-lg bg-muted p-2">
            <HelpCircle className="w-4 h-4 text-muted-foreground" />
          </div>
        )}
        <div className="flex-1">
          <p className="text-xs font-semibold text-muted-foreground">{label}</p>
          <p className="text-[10px] text-muted-foreground">{reason ?? 'Subsystem omitted'}</p>
        </div>
        <Badge variant="outline" className="text-[9px] px-1.5 h-4 opacity-60">
          <AlertCircle className="w-2.5 h-2.5 mr-1" />
          UNAVAILABLE
        </Badge>
      </CardContent>
    </Card>
  );
}

// Generic measurement display card — renders value + unit + quality badge + source badge.
export function MeasurementCard({
  label,
  measurement,
  unit,
  format = 'voltage',
  icon: Icon,
  showFreshness = false,
  extra,
  onClick,
}: {
  label: string;
  measurement: Measurement<number> | null | undefined;
  unit?: string;
  format?: 'voltage' | 'current' | 'power' | 'percent' | 'temp';
  icon?: React.ComponentType<{ className?: string }>;
  showFreshness?: boolean;
  extra?: ReactNode;
  onClick?: () => void;
}) {
  if (!measurement) {
    return <UnavailableCard label={label} />;
  }
  // [P1-011] Effective quality: merge the payload's claim with the age ladder
  // computed by the PWA itself — stale data is NEVER displayed as VALID.
  const freshness = computeFreshness(measurement.timestamp);
  const effective = effectiveQuality(measurement.quality, freshness);
  const u = unit ?? measurement.unit;
  let valueStr: string;
  switch (format) {
    case 'current':
      valueStr = fmtA(measurement.value);
      break;
    case 'power':
      valueStr = fmtW(measurement.value);
      break;
    case 'percent':
      valueStr = fmtPct(measurement.value);
      break;
    case 'temp':
      valueStr = fmtTemp(measurement.value);
      break;
    default:
      valueStr = fmtV(measurement.value, u);
  }
  return (
    <Card
      className={cn(
        'border-border/60 transition-colors',
        onClick && 'cursor-pointer hover:border-border hover:bg-accent/30',
      )}
      onClick={onClick}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex items-center gap-2">
            {Icon && (
              <div className="rounded-lg bg-muted/50 p-1.5">
                <Icon className="w-3.5 h-3.5 text-muted-foreground" />
              </div>
            )}
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider truncate">
              {label}
            </p>
          </div>
          <QualityBadge quality={effective} />
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-2xl font-bold font-mono">{valueStr}</p>
          <SourceBadge source={measurement.source} />
        </div>
        {showFreshness && (
          <div className="mt-2 pt-2 border-t border-border/40">
            <FreshnessIndicator timestamp={measurement.timestamp} />
          </div>
        )}
        {extra && <div className="mt-2 pt-2 border-t border-border/40">{extra}</div>}
      </CardContent>
    </Card>
  );
}
