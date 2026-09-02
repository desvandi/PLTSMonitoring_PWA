'use client';

// =============================================================================
// Dashboard View — 12 cards per brief §53.
// -----------------------------------------------------------------------------
// Cards:
//   1. System Health    (SystemState)
//   2. Battery V        (MEASURED)
//   3. Battery I        (MEASURED, signed)
//   4. Battery P        (DERIVED)
//   5. Charge State     (direction)
//   6. SOC              (ESTIMATED — visually marked)
//   7. Remaining Ah     (ESTIMATED)
//   8. Estimated Runtime (ESTIMATED)
//   9. AC Current       (MEASURED)
//  10. Temperature      (MEASURED, ambient)
//  11. Humidity         (MEASURED)
//  12. Active Alarms    (count)
//  + Footer: Telemetry Freshness
// =============================================================================

import { useLanguage } from '@/components/providers/language-provider';
import { useStatusAndRecord } from '@/hooks/useApi';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Battery,
  BatteryCharging,
  BatteryWarning,
  Zap,
  Activity,
  Thermometer,
  Droplets,
  AlertTriangle,
  Clock,
  Signal,
  Gauge,
  HelpCircle,
  Sun,
  Wind,
} from 'lucide-react';
import {
  formatUptime,
  formatTime,
  formatRssi,
  fmtPct,
  fmtAh,
  estimateRuntimeHours,
} from '@/lib/format';
import { cn } from '@/lib/utils';
import { MeasurementCard, FreshnessIndicator } from './measurement-card';
import { TruthStateBanner } from '@/components/layout/truth-state-banner';
import { useUiStore } from '@/lib/store';
import { useAuth } from '@/components/providers/auth-provider';
import type { Direction, SystemState } from '@/lib/types';

export function DashboardView() {
  const { t, lang } = useLanguage();
  // [PWA-10 REMEDIATION 2026-08] isError now surfaced — previously an API
  // failure rendered 12 skeletons FOREVER (isLoading || !status) with no
  // error state, retry affordance, or offline messaging.
  const { data: status, isLoading, isError, error, refetch } = useStatusAndRecord();
  const setView = useUiStore((s) => s.setView);
  const { isGasMode } = useAuth();

  // [AUDIT 2026-08-28 F9] GAS-cloud mode: the REST/MQTT status source is not
  // available by design (no ESP32 tunnel, no broker) — the live data path is
  // the Fleet view (direct GAS LATEST polling). Show an honest pointer
  // instead of a bare "Unauthorized" error.
  if (isError && isGasMode) {
    return (
      <div className="space-y-6">
        <TruthStateBanner online={false} timestamp={null} />
        <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
          <Sun className="h-10 w-10 text-primary" />
          <div>
            <h2 className="text-lg font-semibold">Mode GAS Cloud (Viewer)</h2>
            <p className="text-sm text-muted-foreground mt-1 max-w-lg">
              Panel kartu realtime ini membaca telemetri langsung dari ESP32 (REST/MQTT) —
              tidak tersedia di deployment zero-touch GAS. Data live perangkat Anda ada di
              <strong>Fleet Dashboard</strong> (polling langsung ke Google Apps Script), termasuk SOC + provenance.
            </p>
          </div>
          <button
            onClick={() => setView('fleet')}
            data-testid="dashboard-goto-fleet"
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Buka Fleet Dashboard
          </button>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-6">
        <TruthStateBanner online={false} timestamp={null} />
        <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
          <AlertTriangle className="h-10 w-10 text-destructive" />
          <div>
            <h2 className="text-lg font-semibold">{t('common.no_data')}</h2>
            <p className="text-sm text-muted-foreground mt-1 max-w-md break-words">
              {error instanceof Error ? error.message : 'Telemetry unavailable'}
            </p>
          </div>
          <button
            onClick={() => refetch()}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            {t('common.refresh')}
          </button>
        </div>
      </div>
    );
  }

  if (isLoading || !status) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-12 w-64" />
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {Array.from({ length: 12 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-24 rounded-xl" />
      </div>
    );
  }

  const rssi = formatRssi(status.health.wifiRssi);
  const runtimeHr = estimateRuntimeHours(
    status.battery.remainingAh,
    status.battery.power.value,
    status.battery.voltage.value,
  );
  const activeAlarms = status.activeAlarms;
  const criticalCount = activeAlarms.filter((a) => a.severity === 'CRITICAL').length;
  const warningCount = activeAlarms.filter((a) => a.severity === 'WARNING').length;

  return (
    <div className="space-y-6">
      {/* [P0-006/P1-015] Persistent truth-state banner: SIMULATION / NO_DATA /
          OFFLINE / STALE — the operator always knows WHAT they are looking at. */}
      <TruthStateBanner
        simulated={status.simulated === true}
        online={status.online}
        timestamp={status.timestamp}
      />

      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('dashboard.title')}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t('dashboard.subtitle')}</p>
      </div>

      {/* System Health strip */}
      <SystemHealthStrip state={status.health.systemState} highest={status.health.highestAlarmSeverity} />

      {/* Main 12-card grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {/* 1. Battery V */}
        <MeasurementCard
          label={t('battery.voltage')}
          measurement={status.battery.voltage}
          icon={Battery}
          showFreshness
        />
        {/* 2. Battery I (signed) */}
        <MeasurementCard
          label={t('battery.current')}
          measurement={status.battery.current}
          format="current"
          icon={status.battery.direction === 'CHARGING' ? BatteryCharging : status.battery.direction === 'DISCHARGING' ? BatteryWarning : status.battery.direction === 'IDLE' ? Battery : HelpCircle}
        />
        {/* 3. Battery P (derived) */}
        <MeasurementCard
          label={t('battery.power')}
          measurement={status.battery.power}
          format="power"
          icon={Zap}
        />
        {/* 4. Direction */}
        <DirectionCard direction={status.battery.direction} />
        {/* 5. SOC (estimated) */}
        <SocCard soc={status.battery.soc} onClick={() => setView('battery')} />
        {/* 6. Remaining Ah */}
        <Card className="border-border/60">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="rounded-lg bg-muted/50 p-1.5">
                <Battery className="w-3.5 h-3.5 text-muted-foreground" />
              </div>
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
                {t('dashboard.remaining_ah')}
              </p>
            </div>
            <p className="text-2xl font-bold font-mono">{fmtAh(status.battery.remainingAh)}</p>
            <Badge variant="outline" className="mt-2 text-[9px] px-1.5 h-4 border-status-warn/30 text-status-warn">
              ESTIMATED
            </Badge>
          </CardContent>
        </Card>
        {/* 7. Estimated Runtime */}
        <Card className="border-border/60">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="rounded-lg bg-muted/50 p-1.5">
                <Clock className="w-3.5 h-3.5 text-muted-foreground" />
              </div>
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
                {t('dashboard.runtime_estimation')}
              </p>
            </div>
            <p className="text-2xl font-bold font-mono">
              {runtimeHr != null ? `${runtimeHr.toFixed(1)}h` : 'N/A'}
            </p>
            <Badge variant="outline" className="mt-2 text-[9px] px-1.5 h-4 border-status-warn/30 text-status-warn">
              ESTIMATED
            </Badge>
          </CardContent>
        </Card>
        {/* 8. AC Current */}
        <MeasurementCard
          label={t('dashboard.ac_current')}
          measurement={status.ac.rmsCurrent}
          format="current"
          icon={Zap}
          onClick={() => setView('ac')}
        />
        {/* 9. Temperature (ambient) */}
        <MeasurementCard
          label={t('environment.temperature')}
          measurement={status.environment.temperature}
          format="temp"
          icon={Thermometer}
          onClick={() => setView('environment')}
        />
        {/* 10. Humidity */}
        <MeasurementCard
          label={t('environment.humidity')}
          measurement={status.environment.humidity}
          format="percent"
          icon={Droplets}
        />
        {/* 11. Active Alarms */}
        <Card
          className={cn(
            'border-border/60 cursor-pointer transition-colors hover:border-border',
            criticalCount > 0 && 'border-status-error/40 status-glow-on',
          )}
          onClick={() => setView('alarms')}
        >
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="rounded-lg bg-muted/50 p-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-muted-foreground" />
              </div>
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
                {t('dashboard.active_alarms')}
              </p>
            </div>
            <div className="flex items-baseline gap-2">
              <p className="text-2xl font-bold font-mono">{activeAlarms.length}</p>
              <div className="flex items-center gap-1 text-[10px]">
                {criticalCount > 0 && (
                  <Badge variant="outline" className="text-[9px] px-1.5 h-4 border-status-error/30 text-status-error">
                    {criticalCount} CRIT
                  </Badge>
                )}
                {warningCount > 0 && (
                  <Badge variant="outline" className="text-[9px] px-1.5 h-4 border-status-warn/30 text-status-warn">
                    {warningCount} WARN
                  </Badge>
                )}
                {activeAlarms.length === 0 && (
                  <Badge variant="outline" className="text-[9px] px-1.5 h-4 border-status-on/30 text-status-on">
                    NONE
                  </Badge>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
        {/* 12. Telemetry Freshness */}
        <Card className="border-border/60">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="rounded-lg bg-muted/50 p-1.5">
                <Activity className="w-3.5 h-3.5 text-muted-foreground" />
              </div>
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
                {t('dashboard.telemetry_freshness')}
              </p>
            </div>
            <FreshnessIndicator timestamp={status.timestamp} intervalSec={status.config.telemetryIntervalSec} />
            <p className="mt-2 text-[10px] text-muted-foreground font-mono">
              SEQ #{status.sequence}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* System info row */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
        <MiniStat icon={Clock} label={t('dashboard.uptime')} value={formatUptime(status.uptimeSeconds, lang)} />
        <MiniStat icon={Activity} label={t('dashboard.free_heap')} value={`${Math.round(status.health.freeHeap / 1024)} KB`} />
        <MiniStat icon={Signal} label={t('dashboard.wifi_rssi')} value={`${status.health.wifiRssi} dBm (${rssi.bars}/4)`} />
        <MiniStat
          icon={Clock}
          label={t('dashboard.current_time')}
          value={formatTime(status.timestamp, status.config.timezone, lang)}
          mono
        />
        <MiniStat icon={Gauge} label="EFC" value={status.battery.efc.toFixed(3)} mono />
        <MiniStat icon={Wind} label="Spool" value={String(status.health.spoolSize)} mono />
      </div>

      {/* No PV Production card — brief §92 explicitly forbids this. */}
    </div>
  );
}

function SystemHealthStrip({ state, highest }: { state: SystemState; highest: 'INFO' | 'WARNING' | 'CRITICAL' }) {
  const { t } = useLanguage();
  const map: Record<SystemState, { label: string; color: string; bg: string }> = {
    HEALTHY: { label: t('dashboard.healthy'), color: 'text-status-on', bg: 'bg-status-on/10 border-status-on/30' },
    WARNING: { label: t('dashboard.warning'), color: 'text-status-warn', bg: 'bg-status-warn/10 border-status-warn/30' },
    DEGRADED: { label: t('dashboard.degraded'), color: 'text-status-warn', bg: 'bg-status-warn/10 border-status-warn/40' },
    FAILED: { label: t('dashboard.failed'), color: 'text-status-error', bg: 'bg-status-error/10 border-status-error/40' },
    RECOVERING: { label: 'Recovering', color: 'text-status-info', bg: 'bg-status-info/10 border-status-info/30' },
    UNKNOWN: { label: t('common.unknown'), color: 'text-muted-foreground', bg: 'bg-muted' },
  };
  const m = map[state] ?? map.UNKNOWN;
  return (
    <Card className={cn('border', m.bg)}>
      <CardContent className="p-4 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Sun className={cn('w-5 h-5', m.color)} />
          <div>
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
              {t('dashboard.system_health')}
            </p>
            <p className={cn('text-lg font-bold', m.color)}>{m.label}</p>
          </div>
        </div>
        <Badge variant="outline" className={cn('text-xs', m.color)}>
          Highest Alarm: {highest}
        </Badge>
      </CardContent>
    </Card>
  );
}

function DirectionCard({ direction }: { direction: Direction }) {
  const { t } = useLanguage();
  const map = {
    CHARGING: {
      label: t('dashboard.charge_state'),
      icon: BatteryCharging,
      color: 'text-status-on',
      bg: 'bg-status-on/10',
    },
    DISCHARGING: {
      label: t('dashboard.discharge_state'),
      icon: BatteryWarning,
      color: 'text-status-warn',
      bg: 'bg-status-warn/10',
    },
    IDLE: {
      label: t('dashboard.idle_state'),
      icon: Battery,
      color: 'text-muted-foreground',
      bg: 'bg-muted',
    },
    UNKNOWN: {
      label: t('common.unknown'),
      icon: HelpCircle,
      color: 'text-muted-foreground',
      bg: 'bg-muted',
    },
  };
  const m = map[direction];
  const Icon = m.icon;
  return (
    <Card className="border-border/60">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-2">
          <div className="rounded-lg bg-muted/50 p-1.5">
            <Activity className="w-3.5 h-3.5 text-muted-foreground" />
          </div>
          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
            {t('battery.direction')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className={cn('rounded-lg p-2', m.bg)}>
            <Icon className={cn('w-5 h-5', m.color)} />
          </div>
          <p className={cn('text-lg font-bold', m.color)}>{m.label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function SocCard({
  soc,
  onClick,
}: {
  soc: import('@/lib/types').SocState;
  onClick: () => void;
}) {
  const { t } = useLanguage();
  const isSynced = soc.method === 'SYNCHRONIZED';
  return (
    <Card className="border-border/60 cursor-pointer hover:border-border" onClick={onClick}>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-2">
          <div className="rounded-lg bg-muted/50 p-1.5">
            <Gauge className="w-3.5 h-3.5 text-muted-foreground" />
          </div>
          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
            {t('dashboard.soc')}
          </p>
        </div>
        <p className="text-2xl font-bold font-mono">{fmtPct(soc.value)}</p>
        <div className="mt-2 flex flex-wrap gap-1">
          <Badge variant="outline" className={cn(
            'text-[9px] px-1.5 h-4',
            isSynced ? 'border-status-on/30 text-status-on' : 'border-status-warn/30 text-status-warn',
          )}>
            {isSynced ? 'SYNCED' : 'ESTIMATED'}
          </Badge>
          <Badge variant="outline" className="text-[9px] px-1.5 h-4 border-status-info/30 text-status-info">
            {soc.source.replace('_', ' ')}
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}

function MiniStat({
  icon: Icon,
  label,
  value,
  mono,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border/40 bg-card/50">
      <Icon className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-[10px] text-muted-foreground truncate">{label}</p>
        <p className={cn('text-xs font-semibold truncate', mono && 'font-mono')}>{value}</p>
      </div>
    </div>
  );
}
