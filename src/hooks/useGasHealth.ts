'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { pingGasEndpoint } from '@/lib/sysConfig';
import { useSysConfig } from '@/components/providers/sys-config-provider';

export type HealthState = 'idle' | 'checking' | 'online' | 'degraded' | 'offline';

interface HealthStatus {
  state: HealthState;
  latency_ms: number | null;
  last_checked_at: string | null;
  message: string;
  refresh: () => Promise<void>;
}

const DEFAULT_INTERVAL_MS = 60_000;

/**
 * Pings the ACTIVE device's GAS endpoint every N seconds so the header can
 * render a status dot without every consumer piling on its own timer.
 */
export function useGasHealth(intervalMs = DEFAULT_INTERVAL_MS): HealthStatus {
  const { config } = useSysConfig();
  const [state, setState] = useState<HealthState>('idle');
  const [latency, setLatency] = useState<number | null>(null);
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null);
  const [message, setMessage] = useState<string>('Belum ada pengecekan.');
  const abortRef = useRef<AbortController | null>(null);

  const identity = useMemo(
    () => (config ? `${config.gas_webapp_url}|${config.auth_token}` : ''),
    [config]
  );

  const doPing = useMemo(() => {
    return async () => {
      if (!config) {
        setState('idle');
        setLatency(null);
        setMessage('Konfigurasi belum tersedia.');
        return;
      }
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setState('checking');
      const result = await pingGasEndpoint(config.gas_webapp_url, config.auth_token, 7000);
      if (controller.signal.aborted) return;
      setLatency(result.latency_ms ?? null);
      setLastCheckedAt(new Date().toISOString());
      setMessage(result.message);
      if (result.ok) {
        setState((result.latency_ms ?? 0) > 3000 ? 'degraded' : 'online');
      } else {
        setState('offline');
      }
    };
    // Only rebuild when the ACTIVE device identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity]);

  useEffect(() => {
    if (!config) return;
    // [AUDIT 2026-08-28 G12] Kickoff ditunda satu macrotask — setState di
    // awal doPing ('checking'/'idle') tidak sinkron-reachable dari badan
    // effect (react-hooks/set-state-in-effect). Interval & visibility tetap.
    const kickoff = window.setTimeout(() => void doPing(), 0);
    const id = window.setInterval(doPing, Math.max(intervalMs, 10_000));
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void doPing();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearTimeout(kickoff);
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisibility);
      abortRef.current?.abort();
    };
  }, [config, doPing, intervalMs]);

  return {
    state,
    latency_ms: latency,
    last_checked_at: lastCheckedAt,
    message,
    refresh: doPing,
  };
}
