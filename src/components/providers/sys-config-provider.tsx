'use client';

import { createContext, useCallback, useContext, useSyncExternalStore, ReactNode } from 'react';
import {
  readSysConfig,
  writeSysConfig,
  clearSysConfig,
  addDeviceToConfig,
  updateActiveDevice,
  removeDeviceFromConfig,
  switchActiveDevice,
  SYS_CONFIG_KEY,
  PltsSysConfig,
  DeviceProfile,
  DashboardSettings,
} from '@/lib/sysConfig';

interface SysConfigContextValue {
  config: PltsSysConfig | null;
  ready: boolean;
  save: (next: {
    gas_webapp_url: string;
    auth_token: string;
    device_id: string;
    label?: string;
    dashboard_settings: DashboardSettings;
  }) => PltsSysConfig;
  addDevice: (profile: DeviceProfile) => PltsSysConfig | null;
  updateActive: (profile: DeviceProfile) => PltsSysConfig | null;
  removeDevice: (deviceId: string) => PltsSysConfig | null;
  switchDevice: (deviceId: string) => PltsSysConfig | null;
  reset: () => void;
  refresh: () => void;
}

const SysConfigContext = createContext<SysConfigContextValue | null>(null);

// ---------------------------------------------------------------------------
// localStorage as an EXTERNAL STORE (react-hooks/set-state-in-effect fix):
// every mutation helper in lib/sysConfig.ts persists via persistSysConfig()
// or clearSysConfig(), both of which dispatch 'plts:config-updated'; edits in
// other tabs arrive via the 'storage' event. useSyncExternalStore subscribes
// to both and re-reads the snapshot — no mount-effect, no manual setState.
//
// getSnapshot must return a STABLE reference (Object.is) or React re-renders
// forever; readSysConfig() parses a fresh object per call, so we cache keyed
// on the raw storage string. The v1→v2 migration write-back inside
// readSysConfig() dispatches the update event, which re-triggers a read and
// refreshes the cache — self-healing.
// ---------------------------------------------------------------------------
function subscribeToSysConfig(callback: () => void): () => void {
  window.addEventListener('plts:config-updated', callback);
  window.addEventListener('storage', callback);
  return () => {
    window.removeEventListener('plts:config-updated', callback);
    window.removeEventListener('storage', callback);
  };
}

let sysConfigCacheRaw: string | null = null;
let sysConfigCacheValue: PltsSysConfig | null = null;

function getSysConfigSnapshot(): PltsSysConfig | null {
  if (typeof window === 'undefined') return null;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(SYS_CONFIG_KEY);
  } catch {
    raw = null;
  }
  if (raw !== sysConfigCacheRaw) {
    sysConfigCacheRaw = raw;
    sysConfigCacheValue = readSysConfig();
  }
  return sysConfigCacheValue;
}

function getServerSnapshot(): PltsSysConfig | null {
  return null;
}

export function SysConfigProvider({ children }: { children: ReactNode }) {
  const config = useSyncExternalStore(subscribeToSysConfig, getSysConfigSnapshot, getServerSnapshot);
  // 'ready' semantics preserved: false during SSR, true on the client —
  // gates that avoid a flash of unconfigured UI keep working.
  const ready = useSyncExternalStore(subscribeToSysConfig, () => true, () => false);

  const refresh = useCallback(() => {
    // Force every subscriber to re-read the store (e.g. after an
    // out-of-band change that fired no event).
    window.dispatchEvent(new CustomEvent('plts:config-updated'));
  }, []);

  const save = useCallback(
    (next: {
      gas_webapp_url: string;
      auth_token: string;
      device_id: string;
      label?: string;
      dashboard_settings: DashboardSettings;
    }) => {
      // persistSysConfig dispatches 'plts:config-updated' → the store (and
      // every subscriber) updates itself; no local setState needed.
      return writeSysConfig(next);
    },
    []
  );

  const addDevice = useCallback((profile: DeviceProfile) => {
    if (!config) return null;
    return addDeviceToConfig(config, profile);
  }, [config]);

  // [AUDIT 2026-08-28 F1] /setup edit path — upsert the ACTIVE device while
  // preserving the rest of the fleet (writeSysConfig collapses devices[]).
  const updateActive = useCallback((profile: DeviceProfile) => {
    if (!config) return null;
    return updateActiveDevice(config, profile);
  }, [config]);

  const removeDevice = useCallback((deviceId: string) => {
    if (!config) return null;
    return removeDeviceFromConfig(config, deviceId);
  }, [config]);

  const switchDevice = useCallback((deviceId: string) => {
    if (!config) return null;
    return switchActiveDevice(config, deviceId);
  }, [config]);

  const reset = useCallback(() => {
    clearSysConfig();
  }, []);

  return (
    <SysConfigContext.Provider
      value={{ config, ready, save, addDevice, updateActive, removeDevice, switchDevice, reset, refresh }}
    >
      {children}
    </SysConfigContext.Provider>
  );
}

export function useSysConfig(): SysConfigContextValue {
  const ctx = useContext(SysConfigContext);
  if (!ctx) throw new Error('useSysConfig must be used inside <SysConfigProvider>');
  return ctx;
}
