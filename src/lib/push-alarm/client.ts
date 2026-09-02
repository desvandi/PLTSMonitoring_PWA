// =============================================================================
// Push Alarm — manajer sisi halaman (port TS dari js/push-manager.js PWA
// vanilla pwa-push-alarm).
// -----------------------------------------------------------------------------
// Tanggung jawab:
//  1. Deteksi dukungan browser (service worker, Push API, Notification).
//  2. Meminta izin notifikasi HANYA dari gestur pengguna (klik tombol).
//  3. Membuat langganan push dengan applicationServerKey (kunci publik VAPID)
//     dan mengirimkannya ke backend GAS PushService untuk disimpan.
//  4. Membatalkan langganan + memberi tahu GAS saat dinonaktifkan.
//  5. Konfigurasi runtime (URL GAS + kunci VAPID publik) mengikuti pola
//     zero-touch PLTS_SYS_CONFIG: localStorage + event, dengan default
//     build-time via NEXT_PUBLIC_PUSH_API_BASE / NEXT_PUBLIC_PUSH_VAPID_PUBLIC_KEY.
//
// Handler event push / notificationclick / pushsubscriptionchange berada di
// src/sw.ts (service worker), bukan di sini.
// =============================================================================

import {
  ALARM_VIEW_TARGET,
  PUSH_ALARM_CONFIG_EVENT,
  PUSH_ALARM_CONFIG_STORAGE_KEY,
  PUSH_ALARM_ENDPOINT_HOST_KEY,
  urlBase64ToUint8Array,
  validatePushAlarmConfig,
  type PushAlarmConfig,
  type PushAlarmConfigValidation,
} from "./shared";
import {
  clearPushAlarmRuntimeConfig,
  savePushAlarmRuntimeConfig,
} from "./sw-config-store";

/** Default build-time (di-inject saat `next build`; kosong = isi via Settings). */
const BUILD_TIME_API_BASE = process.env.NEXT_PUBLIC_PUSH_API_BASE || "";
const BUILD_TIME_VAPID_KEY = process.env.NEXT_PUBLIC_PUSH_VAPID_PUBLIC_KEY || "";

export type PushAlarmPermissionState = "granted" | "denied" | "default" | "unsupported";

export interface PushAlarmResult {
  ok: boolean;
  state: string;
  message: string;
}

export interface PushAlarmSubscriptionState {
  subscribed: boolean;
  endpointHost: string | null;
}

const FETCH_TIMEOUT_MS = 15000;

// -----------------------------------------------------------------------------
// Konfigurasi runtime (localStorage, pola zero-touch)
// -----------------------------------------------------------------------------

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function readStoredConfigRaw(): unknown {
  if (!isBrowser()) return null;
  try {
    const raw = window.localStorage.getItem(PUSH_ALARM_CONFIG_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

/** Konfigurasi eksplisit yang disimpan operator (null bila belum ada). */
export function readStoredPushAlarmConfig(): PushAlarmConfig | null {
  const raw = readStoredConfigRaw();
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const apiBase = typeof obj.apiBase === "string" ? obj.apiBase.trim() : "";
  const vapidPublicKey = typeof obj.vapidPublicKey === "string" ? obj.vapidPublicKey.trim() : "";
  if (!apiBase && !vapidPublicKey) return null;
  return { apiBase, vapidPublicKey };
}

/** Konfigurasi efektif: nilai tersimpan operator > default build-time. */
export function resolvePushAlarmConfig(): PushAlarmConfig {
  const stored = readStoredPushAlarmConfig();
  return {
    apiBase: stored?.apiBase || BUILD_TIME_API_BASE,
    vapidPublicKey: stored?.vapidPublicKey || BUILD_TIME_VAPID_KEY,
  };
}

/** true bila ada default build-time (env var) untuk field tsb. */
export function hasBuildTimeDefault(): { apiBase: boolean; vapidPublicKey: boolean } {
  return { apiBase: BUILD_TIME_API_BASE.length > 0, vapidPublicKey: BUILD_TIME_VAPID_KEY.length > 0 };
}

function emitConfigEvent(): void {
  if (!isBrowser()) return;
  window.dispatchEvent(new CustomEvent(PUSH_ALARM_CONFIG_EVENT));
}

/**
 * Simpan konfigurasi push-alarm operator. Validasi ketat (URL GAS format
 * script.google.com/macros/.../exec + kunci VAPID 65-byte) mengikuti gerbang
 * verify-deployment.js. Setelah tersimpan, konfigurasi disinkronkan ke
 * service worker (IndexedDB + postMessage).
 */
export async function writePushAlarmConfig(input: PushAlarmConfig): Promise<PushAlarmResult> {
  const candidate: PushAlarmConfig = {
    apiBase: (input.apiBase || "").trim(),
    vapidPublicKey: (input.vapidPublicKey || "").trim(),
  };
  const check: PushAlarmConfigValidation = validatePushAlarmConfig(candidate);
  if (!check.ok) {
    return { ok: false, state: "invalid-config", message: check.message || "Konfigurasi tidak valid." };
  }
  if (!isBrowser()) {
    return { ok: false, state: "no-window", message: "Hanya bisa dijalankan di browser." };
  }
  try {
    window.localStorage.setItem(PUSH_ALARM_CONFIG_STORAGE_KEY, JSON.stringify(candidate));
  } catch {
    return { ok: false, state: "storage-error", message: "Gagal menyimpan konfigurasi (localStorage penuh/ditolak)." };
  }
  await syncPushAlarmConfigToServiceWorker();
  emitConfigEvent();
  return { ok: true, state: "saved", message: "Konfigurasi push-alarm tersimpan." };
}

/** Hapus konfigurasi tersimpan -> kembali ke default build-time (bila ada). */
export async function clearStoredPushAlarmConfig(): Promise<void> {
  if (isBrowser()) {
    try {
      window.localStorage.removeItem(PUSH_ALARM_CONFIG_STORAGE_KEY);
    } catch {
      /* abaikan */
    }
  }
  try {
    await clearPushAlarmRuntimeConfig();
  } catch {
    /* best-effort */
  }
  await syncPushAlarmConfigToServiceWorker();
  emitConfigEvent();
}

// -----------------------------------------------------------------------------
// Sinkronisasi konfigurasi -> service worker
// -----------------------------------------------------------------------------

/**
 * Pastikan service worker melihat konfigurasi efektif terbaru:
 * tulis ke IndexedDB (bertahan restart SW) lalu postMessage ke SW aktif
 * (cache memori instan). Best-effort — tidak pernah melempar.
 */
export async function syncPushAlarmConfigToServiceWorker(): Promise<void> {
  if (!isBrowser() || !("serviceWorker" in navigator)) return;
  try {
    const config = resolvePushAlarmConfig();
    if (config.apiBase || config.vapidPublicKey) {
      try {
        await savePushAlarmRuntimeConfig(config);
      } catch {
        /* IndexedDB penuh/private mode — postMessage masih berfungsi */
      }
    }
    const send = (worker: ServiceWorker | null): void => {
      if (worker) {
        worker.postMessage({ type: "PLTS_PUSH_ALARM_CONFIG", config });
      }
    };
    const controller = navigator.serviceWorker.controller;
    if (controller) {
      send(controller);
      return;
    }
    // SW belum mengendalikan halaman (load pertama) — tunggu ready lalu kirim.
    void navigator.serviceWorker.ready
      .then((registration) => send(registration.active))
      .catch(() => undefined);
  } catch {
    /* best-effort */
  }
}

// -----------------------------------------------------------------------------
// Dukungan browser & izin
// -----------------------------------------------------------------------------

export function isPushAlarmSupported(): boolean {
  return (
    isBrowser() &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window &&
    typeof ServiceWorkerRegistration !== "undefined" &&
    "showNotification" in ServiceWorkerRegistration.prototype
  );
}

export function getPushAlarmPermission(): PushAlarmPermissionState {
  if (!isBrowser() || !("Notification" in window)) return "unsupported";
  const perm = Notification.permission;
  return perm === "granted" || perm === "denied" ? perm : "default";
}

// -----------------------------------------------------------------------------
// Langganan push
// -----------------------------------------------------------------------------

function hostOf(urlStr: string): string {
  try {
    return new URL(urlStr).host;
  } catch {
    return "";
  }
}

function fetchWithTimeout(url: string, options: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => {
    window.clearTimeout(timer);
  });
}

async function sendSubscriptionToServer(
  apiBase: string,
  subscription: PushSubscription,
  action: "subscribe" | "unsubscribe",
): Promise<{ ok: boolean; message?: string }> {
  const json = subscription.toJSON();
  const payload = {
    action,
    endpoint: subscription.endpoint,
    keys: {
      p256dh: json.keys?.p256dh,
      auth: json.keys?.auth,
    },
    context: {
      lang: (navigator.language || "id").slice(0, 8),
      tz: safeIntlTimeZone(),
      ua: navigator.userAgent.slice(0, 180),
      appOrigin: window.location.origin,
      addedAt: new Date().toISOString(),
    },
  };
  try {
    // text/plain menghindari preflight CORS OPTIONS di GAS Web App.
    const res = await fetchWithTimeout(apiBase, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return { ok: false, message: `HTTP ${res.status}` };
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
    if (data && data.ok === false) {
      return { ok: false, message: data.message || "Server menolak langganan." };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, message: (err as Error).message || "Kesalahan jaringan." };
  }
}

function safeIntlTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    return "";
  }
}

/** Simpan host endpoint untuk diagnostik UI. Kunci p256dh/auth TIDAK
 *  pernah disimpan di localStorage (bisa dipakai pihak lain mengirim push). */
function rememberEndpointHost(subscription: PushSubscription): void {
  try {
    window.localStorage.setItem(PUSH_ALARM_ENDPOINT_HOST_KEY, hostOf(subscription.endpoint));
  } catch {
    /* abaikan */
  }
}

function matchesApplicationServerKey(subscription: PushSubscription, appKey: Uint8Array<ArrayBuffer>): boolean {
  try {
    const key = subscription.options?.applicationServerKey;
    if (!key) return false;
    const cur = key instanceof Uint8Array ? key : new Uint8Array(key);
    if (cur.length !== appKey.length) return false;
    for (let i = 0; i < cur.length; i++) {
      if (cur[i] !== appKey[i]) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function humanizeSubscribeError(err: unknown): string {
  const msg = (err instanceof Error && err.message) || String(err);
  if (/permission|denied/i.test(msg)) {
    return `Izin notifikasi ditolak sistem/browser: ${msg}`;
  }
  if (/applicationServerKey|VAPID|key/i.test(msg)) {
    return `Kunci VAPID tidak valid / tidak cocok: ${msg}`;
  }
  if (/AbortError|timeout/i.test(msg)) {
    return "Waktu habis saat menghubungi push service.";
  }
  return `Gagal membuat langganan push: ${msg}`;
}

/**
 * Aktifkan push alarm (HANYA dari gestur pengguna — klik tombol).
 * Alur: validasi konfigurasi -> minta izin -> subscribe -> daftar ke GAS.
 * Rollback bila server menolak (langganan tanpa registrasi server percuma).
 */
export async function enablePushAlarm(): Promise<PushAlarmResult> {
  if (!isPushAlarmSupported()) {
    return {
      ok: false,
      state: "unsupported",
      message:
        "Browser ini tidak mendukung Push API. Gunakan Chrome/Edge (desktop/Android) atau Safari 16.4+ dengan PWA terpasang di layar utama (iOS).",
    };
  }
  const config = resolvePushAlarmConfig();
  const check = validatePushAlarmConfig(config);
  if (!check.ok) {
    return {
      ok: false,
      state: "invalid-config",
      message: `${check.message} Isi dulu di panel "Server Push Alarm" pada Settings.`,
    };
  }
  if (getPushAlarmPermission() === "denied") {
    return {
      ok: false,
      state: "denied",
      message: "Izin notifikasi diblokir. Buka pengaturan situs browser, izinkan Notifikasi, lalu coba lagi.",
    };
  }

  // 1. Minta izin (dalam rantai gestur pengguna).
  let permission: string;
  try {
    permission = await Notification.requestPermission();
  } catch (err) {
    return { ok: false, state: "error", message: `Gagal meminta izin notifikasi: ${(err as Error).message}` };
  }
  if (permission !== "granted") {
    return {
      ok: false,
      state: permission,
      message:
        permission === "denied"
          ? "Izin notifikasi ditolak. Aktifkan manual dari pengaturan situs."
          : "Izin belum diberikan, langganan push dibatalkan.",
    };
  }

  // 2. Pastikan service worker aktif.
  let registration: ServiceWorkerRegistration;
  try {
    registration = await navigator.serviceWorker.ready;
  } catch {
    return { ok: false, state: "no-sw", message: "Service worker belum terdaftar. Muat ulang halaman lalu coba lagi." };
  }

  // 3. Pakai ulang langganan lama bila masih valid & cocok kunci VAPID.
  let sub: PushSubscription | null = null;
  try {
    sub = await registration.pushManager.getSubscription();
  } catch {
    sub = null;
  }
  const appKey = urlBase64ToUint8Array(config.vapidPublicKey);
  if (sub && !matchesApplicationServerKey(sub, appKey)) {
    // Kunci VAPID berganti sejak langganan lama dibuat -> buang, buat baru.
    try {
      await sub.unsubscribe();
    } catch {
      /* abaikan */
    }
    sub = null;
  }
  if (!sub) {
    try {
      sub = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: appKey,
      });
    } catch (err) {
      return { ok: false, state: "subscribe-error", message: humanizeSubscribeError(err) };
    }
  }

  // 4. Daftarkan langganan ke backend GAS.
  const sent = await sendSubscriptionToServer(config.apiBase, sub, "subscribe");
  if (!sent.ok) {
    try {
      await sub.unsubscribe();
    } catch {
      /* abaikan */
    }
    return {
      ok: false,
      state: "server-error",
      message: `Langganan berhasil dibuat tetapi gagal disimpan di server: ${sent.message ?? ""}`,
    };
  }

  rememberEndpointHost(sub);
  emitConfigEvent();
  return { ok: true, state: "enabled", message: "Notifikasi alarm aktif di perangkat ini — bekerja walau aplikasi tertutup." };
}

/** Matikan push alarm: hapus dari server DULU, baru unsubscribe lokal. */
export async function disablePushAlarm(): Promise<PushAlarmResult> {
  if (!isPushAlarmSupported()) {
    return { ok: true, state: "disabled", message: "Tidak ada dukungan push di browser ini." };
  }
  try {
    const registration = await navigator.serviceWorker.ready;
    const sub = await registration.pushManager.getSubscription();
    if (sub) {
      const config = resolvePushAlarmConfig();
      if (config.apiBase) {
        await sendSubscriptionToServer(config.apiBase, sub, "unsubscribe");
      }
      try {
        await sub.unsubscribe();
      } catch {
        /* abaikan */
      }
    }
  } catch {
    /* best-effort */
  }
  try {
    window.localStorage.removeItem(PUSH_ALARM_ENDPOINT_HOST_KEY);
  } catch {
    /* abaikan */
  }
  emitConfigEvent();
  return { ok: true, state: "disabled", message: "Notifikasi alarm dimatikan." };
}

/** Introspeksi langganan untuk UI (non-blocking, tidak pernah melempar). */
export async function getPushAlarmSubscriptionState(): Promise<PushAlarmSubscriptionState> {
  if (!isPushAlarmSupported()) return { subscribed: false, endpointHost: null };
  try {
    const registration = await navigator.serviceWorker.ready;
    const sub = await registration.pushManager.getSubscription();
    if (!sub) return { subscribed: false, endpointHost: null };
    return { subscribed: true, endpointHost: hostOf(sub.endpoint) };
  } catch {
    return { subscribed: false, endpointHost: null };
  }
}

/**
 * Tombol "Uji Push": GET ?action=testPush pada GAS PushService.
 * GAS memberi rate-limit global 60 detik — pesannya diteruskan apa adanya.
 */
export async function sendTestPushAlarm(): Promise<PushAlarmResult> {
  const config = resolvePushAlarmConfig();
  const check = validatePushAlarmConfig(config);
  if (!check.ok) {
    return { ok: false, state: "invalid-config", message: check.message || "Konfigurasi belum valid." };
  }
  try {
    const res = await fetchWithTimeout(`${config.apiBase}?action=testPush`, {
      method: "GET",
      credentials: "omit",
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
    if (!res.ok) {
      return { ok: false, state: "http-error", message: `GAS mengembalikan HTTP ${res.status}.` };
    }
    if (data && data.ok === false) {
      return { ok: false, state: "rejected", message: data.message || "GAS menolak uji push." };
    }
    return { ok: true, state: "sent", message: "Uji push terkirim — notifikasi seharusnya muncul beberapa detik lagi." };
  } catch (err) {
    return { ok: false, state: "network-error", message: `Gagal memanggil GAS: ${(err as Error).message}` };
  }
}

/** Deep-link target alarm (dipakai UI untuk tautan info). */
export { ALARM_VIEW_TARGET };
