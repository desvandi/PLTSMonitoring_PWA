// =============================================================================
// Push Alarm — shared helpers (pure, context-agnostic).
// -----------------------------------------------------------------------------
// Port dari pwa-push-alarm (PWA statis MonitorIoT) ke aplikasi Next.js utama.
// Modul ini dipakai dari DUA konteks sekaligus:
//   - src/sw.ts            (service worker — PushEvent, notificationclick)
//   - src/lib/push-alarm/client.ts + komponen React (halaman)
// Karena itu WAJIB bebas dari referensi `window` / `document` / API DOM lain.
//
// Kontrak payload alarm mengikuti GAS PushService.gs (normalizeAlarm_):
//   { id, title, body, severity: 'critical'|'warning'|'info',
//     tag, url, timestamp, requireInteraction }
// =============================================================================

export interface PushAlarmConfig {
  /** URL Web App GAS PushService (.../macros/s/<ID>/exec). */
  apiBase: string;
  /** Kunci publik VAPID (base64url, 65 byte = titik P-256 tak terkompresi). */
  vapidPublicKey: string;
}

/**
 * [SELF-AUDIT 2026-09-16] Device credentials for GAS push registration.
 * The CURRENT Code.gs (audit-2 K-7) REQUIRES `device.id` + `token` on the
 * `subscribe` action — the same device token the firmware sends for
 * `ingest` (validated against Script Property FW_DEVICE_TOKEN(S)). A
 * subscription registered without them is rejected fail-closed, so the PWA
 * must resolve and attach the ACTIVE device's identity before registering.
 */
export interface PushDeviceCredentials {
  deviceId: string;
  token: string;
}

/**
 * [SELF-AUDIT 2026-09-16] Build the GAS subscribe/unsubscribe body. Pure and
 * unit-testable (no DOM). When credentials are present they ride the body as
 * `device: { id }` + `token`; when absent the fields are OMITTED so the GAS
 * rejection message surfaces verbatim to the operator (honest fail-closed).
 */
export function buildSubscriptionBody(
  action: "subscribe" | "unsubscribe",
  endpoint: string,
  keys: { p256dh: string; auth: string },
  creds: PushDeviceCredentials | null,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    action,
    endpoint,
    keys,
  };
  if (creds && creds.deviceId && creds.token) {
    body.device = { id: creds.deviceId };
    body.token = creds.token;
  }
  return body;
}

export type AlarmSeverity = "critical" | "warning" | "info";

export interface AlarmPushPayload {
  /** GAS normalizeAlarm_ selalu mengirim string; number ditoleransi (JSON jaringan). */
  id?: string | number | null;
  title?: string | null;
  body?: string | null;
  severity?: string | null;
  tag?: string | null;
  url?: string | null;
  timestamp?: number | string | null;
  requireInteraction?: boolean | null;
  /**
   * [AUDIT p.482 REMEDIATION 2026-09] Capability token ACK — HMAC-SHA256
   * yang dihasilkan GAS PushService per-alarm dengan masa berlaku
   * terbatas (bucket waktu). Token ini adalah SATU-SATUNYA otorisasi
   * untuk aksi "Tandai Ditangani": siapa pun yang hanya mengetahui URL
   * GAS + alarmId TIDAK lagi bisa mengirim ACK palsu.
   */
  ackToken?: string | null;
}

/** Deep-link target saat notifikasi alarm diklik (view Alarms aplikasi). */
export const ALARM_VIEW_TARGET = "/?view=alarms&from=push";

export const PUSH_ALARM_CONFIG_STORAGE_KEY = "PLTS_PUSH_ALARM_CONFIG";
export const PUSH_ALARM_CONFIG_EVENT = "plts:push-alarm-updated";

/** localStorage diagnostik: host endpoint langganan (BUKAN kunci p256dh/auth). */
export const PUSH_ALARM_ENDPOINT_HOST_KEY = "plts.pushAlarm.endpointHost";

/**
 * Format URL Web App GAS yang valid. Sama ketatnya dengan gerbang
 * verify-deployment.js (K7): hanya https://script.google.com/macros/s/<ID>/exec.
 */
const GAS_WEBAPP_URL_RE = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/;

export function isValidGasWebAppUrl(url: string): boolean {
  return GAS_WEBAPP_URL_RE.test(url.trim());
}

/**
 * Konversi base64url (padding opsional) -> Uint8Array.
 * Implementasi murni tanpa atob/btoa agar identik di konteks halaman,
 * service worker, dan pengujian Node.
 */
export function urlBase64ToUint8Array(base64url: string): Uint8Array<ArrayBuffer> {
  let s = String(base64url).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const rem = s.length % 4;
  if (rem === 2) s += "==";
  else if (rem === 3) s += "=";

  const raw = atobPolyfill(s);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** atob untuk alfabet base64/base64url standar. */
function atobPolyfill(input: string): string {
  const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  // Normalisasi base64url -> base64 LEBIH DULU: tanpa ini karakter '-' dan '_'
  // terbuang oleh filter alfabet di bawah (byte hilang diam-diam).
  const str = input
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .replace(/[^A-Za-z0-9+/]/g, "");
  let out = "";
  let bits = 0;
  let acc = 0;
  for (let i = 0; i < str.length; i++) {
    const idx = B64.indexOf(str[i]);
    if (idx < 0) continue;
    // Jendela 14 bit: akumulator WAJIB di-mask — tanpa ini akumulator tumbuh
    // melewati 32 bit dan operator bitwise JS memotongnya (byte hilang).
    acc = ((acc << 6) | idx) & 0x3fff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((acc >>> bits) & 0xff);
    }
  }
  return out;
}

/**
 * Decode + validasi kunci publik VAPID: wajib 65 byte, prefiks 0x04
 * (titik kurva P-256 tak terkompresi) — identik dengan pemeriksaan
 * 65 byte pada tools/verify-deployment.js.
 */
export function decodeVapidPublicKey(key: string): Uint8Array<ArrayBuffer> | null {
  if (typeof key !== "string" || key.trim().length === 0) return null;
  try {
    const bytes = urlBase64ToUint8Array(key.trim());
    if (bytes.length !== 65 || bytes[0] !== 0x04) return null;
    return bytes;
  } catch {
    return null;
  }
}

export interface PushAlarmConfigValidation {
  ok: boolean;
  field?: "apiBase" | "vapidPublicKey";
  message?: string;
}

export function validatePushAlarmConfig(config: PushAlarmConfig): PushAlarmConfigValidation {
  if (typeof config.apiBase !== "string" || !isValidGasWebAppUrl(config.apiBase)) {
    return {
      ok: false,
      field: "apiBase",
      message:
        "URL GAS tidak valid. Harus berformat https://script.google.com/macros/s/<ID-deployment>/exec (hasil Deploy > Web app GAS PushService).",
    };
  }
  if (decodeVapidPublicKey(config.vapidPublicKey) === null) {
    return {
      ok: false,
      field: "vapidPublicKey",
      message:
        "Kunci publik VAPID tidak valid. Gunakan VAPID_PUBLIC_KEY 65-byte (base64url) dari Script Properties GAS / generate-vapid-keys.js.",
    };
  }
  return { ok: true };
}

// -----------------------------------------------------------------------------
// Opsi notifikasi alarm (dipakai service worker)
// -----------------------------------------------------------------------------

export interface AlarmNotificationContext {
  /** URL Web App GAS — dipakai sebagai ackUrl pada data notifikasi. */
  apiBase: string;
  iconUrl: string;
  badgeUrl: string;
  /** URL yang dibuka saat notifikasi diklik. */
  targetUrl: string;
}

export interface AlarmNotificationOptions {
  body: string;
  icon: string;
  badge: string;
  tag: string;
  renotify: boolean;
  requireInteraction: boolean;
  silent: boolean;
  vibrate: number[];
  timestamp: number;
  data: {
    url: string;
    alarmId: string | null;
    ackUrl: string;
    /** [p.482] Capability token ACK terikat alarm ini (null = payload lama). */
    ackToken: string | null;
    severity: AlarmSeverity;
  };
  actions: Array<{ action: string; title: string }>;
}

function normalizeSeverity(sev: string | null | undefined): AlarmSeverity {
  return sev === "critical" || sev === "warning" ? sev : "info";
}

function toTimestamp(value: number | string | null | undefined): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : Date.now();
}

/**
 * Bangun opsi notifikasi alarm (port buildAlarmOptions sw.js vanilla).
 * Catatan: `actions` & `badge` diabaikan Safari/iOS dengan aman
 * (progressive enhancement).
 */
export function buildAlarmNotificationOptions(
  payload: AlarmPushPayload,
  ctx: AlarmNotificationContext,
): AlarmNotificationOptions {
  const severity = normalizeSeverity(payload?.severity);
  const tag = payload?.tag || `alarm-${payload?.id || Date.now()}`;
  const isCritical = severity === "critical";
  const alarmId = payload?.id != null ? String(payload.id) : null;

  return {
    body: payload?.body || "",
    icon: ctx.iconUrl,
    badge: ctx.badgeUrl,
    tag,
    // notifikasi bertag sama menimpa yang lama; critical membunyikan ulang
    renotify: isCritical,
    requireInteraction: Boolean(payload?.requireInteraction) || isCritical,
    silent: false,
    vibrate: isCritical ? [300, 150, 300, 150, 300] : [200],
    timestamp: toTimestamp(payload?.timestamp),
    data: {
      url: ctx.targetUrl,
      alarmId,
      ackUrl: ctx.apiBase,
      // [p.482] Capability token ikut menempel pada notifikasi — SW
      // mengirimkannya saat ACK sehingga GAS dapat memverifikasi bahwa
      // permintaan berasal dari notifikasi yang benar-benar diterbitkan.
      ackToken: typeof payload?.ackToken === "string" && payload.ackToken.length > 0 ? payload.ackToken : null,
      severity,
    },
    actions: [
      { action: "view", title: "Lihat Detail" },
      { action: "ack", title: "Tandai Ditangani" },
    ],
  };
}

/** Judul aman untuk showNotification (payload bisa null pada fallback). */
export function alarmTitleOf(payload: AlarmPushPayload | null | undefined, fallback: string): string {
  const t = payload?.title;
  return typeof t === "string" && t.trim().length > 0 ? t : fallback;
}
