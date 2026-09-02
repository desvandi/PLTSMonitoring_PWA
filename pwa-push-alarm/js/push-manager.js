/*
 * AlarmPushManager - manajemen langganan Web Push (Push API + VAPID).
 * ------------------------------------------------------------------
 * Tanggung jawab:
 *  1. Deteksi dukungan browser (service worker, Push API, Notifikasi).
 *  2. Meminta izin notifikasi HANYA dari gestur pengguna (klik tombol).
 *  3. Membuat langganan push dengan applicationServerKey (kunci publik
 *     VAPID) dan mengirimkannya ke backend GAS untuk disimpan.
 *  4. Membatalkan langganan dan memberi tahu GAS saat dinonaktifkan.
 *  5. Menyediakan util konversi base64url -> Uint8Array.
 *
 * Handler event push / notificationclick / pushsubscriptionchange
 * berada di sw.js (service worker), bukan di sini.
 */
'use strict';

class AlarmPushManager {
  /**
   * @param {string} apiBase       URL Web App GAS
   * @param {string} vapidPublicKey Kunci publik VAPID (base64url)
   */
  constructor(apiBase, vapidPublicKey) {
    this.apiBase = apiBase;
    this.vapidPublicKey = vapidPublicKey;
    this._reg = null; // ServiceWorkerRegistration cache
  }

  /* ------------------------------------------------------------------ */
  /* Dukungan browser                                                    */
  /* ------------------------------------------------------------------ */

  isSupported() {
    return (
      typeof navigator !== 'undefined' &&
      'serviceWorker' in navigator &&
      typeof window !== 'undefined' &&
      'PushManager' in window &&
      'Notification' in window &&
      'showNotification' in ServiceWorkerRegistration.prototype
    );
  }

  async getRegistration() {
    if (!this.isSupported()) return null;
    if (this._reg) return this._reg;
    this._reg = await navigator.serviceWorker.getRegistration();
    return this._reg;
  }

  getPermissionState() {
    if (typeof Notification === 'undefined' || !Notification.permission) {
      return 'unsupported';
    }
    return Notification.permission; // 'granted' | 'denied' | 'default'
  }

  /* ------------------------------------------------------------------ */
  /* Aktivasi (dipanggil dari klik tombol = gestur pengguna)             */
  /* ------------------------------------------------------------------ */

  /**
   * Alur: cek dukungan -> minta izin -> subscribe -> kirim ke GAS.
   * Mengembalikan objek status { ok, state, message, subscription }.
   */
  async enable() {
    if (!this.isSupported()) {
      return this._result(false, 'unsupported',
        'Browser ini tidak mendukung Push API. Gunakan Chrome/Edge (desktop/Android) ' +
        'atau Safari 16.4+ dengan PWA yang terpasang di layar utama (iOS).');
    }

    if (this.getPermissionState() === 'denied') {
      return this._result(false, 'denied',
        'Izin notifikasi diblokir. Buka pengaturan browser -> izin situs -> ' +
        'izinkan Notifikasi, lalu coba lagi.');
    }

    // 1. Minta izin (harus berada dalam rantai gestur pengguna).
    let permission;
    try {
      permission = await Notification.requestPermission();
    } catch (err) {
      return this._result(false, 'error', 'Gagal meminta izin notifikasi: ' + err.message);
    }
    if (permission !== 'granted') {
      return this._result(false, permission,
        permission === 'denied'
          ? 'Izin notifikasi ditolak. Aktifkan manual dari pengaturan situs.'
          : 'Izin belum diberikan, langganan push dibatalkan.');
    }

    // 2. Pastikan service worker aktif.
    const reg = await this.getRegistration();
    if (!reg) {
      return this._result(false, 'no-sw',
        'Service worker belum terdaftar. Muat ulang halaman lalu coba lagi.');
    }
    await navigator.serviceWorker.ready;

    // 3. Hindari langganan ganda: pakai ulang langganan lama bila masih valid.
    let sub = null;
    try {
      sub = await reg.pushManager.getSubscription();
    } catch (err) { /* lanjut buat baru */ }

    const appKey = AlarmPushManager.urlBase64ToUint8Array(this.vapidPublicKey);

    // Jika langganan lama dibuat dengan kunci VAPID berbeda -> buang.
    if (sub && !this._matchesApplicationServerKey(sub, appKey)) {
      try { await sub.unsubscribe(); } catch (e) { /* abaikan */ }
      sub = null;
    }

    if (!sub) {
      try {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true, // wajib: Chrome mewajibkan notifikasi terlihat
          applicationServerKey: appKey
        });
      } catch (err) {
        return this._result(false, 'subscribe-error',
          this._humanizeSubscribeError(err));
      }
    }

    // 4. Daftarkan langganan ke backend GAS.
    const sent = await this._sendSubscriptionToServer(sub, 'subscribe');
    if (!sent.ok) {
      // Rollback: tanpa registrasi server, langganan tidak berguna.
      try { await sub.unsubscribe(); } catch (e) { /* abaikan */ }
      return this._result(false, 'server-error',
        'Langganan berhasil dibuat tetapi gagal disimpan di server: ' + sent.message);
    }

    this._rememberEndpoint(sub);
    return this._result(true, 'enabled', 'Notifikasi alarm aktif di perangkat ini.', sub);
  }

  /* ------------------------------------------------------------------ */
  /* Deaktivasi                                                          */
  /* ------------------------------------------------------------------ */

  async disable() {
    const reg = await this.getRegistration();
    if (!reg) return this._result(true, 'disabled', 'Tidak ada langganan aktif.');
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      // Beri tahu server LEBIH DULU agar endpoint dihapus dari daftar kirim.
      await this._sendSubscriptionToServer(sub, 'unsubscribe');
      try { await sub.unsubscribe(); } catch (e) { /* abaikan */ }
    }
    try { localStorage.removeItem('push.endpoint'); } catch (e) { /* abaikan */ }
    return this._result(true, 'disabled', 'Notifikasi alarm dimatikan.');
  }

  /* ------------------------------------------------------------------ */
  /* Introspeksi untuk UI                                                */
  /* ------------------------------------------------------------------ */

  async getState() {
    if (!this.isSupported()) return { supported: false, permission: 'unsupported', subscribed: false };
    const reg = await this.getRegistration();
    const sub = reg ? await reg.pushManager.getSubscription().catch(() => null) : null;
    return {
      supported: true,
      permission: this.getPermissionState(),
      subscribed: !!sub,
      endpointHost: sub ? this._hostOf(sub.endpoint) : null
    };
  }

  /* ------------------------------------------------------------------ */
  /* Internal                                                            */
  /* ------------------------------------------------------------------ */

  async _sendSubscriptionToServer(subscription, action) {
    const payload = {
      action: action, // 'subscribe' | 'unsubscribe'
      endpoint: subscription.endpoint,
      keys: {
        p256dh: subscription.toJSON().keys.p256dh,
        auth: subscription.toJSON().keys.auth
      },
      context: {
        lang: (navigator.language || 'id').slice(0, 8),
        tz: this._safeIntlTimeZone(),
        ua: navigator.userAgent.slice(0, 180),
        addedAt: new Date().toISOString()
      }
    };
    try {
      const res = await this._fetchWithTimeout(this.apiBase, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        // text/plain menghindari preflight CORS OPTIONS di GAS Web App.
        body: JSON.stringify(payload)
      });
      if (!res.ok) return { ok: false, message: 'HTTP ' + res.status };
      const data = await res.json().catch(() => ({}));
      if (data && data.ok === false) {
        return { ok: false, message: data.message || 'Server menolak langganan.' };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err.message || 'Kesalahan jaringan.' };
    }
  }

  _fetchWithTimeout(url, options) {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), 15000) : null;
    const opts = ctrl ? Object.assign({}, options, { signal: ctrl.signal }) : options;
    return fetch(url, opts).finally(() => { if (timer) clearTimeout(timer); });
  }

  _matchesApplicationServerKey(subscription, appKey) {
    try {
      const opt = subscription.options;
      if (!opt || !opt.applicationServerKey) return false;
      const cur = new Uint8Array(opt.applicationServerKey);
      if (cur.length !== appKey.length) return false;
      for (let i = 0; i < cur.length; i++) {
        if (cur[i] !== appKey[i]) return false;
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  _humanizeSubscribeError(err) {
    const msg = (err && err.message) || String(err);
    if (/permission|denied|denied/i.test(msg)) {
      return 'Izin notifikasi ditolak sistem/browser: ' + msg;
    }
    if (/applicationServerKey|VAPID|key/i.test(msg)) {
      return 'Kunci VAPID tidak valid / tidak cocok: ' + msg;
    }
    if (/AbortError|timeout/i.test(msg)) {
      return 'Waktu habis saat menghubungi push service.';
    }
    return 'Gagal membuat langganan push: ' + msg;
  }

  _rememberEndpoint(sub) {
    // Endpoint saja untuk diagnostik. Kunci p256dh/auth TIDAK disimpan
    // di localStorage (dapat dipakai pihak lain untuk mengirim push).
    try { localStorage.setItem('push.endpoint', this._hostOf(sub.endpoint)); } catch (e) { /* abaikan */ }
  }

  _hostOf(urlStr) {
    try { return new URL(urlStr).host; } catch (e) { return ''; }
  }

  _safeIntlTimeZone() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { return ''; }
  }

  _result(ok, state, message, subscription) {
    return { ok: ok, state: state, message: message, subscription: subscription || null };
  }
}

/* Util global ------------------------------------------------------- */

/**
 * Konversi base64url (tanpa padding) ke Uint8Array untuk
 * applicationServerKey. Menangani base64 biasa dan base64url,
 * dengan padding opsional.
 */
AlarmPushManager.urlBase64ToUint8Array = function (base64url) {
  // [FIX 2026-09-01] Normalisasi arah WAJIB base64url -> base64 SEBELUM atob:
  // atob browser hanya menerima A-Za-z0-9+/ dan MELEMPAR InvalidCharacterError
  // saat kunci VAPID memuat '-'/'_' (~93% kunci P-256 acak). Arah lama (+->-)
  // justru mengubah ke alfabet yang ditolak atob.
  let s = String(base64url).replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  const rem = s.length % 4;
  if (rem === 2) s += '==';
  else if (rem === 3) s += '=';

  // atob -> string biner -> Uint8Array
  const raw = atob(s);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
};

// Ekspor untuk pengujian Node.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = AlarmPushManager;
}
