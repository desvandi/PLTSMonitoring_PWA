/*
 * Konfigurasi aplikasi MonitorIoT PWA.
 * ------------------------------------------------------------------
 * API_BASE          : URL Web App Google Apps Script (deploy sebagai
 *                     "Anyone" untuk operasi subscribe/unsubscribe).
 * VAPID_PUBLIC_KEY  : kunci publik VAPID (base64url, kurva P-256).
 *                     Dibuat dengan tools/generate-vapid-keys.js.
 *                     Kunci PUBLIK aman ditanam di klien.
 *                     Kunci PRIVAT hanya disimpan di GAS
 *                     (Script Properties), TIDAK PERNAH di sini.
 */
'use strict';

const APP_CONFIG = {
  // Ganti dengan URL deployment GAS Anda:
  API_BASE: 'https://script.google.com/macros/s/AKfycbxGANTI_DENGAN_ID_DEPLOYMENT_ANDA/exec',

  // Ganti dengan public key VAPID milik Anda (dari generate-vapid-keys.js):
  VAPID_PUBLIC_KEY: 'BIiRx1N3GANTI_DENGAN_PUBLIC_KEY_VAPID_ANDA_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',

  // [SELF-AUDIT 2026-09-16] Kontrak GAS K-7: subscribe/unsubscribe wajib
  // autentikasi perangkat. Isi device id + token perangkat Anda (token yang
  // sama dengan yang dikirim firmware untuk `ingest`; GAS memvalidasinya
  // via Script Property FW_DEVICE_TOKEN / FW_DEVICE_TOKENS).
  // Alternatif tanpa mengedit file ini: set localStorage
  // 'push.deviceId' dan 'push.deviceToken' dari DevTools console.
  // Kosongkan keduanya bila backend GAS Anda masih versi lama (tanpa K-7).
  DEVICE_ID: '',
  DEVICE_TOKEN: '',

  // Versi aplikasi - dipakai untuk diagnostik & cache busting:
  APP_VERSION: '2.0.0',

  // Interval polling data sensor (ms) saat aplikasi terbuka:
  POLL_INTERVAL_MS: 30000,

  // Batas waktu fetch ke GAS (ms):
  FETCH_TIMEOUT_MS: 15000,

  // Ambang sukses/failure sebelum menampilkan banner koneksi:
  CONNECTION_BANNER_AFTER_FAILURES: 2
};

// Membekukan konfigurasi agar tidak dapat diubah saat runtime (anti-tamper ringan).
try {
  Object.freeze(APP_CONFIG);
} catch (e) { /* older browsers: ignore */ }

// Ekspor untuk pengujian di Node (tidak berdampak di browser).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = APP_CONFIG;
}
