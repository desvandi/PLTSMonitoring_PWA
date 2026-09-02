'use client';

// =============================================================================
// Energy Analytics View — charge/discharge Wh + Ah + EFC + net energy
// -----------------------------------------------------------------------------
// Brief §58 — Energy counters + Equivalent Full Cycles + Estimated usable capacity.
// Display disciplines:
//   - Charge Wh / Discharge Wh / Net Wh (signed)
//   - Charge Ah / Discharge Ah / Net Ah (signed)
//   - EFC = total discharge Ah / nominal capacity Ah
//   - Counters are PERSISTENT across reboots (saved to NVS every PERSIST_INTERVAL_MS)
// =============================================================================

import { useEffect, useState } from 'react';
import { useStatusAndRecord } from '@/hooks/useApi';
import { useLanguage } from '@/components/providers/language-provider';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import {
  BatteryCharging,
  BatteryWarning,
  TrendingUp,
  TrendingDown,
  Activity,
  Gauge,
  RefreshCw,
} from 'lucide-react';
import {
  fmtWh,
  fmtAh,
} from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  PowerChart, SocChart, type ChartPoint,
} from '@/components/charts';
import { getRecentSamples } from '@/lib/energyHistory';

export function EnergyAnalyticsView() {
  const { t } = useLanguage();
  const { data: status, isLoading } = useStatusAndRecord();
  const [powerData, setPowerData] = useState<ChartPoint[]>([]);
  const [socData, setSocData] = useState<ChartPoint[]>([]);

  useEffect(() => {
    const refresh = () => {
      const samples = getRecentSamples(24);  // last 24h
      setPowerData(samples.map((s) => ({ ts: s.ts, value: s.battP })));
      setSocData(samples.map((s) => ({ ts: s.ts, value: s.soc })));
    };
    refresh();
    const id = setInterval(refresh, 10_000);
    return () => clearInterval(id);
  }, []);

  if (isLoading || !status) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-12 w-64" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  const b = status.battery;
  const efc = b.efc;
  const capacityAh = status.config.batteryCapacityAh;
  const efcComputed = capacityAh > 0 ? (b.dischargeAh / capacityAh) : null;

  // Card definition — separated by energy (Wh) and charge (Ah)
  const energyCards = [
    {
      label: t('energy.charge_wh'),
      value: fmtWh(b.chargeWh),
      icon: BatteryCharging,
      color: 'text-status-on',
      bg: 'bg-status-on/5',
    },
    {
      label: t('energy.discharge_wh'),
      value: fmtWh(b.dischargeWh),
      icon: BatteryWarning,
      color: 'text-status-warn',
      bg: 'bg-status-warn/5',
    },
    {
      label: t('energy.net_wh'),
      value: fmtWh(b.netWh),
      icon: b.netWh >= 0 ? TrendingUp : TrendingDown,
      color: b.netWh >= 0 ? 'text-status-on' : 'text-status-warn',
      bg: b.netWh >= 0 ? 'bg-status-on/5' : 'bg-status-warn/5',
    },
    {
      label: t('energy.charge_ah'),
      value: fmtAh(b.chargeAh),
      icon: Activity,
      color: 'text-status-on',
      bg: 'bg-status-on/5',
    },
    {
      label: t('energy.discharge_ah'),
      value: fmtAh(b.dischargeAh),
      icon: Activity,
      color: 'text-status-warn',
      bg: 'bg-status-warn/5',
    },
    {
      label: t('energy.efc'),
      value: efc != null ? efc.toFixed(2) : 'N/A',
      icon: Gauge,
      color: 'text-primary',
      bg: 'bg-primary/5',
      subtitle: efcComputed != null
        ? `${t('battery.discharge_ah')} / ${capacityAh}Ah = ${efcComputed.toFixed(2)}`
        : undefined,
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Activity className="w-6 h-6 text-primary" />
          {t('energy.title')}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">{t('energy.subtitle')}</p>
      </div>

      {/* Energy cards — 6 in 3x2 grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {energyCards.map((c, i) => {
          const Icon = c.icon;
          return (
            <Card key={i} className={cn('border-border/60', c.bg)}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">
                    {c.label}
                  </p>
                  <Icon className={cn('w-3.5 h-3.5', c.color)} />
                </div>
                <p className={cn('text-2xl font-bold font-mono', c.color)}>
                  {c.value}
                </p>
                {c.subtitle && (
                  <p className="text-[10px] text-muted-foreground mt-1">{c.subtitle}</p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Power trend chart — last 24h */}
      <Card className="border-border/60">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-primary" />
              {t('battery.power')} — 24h trend
            </span>
            <Badge variant="outline" className="text-[9px] px-1.5 h-4 border-status-info/30 text-status-info">
              DERIVED
            </Badge>
          </CardTitle>
          <CardDescription className="text-xs">
            Signed power (W) — positive = charging, negative = discharging.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PowerChart data={powerData} />
        </CardContent>
      </Card>

      {/* Energy chart (cumulative) */}
      <Card className="border-border/60">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Gauge className="w-4 h-4 text-primary" />
            SOC trend — 24h
          </CardTitle>
        </CardHeader>
        <CardContent>
          <SocChart data={socData} />
        </CardContent>
      </Card>

      {/* Counter reset info */}
      <Card className="border-border/40 bg-muted/30">
        <CardContent className="p-3 flex items-center justify-between text-xs">
          <div className="text-muted-foreground">
            Counters persist across reboots (saved every 60s to NVS).
            Reset is operator-initiated only (two-step confirmation).
          </div>
          <Button variant="ghost" size="sm" className="h-7 text-xs" disabled>
            <RefreshCw className="w-3 h-3 mr-1" />
            Reset Counters (two-step)
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
