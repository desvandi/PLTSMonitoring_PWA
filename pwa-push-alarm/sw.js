/*
 * sw.js - Service Worker MonitorIoT (PWA alarm monitoring).
 * ------------------------------------------------------------------
 * Fitur:
 *  - Precache app shell + strategi fetch (network-first navigasi,
 *    stale-while-revalidate aset statis, network-only API data).
 *  - Event `push`            : render notifikasi alarm dari payload
 *                              terenkripsi (aes128gcm); fallback tanpa
 *                              payload -> ambil alarm terbaru dari GAS.
 *  - Event `pushsubscriptionchange` : buat ulang langganan & kirim ke GAS.
 *  - Event `notificationclick`      : fokus jendela ada / buka URL;
 *                              aksi "ack" mengirim konfirmasi ke GAS.
 *  - Event `message` (SKIP_WAITING): pembaruan SW tanpa menunggu.
 *  - Event `periodicsync` (bila didukung): refresh data di latar belakang.
 */
'use strict';

const SW_VERSION = 'v2.0.0';
const CACHE_STATIC = 'miot-static-' + SW_VERSION;
const CACHE_DATA = 'miot-data-' + SW_VERSION;

/* [AUDIT p.493 / P0-1 REMEDIATION 2026-09-16]
 *
 * API_BASE tidak lagi ditanam placeholder di file ini (penyebab push
 * fallback & ACK mengarah ke server palsu di production). Sumber kini:
 *
 *   1. postMessage PLTS_PUSH_ALARM_RUNTIME_CONFIG dari halaman (memori)
 *      — halaman mengirim ulang setiap dibuka.
 *   2. Cache precache './js/config.js' — nilai build-time non-rahasia
 *      (URL GAS + public key VAPID memang nilai publik).
 *
 * Kredensial perangkat (deviceId/token) tetap HANYA di memori via
 * postMessage — tidak pernah dipersist dan tidak pernah masuk cache. */
let runtimeApiBase = null;
let deviceCredentials = null;

async function getApiBase_() {
  if (runtimeApiBase) return runtimeApiBase;
  try {
    const cached = await caches.match('./js/config.js');
    if (cached) {
      const src = await cached.text();
      // Terima kutip tunggal (template repo) maupun kutip ganda (hasil
      // build-config.js yang memakai JSON.stringify).
      const m = /API_BASE:\s*['"]([^'"]*)['"]/.exec(src);
      if (m && m[1] && m[1].indexOf('GANTI_DENGAN') === -1) {
        runtimeApiBase = m[1];
        return runtimeApiBase;
      }
    }
  } catch (e) { /* cache tak terbaca: null */ }
  return null;
}

const PRECACHE_URLS = [
  './',
  './index.html',
  './css/style.css',
  './js/config.js',
  './js/push-manager.js',
  './js/app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/badge-72.png'
];

/* ================================================================== */
/* INSTALL / ACTIVATE                                                  */
/* ================================================================== */

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_STATIC);
      // addAll bersifat atomik; satu aset gagal -> install gagal (aman).
      await cache.addAll(PRECACHE_URLS);
      await self.skipWaiting(); // aktifkan versi baru segera
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Hapus cache lama.
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith('miot-') && k !== CACHE_STATIC && k !== CACHE_DATA)
          .map((k) => caches.delete(k))
      );
      await self.clients.claim(); // kendalikan klien tanpa reload
    })()
  );
});

/* ================================================================== */
/* FETCH                                                               */
/* ================================================================== */

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Hanya tangani GET; POST ke GAS (subscribe/alarm) diteruskan apa adanya.
  if (req.method !== 'GET') return;

  // 1) Navigasi halaman: network-first, fallback offline ke cache shell.
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          return await networkFirstNavigation(req);
        } catch (err) {
          const cached = await caches.match('./index.html', { ignoreSearch: true });
          return cached || new Response(
            '<!doctype html><title>Offline</title><p>Anda sedang offline. Buka kembali saat koneksi tersedia.</p>',
            { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
          );
        }
      })()
    );
    return;
  }

  // 2) Permintaan ke API GAS: network-only (data alarm harus segar,
  //    data basi berbahaya). Simpan salinan terakhir yang sukses
  //    sebagai cache diagnostik "last good" (tidak dipakai otomatis).
  if (url.origin === 'https://script.google.com' ||
      url.origin === 'https://script.googleusercontent.com') {
    event.respondWith(
      fetch(req).then((res) => {
        if (res.ok && url.pathname.includes('/exec')) {
          const clone = res.clone();
          caches.open(CACHE_DATA).then((c) => c.put(req, clone)).catch(() => {});
        }
        return res;
      }).catch(() => new Response(
        JSON.stringify({ ok: false, offline: true, message: 'Offline: data sensor tidak tersedia.' }),
        { status: 503, headers: { 'Content-Type': 'application/json' } }
      ))
    );
    return;
  }

  // 3) Aset origin sendiri: stale-while-revalidate.
  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(req));
  }
  // Cross-origin lainnya (font eksternal dsb.) tidak diintervensi.
});

async function networkFirstNavigation(req) {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('nav-timeout')), 8000));
  try {
    const fresh = await Promise.race([fetch(req), timeout]);
    if (fresh && fresh.ok) {
      const cache = await caches.open(CACHE_STATIC);
      cache.put('./index.html', fresh.clone()).catch(() => {});
      return fresh;
    }
    throw new Error('nav-not-ok');
  } catch (e) {
    const cached = await caches.match('./index.html', { ignoreSearch: true });
    if (cached) return cached;
    throw e;
  }
}

async function staleWhileRevalidate(req) {
  const cached = await caches.match(req);
  const refresh = fetch(req).then((res) => {
    if (res && res.ok && res.type === 'basic') {
      const clone = res.clone();
      caches.open(CACHE_STATIC).then((c) => c.put(req, clone)).catch(() => {});
    }
    return res;
  }).catch(() => null);
  return cached || (await refresh) || new Response('', { status: 504 });
}

/* ================================================================== */
/* PUSH - inti alarm saat PWA tertutup                                 */
/* ================================================================== */

self.addEventListener('push', (event) => {
  event.waitUntil(handlePush(event));
});

async function handlePush(event) {
  let payload = null;
  if (event.data) {
    try {
      // Mode utama: payload terenkripsi (aes128gcm) berisi JSON alarm.
      payload = event.data.json();
    } catch (e) {
      try { payload = { title: 'Alarm', body: event.data.text() }; }
      catch (e2) { payload = null; }
    }
  }

  // Mode fallback: push tanpa payload -> ambil alarm terbaru dari GAS.
  if (!payload || !payload.title) {
    payload = await fetchLatestAlarm();
  }

  return showAlarmNotification(payload || {
    title: 'Alarm MonitorIoT',
    body: 'Terjadi alarm pada sistem monitoring. Buka aplikasi untuk detail.'
  });
}

/**
 * Push tanpa payload (Content-Length 0). Service worker tetap bangkit,
 * lalu mengambil ringkasan alarm terbaru dari GAS. Gagal fetch ->
 * notifikasi generik (tetap memenuhi janji userVisibleOnly).
 */
async function fetchLatestAlarm() {
  try {
    const apiBase = await getApiBase_();
    if (!apiBase) return null; // belum diprovision — jangan fetch ke server palsu
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10000);
    const res = await fetch(apiBase + '?action=latestAlarm', {
      signal: ctrl.signal,
      credentials: 'omit'
    });
    clearTimeout(t);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || !data.ok || !data.alarm) return null;
    return data.alarm;
  } catch (err) {
    return null;
  }
}

/**
 * Menampilkan notifikasi alarm dengan opsi anti-spam dan prioritas.
 * Skema payload (dari GAS):
 * { id, title, body, severity: 'critical'|'warning'|'info',
 *   tag, url, timestamp, requireInteraction }
 */
function buildAlarmOptions(p) {
  const severity = p.severity || 'info';
  const tag = p.tag || ('alarm-' + (p.id || Date.now()));
  const isCritical = severity === 'critical';

  return {
    body: p.body || '',
    icon: './icons/icon-192.png',
    badge: './icons/badge-72.png',
    tag: tag,             // notifikasi dengan tag sama menimpa yang lama
    renotify: isCritical, // critical: bunyi ulang walau tag sama
    requireInteraction: isCritical, // critical: menetap sampai ditindak
    silent: false,
    vibrate: isCritical ? [300, 150, 300, 150, 300] : [200],
    timestamp: p.timestamp ? Number(p.timestamp) : Date.now(),
    data: {
      url: p.url || './index.html?from=push',
      alarmId: p.id || null,
      // [P0-1] ackUrl diisi SAAT notifikasi dibuat (bukan konstanta file):
      // nilai berasal dari runtime config halaman yang mengirim payload,
      // atau dari cache build-time — tidak lagi dari placeholder permanen.
      ackUrl: (typeof p.apiBase === 'string' && p.apiBase) ? p.apiBase : null,
      // [audit p.482 REMEDIATION 2026-09] Capability token ACK (HMAC
      // per-alarm, berlaku terbatas) yang diterbitkan GAS PushService
      // bersama notifikasi. ACK tanpa token valid akan ditolak GAS — siapa
      // pun yang hanya mengetahui URL + alarmId tidak bisa lagi mengirim
      // ACK palsu.
      ackToken: (typeof p.ackToken === 'string' && p.ackToken.length > 0) ? p.ackToken : null,
      severity: severity
    },
    actions: [
      { action: 'view', title: 'Lihat Detail' },
      { action: 'ack', title: 'Tandai Ditangani' }
    ]
  };
  // Catatan: Notification.actions & badge tidak didukung di Safari/iOS:
  // browser akan mengabaikannya dengan aman (progressive enhancement).
}

async function showAlarmNotification(p) {
  const options = buildAlarmOptions(p);
  try {
    await self.registration.showNotification(p.title || 'Alarm MonitorIoT', options);
  } catch (err) {
    // Fallback minimal bila opsi tertentu ditolak (browser lama).
    await self.registration.showNotification(p.title || 'Alarm MonitorIoT', {
      body: options.body, tag: options.tag, data: options.data
    });
  }
}

/* ================================================================== */
/* NOTIFICATIONCLICK                                                   */
/* ================================================================== */

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(handleNotificationClick(event));
});

async function handleNotificationClick(event) {
  const data = event.notification.data || {};
  const action = event.action;
  // [audit-2 K-5 FIX] Validate target URL is same-origin. The previous code
  // used `new URL(data.url, base)` which IGNORES base when data.url is
  // absolute — an attacker with VAPID private key could send
  // data.url='https://evil-phishing.example/' and the SW would open it from
  // a notification that looks legitimate. Force same-origin; if the URL is
  // cross-origin, fall back to the app's alarm view.
  var fallbackUrl = './index.html?from=push';
  var targetUrl;
  try {
    var parsed = new URL(data.url || fallbackUrl, self.location.origin);
    if (parsed.origin !== self.location.origin) {
      // Cross-origin URL in push payload — suspicious. Use fallback.
      targetUrl = new URL(fallbackUrl, self.location.origin).href;
    } else {
      targetUrl = parsed.href;
    }
  } catch (e) {
    targetUrl = new URL(fallbackUrl, self.location.origin).href;
  }

  // Aksi "ack": kirim konfirmasi penanganan alarm ke GAS, tanpa membuka app.
  if (action === 'ack' && data.alarmId) {
    // [audit-2 K-5 + P0-1] ackUrl dikirim bersama notifikasi oleh GAS/halaman
    // (data.ackUrl). Tanpa ackUrl yang valid, ACK dilewati — tidak ada lagi
    // konstanta placeholder yang bisa mengirim ACK ke server palsu.
    try {
      if (data.ackUrl) {
        var ackParsed = new URL(data.ackUrl, self.location.origin);
        var trustedOrigins = [self.location.origin];
        // Allow GAS script.google.com (the only legitimate ack target).
        if (ackParsed.hostname === 'script.google.com') {
          trustedOrigins.push(ackParsed.origin);
        }
        if (trustedOrigins.indexOf(ackParsed.origin) !== -1) {
        // [audit p.482 REMEDIATION 2026-09] ACK membawa capability token dari
        // notifikasi — otorisasi ACK kalah kriptografis, bukan sekadar
        // pengetahuan URL + alarmId.
        var ackBody = { action: 'ackAlarm', alarmId: data.alarmId };
        if (typeof data.ackToken === 'string' && data.ackToken.length > 0) {
          ackBody.ackToken = data.ackToken;
        }
        await fetch(ackParsed.href, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(ackBody),
          credentials: 'omit'
        });
        }
      }
    } catch (e) { /* ack best-effort */ }
    // Tetap buka app agar pengguna melihat status alarm.
    return openOrFocus(targetUrl);
  }

  return openOrFocus(targetUrl);
}

/** Fokus tab yang sudah ada (dengan URL sama) atau buka jendela baru. */
async function openOrFocus(targetUrl) {
  const clientList = await self.clients.matchAll({
    type: 'window',
    includeUncontrolled: true
  });
  for (const client of clientList) {
    if ('focus' in client) {
      if (client.url === targetUrl) {
        return client.focus();
      }
    }
  }
  if (self.clients.openWindow) {
    return self.clients.openWindow(targetUrl);
  }
}

/* ================================================================== */
/* PUSHSUBSCRIPTIONCHANGE - pembaruan langganan otomatis               */
/* ================================================================== */

self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(resubscribe());
});

/**
 * Browser memanggil event ini ketika langganan kedaluwarsa/berubah
 * (mis. pengguna membersihkan data situs, push service merotasi token).
 * Kita berlangganan ulang lalu memperbarui endpoint di GAS.
 */
async function resubscribe() {
  try {
    const reg = await self.registration.pushManager.getSubscription();
    if (!reg) return; // tidak ada sebelumnya -> tidak paksa-minta izin

    // [SELF-AUDIT 2026-09-16] GAS K-7: re-registrasi WAJIB kredensial.
    // Tanpa kredensial (SW dingin, halaman belum dibuka) -> BATAL: mendaftar
    // lokal tanpa registrasi server hanya menciptakan keadaan "berlangganan"
    // palsu yang diam-diam tidak menerima apa pun. Endpoint basi akan
    // dipangkas GAS saat push berikutnya memantul 410; operator mengaktifkan
    // ulang dari panel saat aplikasi dibuka.
    if (!deviceCredentials) return;
    const apiBase = await getApiBase_();
    if (!apiBase) return; // belum diprovision — jangan kirim ke server palsu

    // Ambil applicationServerKey lama agar konsisten.
    const oldKey = reg.options && reg.options.applicationServerKey;

    await reg.unsubscribe().catch(() => {});
    const sub = await self.registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: oldKey
    });

    await fetch(apiBase, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'subscribe',
        device: { id: deviceCredentials.deviceId },
        token: deviceCredentials.token,
        endpoint: sub.endpoint,
        keys: sub.toJSON().keys,
        context: { reason: 'pushsubscriptionchange', addedAt: new Date().toISOString() }
      })
    });
  } catch (err) {
    // Resubscribe gagal (mis. izin dicabut). Tidak ada yang bisa dilakukan
    // di latar belakang; PWA akan memeriksa ulang saat dibuka.
  }
}

/* ================================================================== */
/* MESSAGE (update SW) & PERIODIC SYNC                                 */
/* ================================================================== */

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }
  // [AUDIT p.493 / P0-1] Runtime config non-rahasia dari halaman: URL GAS
  // dipakai untuk fallback latestAlarm + ACK. Bernilai publik (URL Web
  // App), tetap hanya di MEMORI SW — tidak dipersist.
  if (event.data && typeof event.data === 'object' &&
      event.data.type === 'PLTS_PUSH_ALARM_RUNTIME_CONFIG') {
    var cfg = event.data.config || {};
    if (typeof cfg.apiBase === 'string' &&
        cfg.apiBase.indexOf('https://') === 0 &&
        cfg.apiBase.indexOf('GANTI_DENGAN') === -1) {
      runtimeApiBase = cfg.apiBase;
    } else {
      runtimeApiBase = null;
    }
    return;
  }
  // [SELF-AUDIT 2026-09-16 / p.493] Kredensial perangkat dari halaman
  // (kontrak GAS K-7; kini bersumber sessionStorage, bukan localStorage).
  // Payload divalidasi bentuknya; null/invalid menghapus kredensial
  // lama (logout propagasi ke SW). Tidak dipersist ke cache/IndexedDB.
  if (event.data && typeof event.data === 'object' &&
      event.data.type === 'PLTS_PUSH_ALARM_DEVICE_CREDENTIALS') {
    var c = event.data.credentials;
    if (c && typeof c.deviceId === 'string' && typeof c.token === 'string' &&
        c.deviceId.trim() && c.token.trim()) {
      deviceCredentials = { deviceId: c.deviceId.trim(), token: c.token.trim() };
    } else {
      deviceCredentials = null;
    }
    return;
  }
  // Hook pengujian: simulasi event push dengan payload tertentu.
  // Dipakai oleh smoke test otomatis; tidak berbahaya di produksi karena
  // hanya membangun opsi notifikasi lokal (tanpa efek samping jaringan).
  if (event.data && event.data.__smokeTestPush && event.ports && event.ports[0]) {
    const payload = event.data.__smokeTestPush;
    let options = null;
    try { options = buildAlarmOptions(payload); } catch (e) { /* abaikan */ }
    event.ports[0].postMessage({ ok: !!options, options: options });
  }
});

// Periodic Background Sync (Chrome/Edge, terpasang + terjadwal):
// menyegarkan data sehingga alarm yang terlewat saat offline tetap tampil.
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'miot-refresh') {
    event.waitUntil(refreshLatestData());
  }
});

async function refreshLatestData() {
  try {
    const apiBase = await getApiBase_();
    if (!apiBase) return; // belum diprovision
    const res = await fetch(apiBase + '?action=snapshot', { credentials: 'omit' });
    if (res.ok) {
      const cache = await caches.open(CACHE_DATA);
      await cache.put(apiBase + '?action=snapshot', res.clone());
    }
  } catch (e) { /* offline: abaikan */ }
}
