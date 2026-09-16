'use client';

// =============================================================================
// EmergencyControlView — operator panel for the emergency relay (WAVE-7).
// -----------------------------------------------------------------------------
// Data path (GAS-cloud mode, the deployed configuration):
//   Status  ← useFleetStatus() → LATEST envelope (emergency block + currents)
//   Command → sendEmergencyCommand() → GAS EMERGENCY_COMMAND (ADMIN_TOKEN)
//             → device consumes via TELEMETRY piggyback / 15 s poll → ACK
//   Log     ← fetchEmergencyLog() → GAS EMERGENCY_LOG (newest-first)
//
// UX safety:
//   - DISARM (EMERGENCY STOP) requires a typed confirmation ("STOP").
//   - ARM is a single click but shows the device-side rejection reason when
//     the local gate denies it (trigger active / recovery window / crash hold).
//   - The panel NEVER fakes state: UNKNOWN firmware → honest "tidak diketahui".
// =============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSysConfig } from '@/components/providers/sys-config-provider';
import { useAuth } from '@/components/providers/auth-provider';
import { useFleetStatus } from '@/hooks/useFleetStatus';
import { useLanguage } from '@/components/providers/language-provider';
import { useToast } from '@/hooks/use-toast';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  ShieldCheck,
  ShieldAlert,
  OctagonAlert,
  HelpCircle,
  RefreshCw,
  History,
  SlidersHorizontal,
} from 'lucide-react';
import {
  sendEmergencyCommand,
  fetchEmergencyLog,
  normalizeEmergencyConfig,
  EMERGENCY_CONFIG_FIELDS,
  DEFAULT_EMERGENCY_CONFIG,
  type EmergencyConfig,
  type EmergencyEventEntry,
} from '@/lib/emergency';
// [P1-3 REMEDIATION 2026-09] the operator ADMIN_TOKEN lives in the
// session-scoped store — the persisted profile no longer carries it.
import { resolveAdminToken } from '@/lib/adminTokenSession';
import { EnergyFlowDiagram } from './energy-flow-diagram';
import { cn } from '@/lib/utils';

const STOP_WORD = 'STOP';

export function EmergencyControlView() {
  const { t } = useLanguage();
  const { config } = useSysConfig();
  const { statuses, refresh } = useFleetStatus(15000);
  const { toast } = useToast();

  const [disarmOpen, setDisarmOpen] = useState(false);
  const [disarmWord, setDisarmWord] = useState('');
  const [sending, setSending] = useState<'ARM' | 'DISARM' | 'CONFIG' | null>(null);
  const [events, setEvents] = useState<EmergencyEventEntry[]>([]);
  const [eventsMsg, setEventsMsg] = useState('');
  const [showConfig, setShowConfig] = useState(false);
  const [draftConfig, setDraftConfig] = useState<EmergencyConfig>(DEFAULT_EMERGENCY_CONFIG);

  // [P1-3 REMEDIATION 2026-09] admin token resolves from the SESSION store —
  // a new tab honestly reports "not set" until the operator re-enters it
  // (fail-closed), instead of silently remembering a permanent secret.
  const device = useMemo(() => {
    const base = config?.devices.find((d) => d.device_id === config.active_device_id) ?? null;
    if (!base) return null;
    return { ...base, admin_token: resolveAdminToken(base) };
  }, [config]);
  const status = useMemo(
    () => statuses.find((s) => s.device.device_id === config?.active_device_id) ?? null,
    [statuses, config?.active_device_id],
  );
  const telemetry = status?.telemetry ?? null;

  // --- Event log (refresh on device change + after commands) ---
  const loadEvents = useCallback(async () => {
    if (!device) return;
    const res = await fetchEmergencyLog(device, 12);
    setEvents(res.ok ? res.events : []);
    setEventsMsg(res.ok ? '' : res.message);
  }, [device]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!device) return;
      const res = await fetchEmergencyLog(device, 12);
      if (cancelled) return;
      setEvents(res.ok ? res.events : []);
      setEventsMsg(res.ok ? '' : res.message);
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [device]);

  // --- Commands ---
  // [p.485b REMEDIATION 2026-09] Command-layer role check (defense-in-depth):
  // the view itself is operator-only (OperatorViewGuard + OPERATOR_ONLY_VIEWS),
  // but runCommand independently refuses to build an emergency payload for a
  // viewer-scoped session — UI gating alone is not an authorization boundary.
  const { session } = useAuth();
  const runCommand = useCallback(
    async (command: "ARM" | "DISARM" | "CONFIG", opts?: { note?: string; config?: EmergencyConfig }) => {
      if (!device) return;
      if (session.role === 'viewer') {
        toast({
          title: t('emergency.cmd_failed'),
          description:
            'Emergency commands require an operator session — this session is viewer-scoped (read-only).',
        });
        return;
      }
      setSending(command);
      const res = await sendEmergencyCommand(device, command, opts);
      setSending(null);
      toast({
        title: res.ok ? t('emergency.cmd_queued') : t('emergency.cmd_failed'),
        description: res.message + (res.ok ? ' — ' + t('emergency.cmd_latency_note') : ''),
      });
      if (res.ok) {
        setDisarmOpen(false);
        setDisarmWord('');
        // Refresh the fleet status + log after a short delay (the device
        // consumes the command within ≤15 s).
        setTimeout(() => {
          void refresh();
          void loadEvents();
        }, 4000);
        setTimeout(() => {
          void refresh();
          void loadEvents();
        }, 16000);
      }
    },
    [device, session.role, toast, t, refresh, loadEvents],
  );

  if (!device) {
    return (
      <div className="p-4 space-y-4">
        <h2 className="text-2xl font-bold">{t('emergency.title')}</h2>
        <Card className="p-6">
          <p className="text-sm text-muted-foreground">{t('emergency.no_device')}</p>
        </Card>
      </div>
    );
  }

  const state = telemetry?.emg_state ?? 'UNKNOWN';
  const stateBadge =
    state === 'RUN' ? (
      <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/40 gap-1.5">
        <ShieldCheck className="w-3.5 h-3.5" /> {t('emergency.state_run')}
      </Badge>
    ) : state === 'EMERGENCY' ? (
      <Badge className="bg-red-500/15 text-red-400 border-red-500/40 gap-1.5">
        <OctagonAlert className="w-3.5 h-3.5" /> {t('emergency.state_isolated')}
      </Badge>
    ) : (
      <Badge className="bg-muted text-muted-foreground border-border gap-1.5">
        <HelpCircle className="w-3.5 h-3.5" /> {t('emergency.state_unknown')}
      </Badge>
    );

  return (
    <div className="p-4 space-y-4 max-w-3xl">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">{t('emergency.title')}</h2>
        <Button variant="outline" size="sm" onClick={() => { void refresh(); void loadEvents(); }}>
          <RefreshCw className="w-4 h-4 mr-1" /> {t('common.refresh')}
        </Button>
      </div>

      {/* Status hero */}
      <Card className={cn(
        'p-5 space-y-4 border-2',
        state === 'EMERGENCY' && 'border-red-500/50',
        state === 'RUN' && 'border-emerald-500/40',
      )}>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            {stateBadge}
            <div className="text-sm text-muted-foreground">
              {device.label}
              <span className="mx-1.5 opacity-50">·</span>
              <code className="text-xs">{device.device_id}</code>
            </div>
          </div>
          {telemetry?.emg_trips != null && (
            <div className="text-xs text-muted-foreground">
              {t('emergency.trips')}: <span className="font-semibold text-foreground">{telemetry.emg_trips}</span>
            </div>
          )}
        </div>

        {(state === 'EMERGENCY' || telemetry?.emg_reason) && (
          <div className="text-sm">
            <span className="text-muted-foreground">{t('emergency.last_reason')}: </span>
            <span className={cn('font-mono', state === 'EMERGENCY' ? 'text-red-400' : 'text-muted-foreground')}>
              {telemetry?.emg_reason ?? '—'}
            </span>
          </div>
        )}
        {telemetry?.emg_estop === true && (
          <div className="text-sm text-amber-400 flex items-center gap-2">
            <ShieldAlert className="w-4 h-4" /> {t('emergency.estop_open')}
          </div>
        )}
        {state === 'UNKNOWN' && (
          <p className="text-xs text-muted-foreground leading-relaxed">
            {t('emergency.unknown_note')}
          </p>
        )}

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-3 pt-1">
          {!disarmOpen ? (
            <>
              <Button
                variant="outline"
                disabled={state !== 'EMERGENCY' || sending !== null}
                onClick={() => void runCommand('ARM')}
                className="gap-2"
              >
                <ShieldCheck className="w-4 h-4" />
                {sending === 'ARM' ? t('common.loading') : t('emergency.arm')}
              </Button>
              <Button
                variant="destructive"
                disabled={state === 'UNKNOWN' || state === 'EMERGENCY' || sending !== null}
                onClick={() => setDisarmOpen(true)}
                className="gap-2"
              >
                <OctagonAlert className="w-4 h-4" />
                {t('emergency.disarm')}
              </Button>
            </>
          ) : (
            <div className="w-full space-y-2 rounded-lg border border-red-500/40 bg-red-500/5 p-3">
              <p className="text-sm font-medium text-red-400">{t('emergency.disarm_confirm')}</p>
              <div className="flex items-center gap-2">
                <Input
                  value={disarmWord}
                  onChange={(e) => setDisarmWord(e.target.value.toUpperCase())}
                  placeholder={t('emergency.type_stop')}
                  className="max-w-[180px] font-mono"
                  aria-label={t('emergency.type_stop')}
                />
                <Button
                  variant="destructive"
                  disabled={disarmWord !== STOP_WORD || sending !== null}
                  onClick={() => void runCommand('DISARM', { note: 'operator emergency stop' })}
                >
                  {sending === 'DISARM' ? t('common.loading') : t('emergency.disarm_go')}
                </Button>
                <Button variant="ghost" onClick={() => { setDisarmOpen(false); setDisarmWord(''); }}>
                  {t('common.cancel')}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">{t('emergency.disarm_warning')}</p>
            </div>
          )}
        </div>
        {!device.admin_token && (
          <p className="text-xs text-amber-400">{t('emergency.no_admin_token')}</p>
        )}
      </Card>

      {/* Energy flow */}
      <Card className="p-5 space-y-3">
        <h3 className="font-semibold">{t('emergency.flow_title')}</h3>
        <EnergyFlowDiagram
          input={{
            batteryPowerW: telemetry?.p_bat_dc ?? null,
            batteryCurrentA: telemetry?.i_bat_dc ?? null,
            loadCurrentA: telemetry?.i_ac_load ?? null,
            gensetCurrentA: telemetry?.i_ac_gen ?? null,
            emergencyState: state,
          }}
        />
      </Card>

      {/* Trigger config editor */}
      <Card className="p-5 space-y-3">
        <button
          className="flex items-center gap-2 font-semibold w-full text-left"
          onClick={() => setShowConfig((v) => !v)}
        >
          <SlidersHorizontal className="w-4 h-4" /> {t('emergency.config_title')}
          <span className="ml-auto text-muted-foreground text-xs">{showConfig ? '−' : '+'}</span>
        </button>
        {showConfig && (
          <div className="space-y-4 pt-2">
            <p className="text-xs text-muted-foreground leading-relaxed">
              {t('emergency.config_note')}
            </p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {EMERGENCY_CONFIG_FIELDS.map((f) => (
                <div key={f.key} className="space-y-1">
                  <Label className="text-xs text-muted-foreground">
                    {t(`emergency.cfg_${f.key}`)}
                  </Label>
                  <Input
                    type="number"
                    value={draftConfig[f.key]}
                    min={f.min}
                    max={f.max}
                    step={f.key.startsWith('vbat') || f.key.startsWith('i') ? 0.1 : 1}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setDraftConfig((c) => ({ ...c, [f.key]: v }));
                    }}
                  />
                  {/* v1.7.0 [P1-SC1] — safety policy needs its own honest hint. */}
                  {f.key === 'sensorFailPolicy' && (
                    <p
                      data-testid="sensor-fail-policy-hint"
                      className="text-[11px] leading-relaxed text-muted-foreground"
                    >
                      {t('emergency.cfg_sensorFailPolicy_hint')}
                    </p>
                  )}
                  {/* [PARITY-4 P1-11] The genset overcurrent threshold guards a
                      RESERVED hardware channel (2nd ACS712, GPIO32 — registry
                      F-GEN-001). The config field is part of the GAS/firmware
                      contract, but the sensor is not present: label it so the
                      operator never believes the channel is live. */}
                  {f.key === 'iAcGenOverA' && (
                    <p
                      data-testid="genset-reserved-hint"
                      className="text-[11px] leading-relaxed text-muted-foreground"
                    >
                      {t('emergency.cfg_iAcGenOverA_hint')}
                    </p>
                  )}
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={sending !== null}
                onClick={() => void runCommand('CONFIG', { config: normalizeEmergencyConfig(draftConfig) })}
              >
                {sending === 'CONFIG' ? t('common.loading') : t('emergency.config_send')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setDraftConfig(DEFAULT_EMERGENCY_CONFIG)}
              >
                {t('emergency.config_reset')}
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* Event log */}
      <Card className="p-5 space-y-3">
        <h3 className="font-semibold flex items-center gap-2">
          <History className="w-4 h-4" /> {t('emergency.log_title')}
        </h3>
        {eventsMsg && <p className="text-xs text-amber-400">{eventsMsg}</p>}
        {events.length === 0 && !eventsMsg && (
          <p className="text-sm text-muted-foreground">{t('emergency.log_empty')}</p>
        )}
        <div className="space-y-1.5 max-h-64 overflow-y-auto">
          {events.map((e, i) => (
            <div key={`${e.ts}-${i}`} className="flex items-center gap-2 text-xs font-mono">
              <span className="text-muted-foreground shrink-0">
                {new Date(e.ts).toLocaleString()}
              </span>
              <Badge
                variant="outline"
                className={cn(
                  'shrink-0',
                  e.type === 'TRIP' || e.type === 'ESTOP' || e.type === 'CRASHLOOP'
                    ? 'border-red-500/40 text-red-400'
                    : e.type === 'ARMED'
                      ? 'border-emerald-500/40 text-emerald-400'
                      : 'border-border',
                )}
              >
                {e.type}
              </Badge>
              <span className="truncate">{e.reason || e.detail}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
