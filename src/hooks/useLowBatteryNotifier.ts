'use client';

import { useEffect, useRef, useCallback, useSyncExternalStore } from 'react';
import { useSysConfig } from '@/components/providers/sys-config-provider';
import { useFleetStatus } from '@/hooks/useFleetStatus';

const PERMISSION_LS_KEY = 'PLTS_BROWSER_NOTIFY_ENABLED';
const ALERT_COOLDOWN_MS = 30 * 60 * 1000; // don't nag more than 1×/30min per device

const lastAlertPerDevice = new Map<string, number>();

export type NotificationPermissionState = 'granted' | 'denied' | 'default' | 'unsupported';

export function isNotificationSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function getNotificationState(): NotificationPermissionState {
  if (!isNotificationSupported()) return 'unsupported';
  return Notification.permission as NotificationPermissionState;
}

export function isNotificationEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(PERMISSION_LS_KEY) === 'true';
}

export async function requestNotificationConsent(): Promise<NotificationPermissionState> {
  if (!isNotificationSupported()) return 'unsupported';
  const perm = await Notification.requestPermission();
  window.localStorage.setItem(PERMISSION_LS_KEY, perm === 'granted' ? 'true' : 'false');
  window.dispatchEvent(new CustomEvent('plts:notify-toggle'));
  return perm as NotificationPermissionState;
}

export function disableNotifications(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(PERMISSION_LS_KEY, 'false');
  window.dispatchEvent(new CustomEvent('plts:notify-toggle'));
}

/**
 * [WAVE-7 / PW7-3] `navigator.serviceWorker.ready` TIDAK PERNAH resolve bila
 * tidak ada service worker terdaftar — await-nya menggantung selamanya, dan
 * fallback `new Notification()` di bawahnya tidak pernah tercapai. Notifikasi
 * baterai rendah pun mati senyap. Berlomba dengan timeout singkat: kalau SW
 * belum siap dalam 3 detik, pakai Notification API langsung.
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(null), timeoutMs);
    promise
      .then((value) => {
        window.clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        window.clearTimeout(timer);
        resolve(null);
      });
  });
}

async function fireLocalNotification(title: string, body: string, tag: string): Promise<void> {
  if (getNotificationState() !== 'granted') return;
  try {
    const ready = navigator.serviceWorker ? withTimeout(navigator.serviceWorker.ready, 3000) : null;
    const reg = ready ? await ready : null;
    if (reg) {
      await reg.showNotification(title, {
        body,
        tag,
        icon: '/icon.svg',
        badge: '/favicon-32.png',
        data: { url: '/fleet' },
      });
      return;
    }
  } catch {
    // Fallback to plain Notification below.
  }
  new Notification(title, { body, tag, icon: '/icon.svg' });
}

/**
 * Watches every registered device via the Fleet status hook. When any device
 * reports v_bat < low_battery_warning_threshold (from active device dashboard
 * settings), fire a browser notification (cooldown 30 min per device).
 */
export function useLowBatteryNotifier(): void {
  const { config } = useSysConfig();
  const { statuses } = useFleetStatus();
  const enabledRef = useRef(isNotificationEnabled());

  useEffect(() => {
    const sync = () => {
      enabledRef.current = isNotificationEnabled();
    };
    window.addEventListener('plts:notify-toggle', sync);
    return () => window.removeEventListener('plts:notify-toggle', sync);
  }, []);

  useEffect(() => {
    if (!config || !enabledRef.current) return;
    const threshold = config.dashboard_settings.low_battery_warning_threshold;
    const now = Date.now();
    for (const row of statuses) {
      const v = row.telemetry?.v_bat;
      if (v == null || v >= threshold) continue;
      const last = lastAlertPerDevice.get(row.device.device_id) ?? 0;
      if (now - last < ALERT_COOLDOWN_MS) continue;
      lastAlertPerDevice.set(row.device.device_id, now);
      void fireLocalNotification(
        `⚠ Baterai kritis — ${row.device.label}`,
        `V-Bat ${v.toFixed(2)} V < cutoff ${threshold.toFixed(2)} V. Segera cek beban / charger.`,
        `plts-low-${row.device.device_id}`
      );
    }
  }, [statuses, config]);
}

// -----------------------------------------------------------------------------
// Toggle UI helper — hook returning stateful helpers for a Switch component.
// -----------------------------------------------------------------------------
// [AUDIT 2026-08-28 G13] State toggle kini dibaca via useSyncExternalStore:
// Notification.permission + localStorage ADALAH external store (mutable di
// luar React). Pattern sebelumnya (setState sinkron di dalam effect)
// menduplikasi store ke state React — dua sumber kebenaran + cascading
// render. Snapshot di-cache: getSnapshot wajib mengembalikan referensi
// stabil selama nilainya belum berubah, kalau tidak re-render akan loop.

interface NotifySnapshot {
  state: NotificationPermissionState;
  enabled: boolean;
}

let notifySnapshotCache: NotifySnapshot | null = null;

function getNotifySnapshot(): NotifySnapshot {
  const state = getNotificationState();
  const enabled = state === 'granted' && isNotificationEnabled();
  if (!notifySnapshotCache || notifySnapshotCache.state !== state || notifySnapshotCache.enabled !== enabled) {
    notifySnapshotCache = { state, enabled };
  }
  return notifySnapshotCache;
}

function getNotifyServerSnapshot(): NotifySnapshot {
  // Server tak punya Notification API — nilai netral (hydrasi aman).
  return { state: 'unsupported', enabled: false };
}

function subscribeNotify(callback: () => void): () => void {
  window.addEventListener('plts:notify-toggle', callback);
  return () => window.removeEventListener('plts:notify-toggle', callback);
}

export function useNotificationToggle(): {
  state: NotificationPermissionState;
  enabled: boolean;
  toggle: (value: boolean) => Promise<void>;
} {
  const snap = useSyncExternalStore(subscribeNotify, getNotifySnapshot, getNotifyServerSnapshot);

  // toggle hanya MEMUTASI external store (localStorage + permission request
  // + event) — UI re-render otomatis via subscription, tanpa state paralel.
  const toggle = useCallback(async (value: boolean) => {
    if (!value) {
      disableNotifications();
      return;
    }
    await requestNotificationConsent();
  }, []);

  return { state: snap.state, enabled: snap.enabled, toggle };
}
