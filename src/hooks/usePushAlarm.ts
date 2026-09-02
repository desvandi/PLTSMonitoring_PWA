'use client';

// =============================================================================
// usePushAlarm — state binding React untuk push-alarm (Web Push + VAPID).
// -----------------------------------------------------------------------------
// Mengikuti pola useNotificationToggle (useLowBatteryNotifier): localStorage +
// Notification.permission + status langganan pushManager ADALAH external store
// yang bisa berubah di luar React; semua dibaca via useSyncExternalStore dengan
// snapshot ber-referensi stabil (anti re-render loop). Status langganan (async,
// dari pushManager) dimuat ulang otomatis saat: komponen pertama berlangganan
// (mount), konfigurasi berubah, izin berubah, enable/disable selesai.
// =============================================================================

import { useCallback, useState, useSyncExternalStore } from 'react';
import {
  clearStoredPushAlarmConfig,
  disablePushAlarm,
  enablePushAlarm,
  getPushAlarmPermission,
  getPushAlarmSubscriptionState,
  isPushAlarmSupported,
  readStoredPushAlarmConfig,
  resolvePushAlarmConfig,
  sendTestPushAlarm,
  writePushAlarmConfig,
  type PushAlarmPermissionState,
  type PushAlarmResult,
  type PushAlarmSubscriptionState,
} from '@/lib/push-alarm/client';
import { PUSH_ALARM_CONFIG_EVENT, type PushAlarmConfig } from '@/lib/push-alarm/shared';

export interface PushAlarmSnapshot {
  supported: boolean;
  permission: PushAlarmPermissionState;
  /** Konfigurasi efektif (operator > build-time env). */
  config: PushAlarmConfig;
  /** true bila operator pernah menyimpan konfigurasi sendiri. */
  hasStoredConfig: boolean;
}

const EMPTY_CONFIG: PushAlarmConfig = { apiBase: '', vapidPublicKey: '' };
const SERVER_SNAPSHOT: PushAlarmSnapshot = {
  supported: false,
  permission: 'unsupported',
  config: EMPTY_CONFIG,
  hasStoredConfig: false,
};

// -----------------------------------------------------------------------------
// Store #1 — konfigurasi + izin (sinkron dari localStorage / Notification)
// -----------------------------------------------------------------------------

let snapshotCache: PushAlarmSnapshot | null = null;

function getSnapshot(): PushAlarmSnapshot {
  const supported = isPushAlarmSupported();
  const permission = getPushAlarmPermission();
  const stored = readStoredPushAlarmConfig();
  const config = typeof window !== 'undefined' ? resolvePushAlarmConfig() : EMPTY_CONFIG;
  const hasStoredConfig = stored !== null;
  if (
    !snapshotCache ||
    snapshotCache.supported !== supported ||
    snapshotCache.permission !== permission ||
    snapshotCache.hasStoredConfig !== hasStoredConfig ||
    snapshotCache.config.apiBase !== config.apiBase ||
    snapshotCache.config.vapidPublicKey !== config.vapidPublicKey
  ) {
    snapshotCache = { supported, permission, config, hasStoredConfig };
  }
  return snapshotCache;
}

function getServerSnapshot(): PushAlarmSnapshot {
  // Server tak punya API browser — nilai netral (hydrasi aman).
  return SERVER_SNAPSHOT;
}

function subscribeSnapshot(callback: () => void): () => void {
  window.addEventListener(PUSH_ALARM_CONFIG_EVENT, callback);
  // Low-battery panel bisa mengubah Notification.permission lewat event-nya.
  window.addEventListener('plts:notify-toggle', callback);
  return () => {
    window.removeEventListener(PUSH_ALARM_CONFIG_EVENT, callback);
    window.removeEventListener('plts:notify-toggle', callback);
  };
}

// -----------------------------------------------------------------------------
// Store #2 — status langganan (async dari pushManager; cache module-level,
// diperbarui oleh refreshPushAlarmSubscriptionState dan di-notify ke React)
// -----------------------------------------------------------------------------

const SUB_STATE_SERVER: PushAlarmSubscriptionState = { subscribed: false, endpointHost: null };
let subscriptionState: PushAlarmSubscriptionState = SUB_STATE_SERVER;
const subscriptionListeners = new Set<() => void>();
let refreshInFlight = false;

function notifySubscriptionState(next: PushAlarmSubscriptionState): void {
  if (
    next.subscribed === subscriptionState.subscribed &&
    next.endpointHost === subscriptionState.endpointHost
  ) {
    return;
  }
  subscriptionState = next;
  for (const callback of subscriptionListeners) callback();
}

/** Muat ulang status langganan dari pushManager (idempoten, aman dipanggil
 *  dari mana saja — event handler, modul, atau sesudah enable/disable). */
export async function refreshPushAlarmSubscriptionState(): Promise<void> {
  if (refreshInFlight) return;
  refreshInFlight = true;
  try {
    notifySubscriptionState(await getPushAlarmSubscriptionState());
  } finally {
    refreshInFlight = false;
  }
}

function getSubscriptionSnapshot(): PushAlarmSubscriptionState {
  return subscriptionState;
}

function getSubscriptionServerSnapshot(): PushAlarmSubscriptionState {
  return SUB_STATE_SERVER;
}

function subscribeSubscriptionState(callback: () => void): () => void {
  subscriptionListeners.add(callback);
  // Pendengar baru = ada komponen mount -> pastikan status segar (async,
  // hasilnya masuk lewat notify, bukan setState di effect).
  void refreshPushAlarmSubscriptionState();
  return () => {
    subscriptionListeners.delete(callback);
  };
}

// Konfigurasi/izin berubah di tab mana pun -> status langganan ikut diperiksa.
if (typeof window !== 'undefined') {
  window.addEventListener(PUSH_ALARM_CONFIG_EVENT, () => {
    void refreshPushAlarmSubscriptionState();
  });
}

// -----------------------------------------------------------------------------
// Hook publik
// -----------------------------------------------------------------------------

export interface UsePushAlarm {
  supported: boolean;
  permission: PushAlarmPermissionState;
  config: PushAlarmConfig;
  hasStoredConfig: boolean;
  subscribed: boolean;
  endpointHost: string | null;
  busy: boolean;
  enable: () => Promise<PushAlarmResult>;
  disable: () => Promise<PushAlarmResult>;
  saveConfig: (config: PushAlarmConfig) => Promise<PushAlarmResult>;
  clearConfig: () => Promise<void>;
  sendTestPush: () => Promise<PushAlarmResult>;
}

export function usePushAlarm(): UsePushAlarm {
  const snap = useSyncExternalStore(subscribeSnapshot, getSnapshot, getServerSnapshot);
  const subscription = useSyncExternalStore(
    subscribeSubscriptionState,
    getSubscriptionSnapshot,
    getSubscriptionServerSnapshot,
  );
  const [busy, setBusy] = useState(false);

  const enable = useCallback(async (): Promise<PushAlarmResult> => {
    setBusy(true);
    try {
      return await enablePushAlarm();
    } finally {
      setBusy(false);
      void refreshPushAlarmSubscriptionState();
    }
  }, []);

  const disable = useCallback(async (): Promise<PushAlarmResult> => {
    setBusy(true);
    try {
      return await disablePushAlarm();
    } finally {
      setBusy(false);
      void refreshPushAlarmSubscriptionState();
    }
  }, []);

  const saveConfig = useCallback(
    async (config: PushAlarmConfig): Promise<PushAlarmResult> => {
      return writePushAlarmConfig(config);
    },
    [],
  );

  const clearConfig = useCallback(async (): Promise<void> => {
    await clearStoredPushAlarmConfig();
  }, []);

  const sendTestPush = useCallback(async (): Promise<PushAlarmResult> => {
    return sendTestPushAlarm();
  }, []);

  return {
    supported: snap.supported,
    permission: snap.permission,
    config: snap.config,
    hasStoredConfig: snap.hasStoredConfig,
    subscribed: subscription.subscribed,
    endpointHost: subscription.endpointHost,
    busy,
    enable,
    disable,
    saveConfig,
    clearConfig,
    sendTestPush,
  };
}
