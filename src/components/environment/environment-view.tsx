'use client';

// =============================================================================
// Environment View — SHT31 ambient T/H + dew point + condensation risk
// -----------------------------------------------------------------------------
// Brief §29-30, §57:
//   - Label is "Ambient / Enclosure Temperature" — NEVER "Battery Temperature"
//     (the SHT31 is in the enclosure, not on cells).
//   - Dew point computed via Magnus formula (DERIVED).
//   - Condensation risk: true if (temp - dew) < 3°C (warn) or ≤ 0°C (critical).
//   - NaN-safe: null → "N/A".
// =============================================================================

import { useStatus } from '@/hooks/useApi';
import { useLanguage } from '@/components/providers/language-provider';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Thermometer, Droplets, Wind, AlertTriangle } from 'lucide-react';
import {
  QualityBadge,
  SourceBadge,
  FreshnessIndicator,
} from '@/components/dashboard/measurement-card';
import { fmtTemp, fmtHum } from '@/lib/format';
import { cn } from '@/lib/utils';

export function EnvironmentView() {
  const { t } = useLanguage();
  const { data: status, isLoading } = useStatus();

  if (isLoading || !status) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-12 w-64" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  const env = status.environment;
  const dew = env.dewPoint;
  const tempVal = env.temperature.value;
  const condensationCritical =
    typeof dew === 'number' && typeof tempVal === 'number' && (tempVal - dew) <= 0;
  const condensationWarn =
    typeof dew === 'number' && typeof tempVal === 'number' && (tempVal - dew) <= 3 && !condensationCritical;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Thermometer className="w-6 h-6 text-primary" />
          {t('environment.title')}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">{t('environment.subtitle')}</p>
      </div>

      {/* Ambient label reminder (brief §29) */}
      <p className="text-xs text-muted-foreground uppercase tracking-wider">
        {env.label}
      </p>

      {/* Condensation risk banner */}
      {(condensationWarn || condensationCritical) && (
        <Card
          className={cn(
            'border-status-error/40',
            condensationCritical ? 'bg-status-error/10' : 'bg-status-warn/5 border-status-warn/40',
          )}
        >
          <CardContent className="p-3 flex items-start gap-2">
            <AlertTriangle
              className={cn(
                'w-4 h-4 mt-0.5 flex-shrink-0',
                condensationCritical ? 'text-status-error' : 'text-status-warn',
              )}
            />
            <p
              className={cn(
                'text-xs',
                condensationCritical ? 'text-status-error' : 'text-status-warn',
              )}
            >
              {t('environment.condensation_risk_warning')}
              {condensationCritical
                ? ' — CRITICAL: surface temperature below dew point!'
                : ' — WARNING: surface temperature within 3°C of dew point.'}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Primary 4-card grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {/* Temperature — MEASURED */}
        <Card className="border-border/60">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5">
                <Thermometer className="w-3.5 h-3.5 text-muted-foreground" />
                <p className="text-xs text-muted-foreground uppercase tracking-wider">
                  {t('environment.temperature')}
                </p>
              </div>
              <QualityBadge quality={env.temperature.quality} />
            </div>
            <p className="text-2xl font-bold font-mono">{fmtTemp(env.temperature.value)}</p>
            <FreshnessIndicator
              timestamp={env.temperature.timestamp}
              intervalSec={status.config.telemetryIntervalSec}
            />
          </CardContent>
        </Card>

        {/* Humidity — MEASURED */}
        <Card className="border-border/60">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5">
                <Droplets className="w-3.5 h-3.5 text-muted-foreground" />
                <p className="text-xs text-muted-foreground uppercase tracking-wider">
                  {t('environment.humidity')}
                </p>
              </div>
              <QualityBadge quality={env.humidity.quality} />
            </div>
            <p className="text-2xl font-bold font-mono">{fmtHum(env.humidity.value)}</p>
            <FreshnessIndicator
              timestamp={env.humidity.timestamp}
              intervalSec={status.config.telemetryIntervalSec}
            />
          </CardContent>
        </Card>

        {/* Dew Point — DERIVED (Magnus formula) */}
        <Card className="border-border/60">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5">
                <Wind className="w-3.5 h-3.5 text-muted-foreground" />
                <p className="text-xs text-muted-foreground uppercase tracking-wider">
                  {t('environment.dew_point')}
                </p>
              </div>
              <SourceBadge source="DERIVED" />
            </div>
            <p className="text-2xl font-bold font-mono">
              {dew == null ? 'N/A' : fmtTemp(dew)}
            </p>
            <p className="text-[10px] text-muted-foreground mt-1">
              Magnus formula (DERIVED from T + H)
            </p>
          </CardContent>
        </Card>

        {/* Condensation Risk indicator */}
        <Card
          className={cn(
            'border',
            condensationCritical
              ? 'border-status-error/40 bg-status-error/5'
              : condensationWarn
                ? 'border-status-warn/40 bg-status-warn/5'
                : 'border-border/60',
          )}
        >
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">
                {t('environment.condensation_risk')}
              </p>
              {condensationCritical && (
                <Badge variant="outline" className="text-[9px] border-status-error/40 text-status-error">
                  CRITICAL
                </Badge>
              )}
              {condensationWarn && !condensationCritical && (
                <Badge variant="outline" className="text-[9px] border-status-warn/40 text-status-warn">
                  WARNING
                </Badge>
              )}
              {!condensationCritical && !condensationWarn && (
                <Badge variant="outline" className="text-[9px] border-status-on/30 text-status-on">
                  OK
                </Badge>
              )}
            </div>
            <p className="text-2xl font-bold font-mono">
              {condensationCritical ? 'YES' : condensationWarn ? 'WARN' : 'NO'}
            </p>
            <p className="text-[10px] text-muted-foreground mt-1">
              {typeof tempVal === 'number' && typeof dew === 'number'
                ? `Δ = ${(tempVal - dew).toFixed(1)} °C (threshold: 3°C)`
                : 'N/A — sensor unavailable'}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
