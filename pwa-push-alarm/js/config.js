/*
 * Konfigurasi aplikasi MonitorIoT PWA (Push Alarm standalone).
 * ------------------------------------------------------------------
 * [AUDIT p.493 / P0-1 REMEDIATION 2026-09-16]
 *
 * FILE INI ADALAH TEMPLATE DEFAULT — BUKAN tempat nilai produksi.
 * Nilai produksi disuntikkan saat BUILD oleh tools/build-config.js dari
 * environment variable (PUSH_API_BASE, PUSH_VAPID_PUBLIC_KEY). Repo
 * sengaja menyimpan string KOSONG (bukan URL palsu): deployment yang
 * belum diprovision akan menampilkan layar "Belum dikonfigurasi" yang
 * JUJUR, bukan gagal diam-diam dengan placeholder.
 *
 * API_BASE          : URL Web App Google Apps Script (GAS) — diisi saat
 *                     build dari PUSH_API_BASE, atau lewat layar setup
 *                     runtime (disimpan hanya di sessionStorage).
 * VAPID_PUBLIC_KEY  : kunci publik VAPID (base64url, P-256) — nilai
 *                     PUBLIK, aman ditanam di klien. Kunci PRIVAT hanya
 *                     di GAS (Script Properties), TIDAK PERNAH di sini.
 *
 * KREDENSIAL PERANGKAT (deviceId + push token) TIDAK lagi berada di file
 * ini dan TIDAK lagi dipersist di localStorage (audit p.493):
 *   - Dimasukkan lewat layar setup runtime → sessionStorage (sesi saja),
 *     dihapus saat tab/browser ditutup.
 *   - Diteruskan ke service worker hanya via postMessage — SW
 *     menyimpannya di MEMORI saja (hilang saat SW restart, halaman
 *     mengirim ulang saat dibuka).
 *   - Token yang dipakai adalah PUSH token khusus langganan (Script
 *     Property PUSH_TOKENS di GAS) — BUKAN FW_DEVICE_TOKEN yang dipakai
 *     firmware untuk ingest, sehingga kompromi PWA push tidak serta-merta
 *     menjadi kompromi kredensial ingest telemetry.
 */
'use strict';

const APP_CONFIG = {
  // Dibelakang layar: build-config.js menimpa ini dari PUSH_API_BASE.
  // Kosong = belum diprovision (build-time); runtime dapat diisi via setup.
  API_BASE: '',

  // Dibelakang layar: build-config.js menimpa ini dari PUSH_VAPID_PUBLIC_KEY.
  VAPID_PUBLIC_KEY: '',

  // [p.493] Kredensial perangkat TIDAK ada di sini. Lihat layar setup
  // runtime (sessionStorage) — dihapus dari template ini secara permanen.

  // Versi aplikasi - dipakai untuk diagnostik & cache busting:
  APP_VERSION: '2.1.0',

  // Interval polling data sensor (ms) saat aplikasi terbuka:
  POLL_INTERVAL_MS: 30000,

  // Batas waktu fetch ke GAS (ms):
  FETCH_TIMEOUT_MS: 15000,

  // Ambang sukses/failure sebelum menampilkan banner koneksi:
  CONNECTION_BANNER_AFTER_FAILURES: 2
};

/* Status provisioning build-time — build-config.js menulis true hanya bila
 * PUSH_API_BASE + PUSH_VAPID_PUBLIC_KEY valid terpasang. Aplikasi memakai
 * ini (plus provisioning runtime) untuk memutuskan: layar setup vs operasi
 * normal. Tidak ada lagi keadaan "placeholder yang tampak sehat". */
const APP_PROVISIONED = false;

// Membekukan konfigurasi agar tidak dapat diubah saat runtime (anti-tamper ringan).
try {
  Object.freeze(APP_CONFIG);
  Object.freeze(APP_PROVISIONED);
} catch (e) { /* older browsers: ignore */ }

// Ekspor untuk pengujian di Node (tidak berdampak di browser).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { APP_CONFIG: APP_CONFIG, APP_PROVISIONED: APP_PROVISIONED };
}
