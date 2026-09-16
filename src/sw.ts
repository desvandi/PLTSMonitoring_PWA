/// <reference lib="webworker" />
import { defaultCache } from "@serwist/next/worker";
import { Serwist } from "serwist";
import type { PrecacheEntry } from "serwist";
import {
  ALARM_VIEW_TARGET,
  alarmTitleOf,
  buildAlarmNotificationOptions,
  urlBase64ToUint8Array,
  type AlarmNotificationOptions,
  type AlarmPushPayload,
  type PushAlarmConfig,
} from "./lib/push-alarm/shared";
import { loadPushAlarmRuntimeConfig, savePushAlarmRuntimeConfig, sanitizePushAlarmConfig } from "./lib/push-alarm/sw-config-store";

declare const self: ServiceWorkerGlobalScope & {
  __SW_MANIFEST?: Array<PrecacheEntry | string>;
};

const sw = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  runtimeCaching: defaultCache,
});

sw.addEventListeners();

/* =============================================================================
 * PUSH ALARM — integrasi Web Push (Push API + VAPID) dari sistem push-alarm
 * MonitorIoT ke aplikasi Next.js utama. Notifikasi tetap tampil WALAU
 * aplikasi tertutup; pengiriman dilakukan GAS PushService.gs (satu-satunya
 * pengirim — aplikasi/firmware tidak pernah mengirim push sendiri).
 *
 * Konfigurasi (URL GAS + kunci publik VAPID) berlapis dua:
 *   1. Default build-time: NEXT_PUBLIC_PUSH_API_BASE / NEXT_PUBLIC_PUSH_VAPID_PUBLIC_KEY
 *      (di-inline saat `next build`).
 *   2. Override runtime operator: ditulis halaman ke IndexedDB + postMessage
 *      (pola zero-touch PLTS_SYS_CONFIG) — lebih tinggi prioritasnya.
 * ========================================================================== */

const BUILD_TIME_API_BASE =
  (typeof process !== "undefined" && process.env && process.env.NEXT_PUBLIC_PUSH_API_BASE) || "";
const BUILD_TIME_VAPID_KEY =
  (typeof process !== "undefined" && process.env && process.env.NEXT_PUBLIC_PUSH_VAPID_PUBLIC_KEY) || "";

const PUSH_ALARM_ICON = "/icon-192.png";
const PUSH_ALARM_BADGE = "/favicon-32.png";
const PUSH_ALARM_TITLE_FALLBACK = "Alarm PLTS Monitor";
const LATEST_ALARM_TIMEOUT_MS = 10000;

let pushAlarmConfigCache: PushAlarmConfig | null = null;

async function resolvePushAlarmConfig(): Promise<PushAlarmConfig> {
  if (pushAlarmConfigCache) return pushAlarmConfigCache;
  const stored = await loadPushAlarmRuntimeConfig().catch(() => null);
  pushAlarmConfigCache = {
    apiBase: stored?.apiBase || BUILD_TIME_API_BASE,
    vapidPublicKey: stored?.vapidPublicKey || BUILD_TIME_VAPID_KEY,
  };
  return pushAlarmConfigCache;
}

/* =============================================================================
 * Event `push` — inti alarm saat PWA tertutup.
 * Mode utama: payload terenkripsi (aes128gcm) berisi JSON alarm.
 * Mode fallback: push tanpa payload -> ambil alarm terbaru dari GAS.
 * ========================================================================== */

self.addEventListener("push", (event: PushEvent) => {
  event.waitUntil(handlePushEvent(event));
});

async function handlePushEvent(event: PushEvent): Promise<void> {
  let payload: AlarmPushPayload | null = null;
  if (event.data) {
    try {
      payload = event.data.json() as AlarmPushPayload;
    } catch {
      try {
        payload = { title: "Alarm", body: event.data.text() };
      } catch {
        payload = null;
      }
    }
  }
  if (!payload || !payload.title) {
    payload = await fetchLatestAlarmPayload();
  }
  const config = await resolvePushAlarmConfig();
  await showAlarmNotification(payload, config);
}

async function fetchLatestAlarmPayload(): Promise<AlarmPushPayload | null> {
  const config = await resolvePushAlarmConfig();
  if (!config.apiBase) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LATEST_ALARM_TIMEOUT_MS);
    const res = await fetch(`${config.apiBase}?action=latestAlarm`, {
      signal: controller.signal,
      credentials: "omit",
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as { ok?: boolean; alarm?: AlarmPushPayload } | null;
    if (!data || data.ok !== true || !data.alarm) return null;
    return data.alarm;
  } catch {
    return null;
  }
}

async function showAlarmNotification(payload: AlarmPushPayload | null, config: PushAlarmConfig): Promise<void> {
  const options: AlarmNotificationOptions = buildAlarmNotificationOptions(payload ?? {}, {
    apiBase: config.apiBase,
    iconUrl: PUSH_ALARM_ICON,
    badgeUrl: PUSH_ALARM_BADGE,
    targetUrl: ALARM_VIEW_TARGET,
  });
  const title = alarmTitleOf(payload, PUSH_ALARM_TITLE_FALLBACK);
  try {
    await self.registration.showNotification(title, options);
  } catch {
    // Fallback minimal bila opsi tertentu ditolak browser lama.
    await self.registration.showNotification(title, {
      body: options.body,
      tag: options.tag,
      data: options.data,
    });
  }
}

/* =============================================================================
 * Event `notificationclick` — fokus app + deep-link view Alarms;
 * aksi "ack" mengirim konfirmasi penanganan ke GAS (best-effort).
 * ========================================================================== */

self.addEventListener("notificationclick", (event: NotificationEvent) => {
  event.notification.close();
  event.waitUntil(handleNotificationClick(event));
});

async function handleNotificationClick(event: NotificationEvent): Promise<void> {
  const data = (event.notification.data ?? {}) as {
    alarmId?: string | null;
    ackUrl?: string;
    ackToken?: string | null;
  };

  if (event.action === "ack" && data.alarmId && data.ackUrl) {
    // [AUDIT p.482 REMEDIATION 2026-09] ACK sekarang membawa CAPABILITY
    // TOKEN (HMAC per-alarm, berlaku terbatas) yang diterbitkan GAS
    // PushService bersama notifikasi. Sebelumnya ACK dikirim dengan HANYA
    // alarmId — siapa pun yang mengetahui URL GAS + ID alarm bisa mengirim
    // ACK palsu (mutasi state tanpa autentikasi). Token inilah otorisasinya;
    // GAS (setelah update kontrak) menolak ACK tanpa token valid.
    // Tokenless send tetap dilakukan untuk kompatibilitas GAS lama saat
    // transisi (GAS baru yang meng-enforce).
    const ackBody: Record<string, unknown> = { action: "ackAlarm", alarmId: data.alarmId };
    if (typeof data.ackToken === "string" && data.ackToken.length > 0) {
      ackBody.ackToken = data.ackToken;
    }
    try {
      await fetch(data.ackUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(ackBody),
        credentials: "omit",
      });
    } catch {
      /* ack best-effort */
    }
  }
  await focusOrOpenAlarmView();
}

/**
 * Fokus jendela aplikasi yang sudah terbuka (navigasi via postMessage karena
 * view dikelola state zustand, bukan URL) atau buka jendela baru dengan
 * deep-link ?view=alarms. Selalu same-origin — menutup vektor phising
 * notifikasi yang membuka URL sembarangan dari payload.
 */
async function focusOrOpenAlarmView(): Promise<void> {
  const clientList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of clientList) {
    if ("focus" in client) {
      try {
        await client.focus();
      } catch {
        /* abaikan */
      }
      client.postMessage({ type: "PLTS_PUSH_ALARM_OPEN", view: "alarms" });
      return;
    }
  }
  if (self.clients.openWindow) {
    await self.clients.openWindow(alarmViewUrlAbsolute());
  }
}

function alarmViewUrlAbsolute(): string {
  return new URL(ALARM_VIEW_TARGET, self.location.origin).href;
}

/* =============================================================================
 * Event `pushsubscriptionchange` — langganan kedaluwarsa/dirotasi push
 * service: berlangganan ulang + perbarui endpoint di GAS.
 * ========================================================================== */

self.addEventListener("pushsubscriptionchange", (event: PushSubscriptionChangeEvent) => {
  event.waitUntil(resubscribePushAlarm());
});

async function resubscribePushAlarm(): Promise<void> {
  try {
    const existing = await self.registration.pushManager.getSubscription();
    if (!existing) return; // tidak ada sebelumnya -> jangan paksa-minta izin

    const config = await resolvePushAlarmConfig();
    // Tanpa kunci VAPID terkonfigurasi, langganan baru tidak bisa dibuat
    // konsisten dengan pengirim (GAS) -> lebih aman batal daripada menebak.
    if (!config.vapidPublicKey) return;

    await existing.unsubscribe().catch(() => undefined);
    const sub = await self.registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(config.vapidPublicKey),
    });

    if (!config.apiBase) return;
    const json = sub.toJSON();
    await fetch(config.apiBase, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        action: "subscribe",
        endpoint: sub.endpoint,
        keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
        context: { reason: "pushsubscriptionchange", addedAt: new Date().toISOString() },
      }),
      credentials: "omit",
    });
  } catch {
    // Resubscribe gagal (mis. izin dicabut) — aplikasi akan memeriksa ulang
    // saat dibuka (getPushAlarmSubscriptionState di panel Settings).
  }
}

/* =============================================================================
 * Event `message` — terima konfigurasi runtime dari halaman
 * (PLTS_PUSH_ALARM_CONFIG) selain pesan internal Serwist (SKIP_WAITING dsb.).
 * ========================================================================== */

self.addEventListener("message", (event: ExtendableMessageEvent) => {
  const data = event.data as { type?: string; config?: PushAlarmConfig } | null;
  if (data && typeof data.type === "string" && data.type === "PLTS_PUSH_ALARM_CONFIG" && data.config) {
    // [AUDIT p.491-old REMEDIATION 2026-09] The SW no longer trusts the
    // postMessage payload blindly — the STRICT sanitizer in
    // sw-config-store (GAS webapp URL format + 65-byte VAPID key) runs
    // BEFORE the config is cached or persisted. The validation chain is
    // now: input → validate (page) → persist → SW REVALIDATE → use.
    const candidate: PushAlarmConfig = {
      apiBase: String(data.config.apiBase || ""),
      vapidPublicKey: String(data.config.vapidPublicKey || ""),
    };
    const sanitized = sanitizePushAlarmConfig(candidate);
    if (!sanitized) {
      // Reject malformed config at the SW boundary — never cache or persist it.
      return;
    }
    pushAlarmConfigCache = sanitized;
    // Persist agar bertahan restart SW; best-effort.
    void savePushAlarmRuntimeConfig(sanitized).catch(() => undefined);
  }
});
