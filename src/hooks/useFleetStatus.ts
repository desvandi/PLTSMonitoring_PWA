'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DeviceProfile } from '@/lib/sysConfig';
import { useSysConfig } from '@/components/providers/sys-config-provider';
import { parseLatestEnvelope, type FleetTelemetry } from '@/lib/gasEnvelope';

export type { FleetTelemetry } from '@/lib/gasEnvelope';
export { parseLatestEnvelope } from '@/lib/gasEnvelope';

export interface FleetDeviceStatus {
  device: DeviceProfile;
  loading: boolean;
  online: boolean;
  latency_ms: number | null;
  telemetry: FleetTelemetry | null;
  error: string | null;
  last_checked_at: string | null;
}

const FLEET_TIMEOUT_MS = 8000;
const FLEET_POLL_MS = 30000;

async function fetchLatestFor(device: DeviceProfile): Promise<{
  ok: boolean;
  latency_ms: number;
  telemetry: FleetTelemetry | null;
  error: string | null;
}> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FLEET_TIMEOUT_MS);
  const startedAt = performance.now();
  try {
    const res = await fetch(device.gas_webapp_url, {
      method: 'POST',
      // [AUDIT 2026-08-28 F11] device_key MUST be in the body: GAS resolves the
      // device from body.device_key (token auth has no device identity), and
      // without it LATEST silently queried the Config-sheet DEFAULT device —
      // a fleet of N devices would all show the same (or no) telemetry.
      body: JSON.stringify({
        action: 'LATEST',
        token: device.auth_token,
        device_key: device.device_id,
      }),
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      signal: controller.signal,
      redirect: 'follow',
    });
    clearTimeout(timer);
    const latency = Math.round(performance.now() - startedAt);
    if (!res.ok) return { ok: false, latency_ms: latency, telemetry: null, error: `HTTP ${res.status}` };
    const json = (await res.json().catch(() => null)) as {
      status?: string;
      message?: string;
      data?: unknown;
    } | null;
    if (!json || json.status !== 'SUCCESS') {
      return { ok: false, latency_ms: latency, telemetry: null, error: json?.message ?? 'ERROR' };
    }
    return {
      ok: true,
      latency_ms: latency,
      telemetry: parseLatestEnvelope(json.data),
      error: null,
    };
  } catch (err) {
    clearTimeout(timer);
    const latency = Math.round(performance.now() - startedAt);
    return {
      ok: false,
      latency_ms: latency,
      telemetry: null,
      error: (err as Error).name === 'AbortError' ? 'Timeout' : (err as Error).message,
    };
  }
}

export function useFleetStatus(pollMs = FLEET_POLL_MS): {
  statuses: FleetDeviceStatus[];
  refresh: () => Promise<void>;
  lastRefreshAt: string | null;
} {
  const { config } = useSysConfig();
  // [AUDIT 2026-08-28 G10] Hasil fetch disimpan per device_id; daftar barisan
  // status di-DERIVE saat render (merge config × hasil terakhir). Perangkat
  // baru/label baru langsung terlihat tanpa effect sinkronisasi setState —
  // menghapus sumber cascading render (set-state-in-effect).
  const [results, setResults] = useState<Record<string, FleetDeviceStatus>>({});
  const [lastRefreshAt, setLastRefreshAt] = useState<string | null>(null);

  const statuses: FleetDeviceStatus[] = useMemo(() => {
    if (!config) return [];
    return config.devices.map((device) => {
      const r = results[device.device_id];
      // Profil device SELALU dari config (terbaru); data pengukuran dari
      // hasil fetch terakhir untuk device_id itu.
      if (!r) {
        return {
          device,
          loading: true,
          online: false,
          latency_ms: null,
          telemetry: null,
          error: null,
          last_checked_at: null,
        };
      }
      return {
        device,
        loading: false,
        online: r.online,
        latency_ms: r.latency_ms,
        telemetry: r.telemetry,
        error: r.error,
        last_checked_at: r.last_checked_at,
      };
    });
  }, [config, results]);

  const refresh = useCallback(async () => {
    if (!config) return;
    const fetched = await Promise.all(
      config.devices.map(async (device) => {
        const r = await fetchLatestFor(device);
        return {
          device,
          loading: false,
          online: r.ok,
          latency_ms: r.latency_ms,
          telemetry: r.telemetry,
          error: r.error,
          last_checked_at: new Date().toISOString(),
        } satisfies FleetDeviceStatus;
      })
    );
    setResults(Object.fromEntries(fetched.map((row) => [row.device.device_id, row])));
    setLastRefreshAt(new Date().toISOString());
  }, [config]);

  useEffect(() => {
    if (!config) return;
    // [G11] Kickoff ditunda satu macrotask — setState di refresh tidak
    // sinkron-reachable dari badan effect; interval & visibility tetap.
    const kickoff = window.setTimeout(() => void refresh(), 0);
    const id = window.setInterval(refresh, Math.max(pollMs, 15000));
    const onVis = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.clearTimeout(kickoff);
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [config, pollMs, refresh]);

  return { statuses, refresh, lastRefreshAt };
}
