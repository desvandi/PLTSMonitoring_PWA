#!/usr/bin/env node
/*
 * build-config.js - [AUDIT P0-1 REMEDIATION 2026-09-16]
 * =====================================================================
 * Suntikkan konfigurasi PRODUKSI ke js/config.js saat build, dari env:
 *
 *   PUSH_API_BASE            URL Web App GAS (wajib, format /exec)
 *   PUSH_VAPID_PUBLIC_KEY    kunci publik VAPID base64url (wajib, 65 byte)
 *   PUSH_PROFILE             'production' | 'preview' (default: preview)
 *
 * Aturan kejujuran deployment (menutup temuan auditor: "production
 * plts-monitor-push-alarm masih menyajikan config placeholder"):
 *
 *   - PUSH_PROFILE=production: kedua env WAJIB terisi, bukan placeholder,
 *     dan format-nya valid. Salah satu gagal -> build GAGAL (exit 1).
 *     Tidak ada lagi artefak produksi yang tampak sehat tapi menunjuk ke
 *     server palsu.
 *   - PUSH_PROFILE=preview (default): env kosong diperbolehkan — file
 *     tetap digenerate dengan nilai kosong + APP_PROVISIONED=false, dan
 *     aplikasi menampilkan layar setup yang jujur (bukan gagal diam-diam).
 *   - Pemakaian lokal: node tools/build-config.js [--check]
 *     --check hanya memvalidasi TANPA menulis file (untuk CI).
 *
 * File sumber template (js/config.js di repo) selalu berisi string kosong;
 * build menulis salinan dengan nilai nyata SEBELUM deployment statis.
 * Kredensial perangkat TIDAK PERNAH lewat jalur ini (p.493: hanya via
 * provisioning runtime -> sessionStorage).
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'js', 'config.js');

const CHECK_ONLY = process.argv.includes('--check');
const PROFILE = (process.env.PUSH_PROFILE || 'preview').toLowerCase();

const PLACEHOLDER_RE = /GANTI_DENGAN|AKfycbxGANTI|CHANGEME|xxx|example\.com|localhost/i;

function envValue(name) {
  return String(process.env[name] || '').trim();
}

const failures = [];
function fail(msg) { failures.push(msg); }

/* ---------- 1. Baca & validasi env ---------- */
const apiBase = envValue('PUSH_API_BASE');
const vapid = envValue('PUSH_VAPID_PUBLIC_KEY');

const isProduction = PROFILE === 'production';

if (apiBase) {
  if (PLACEHOLDER_RE.test(apiBase)) {
    fail(`PUSH_API_BASE tampak seperti placeholder: "${apiBase.slice(0, 60)}..."`);
  }
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(apiBase)) {
    fail('PUSH_API_BASE bukan URL Web App GAS yang valid (https://script.google.com/macros/s/<ID>/exec).');
  }
} else if (isProduction) {
  fail('PUSH_API_BASE kosong — profil PRODUCTION wajib diisi (Vercel env pada project plts-monitor-push-alarm).');
}

if (vapid) {
  if (PLACEHOLDER_RE.test(vapid)) {
    fail('PUSH_VAPID_PUBLIC_KEY tampak seperti placeholder.');
  }
  const b64 = vapid.replace(/-/g, '+').replace(/_/g, '/');
  const bytes = Buffer.from(b64, 'base64');
  if (bytes.length !== 65 || bytes[0] !== 0x04) {
    fail(`PUSH_VAPID_PUBLIC_KEY tidak valid (harus 65 byte berprefiks 0x04, kurva P-256); diperoleh ${bytes.length} byte.`);
  }
} else if (isProduction) {
  fail('PUSH_VAPID_PUBLIC_KEY kosong — profil PRODUCTION wajib diisi.');
}

/* ---------- 2. Laporan & gate ---------- */
const provisioned = failures.length === 0 && !!apiBase && !!vapid;

if (failures.length > 0) {
  for (const f of failures) console.error('[FAIL] ' + f);
  console.error(`BUILD CONFIG = BLOCKED (profile: ${PROFILE}) — deployment tidak boleh dibangun dengan konfigurasi ini.`);
  process.exit(1);
}

console.log(`[OK] build-config profile=${PROFILE} provisioned=${provisioned}` +
  (apiBase ? ` apiBase=${apiBase.slice(0, 48)}...` : ' apiBase=<kosong — layar setup runtime>') +
  (vapid ? ` vapid=<${vapid.length} char>` : ' vapid=<kosong>'));

if (CHECK_ONLY) {
  console.log('[OK] --check: validasi selesai tanpa menulis file.');
  process.exit(0);
}

/* ---------- 3. Tulis config.js dengan nilai build-time ---------- */
// Vercel menyuntikkan commit SHA saat build — dicap ke artefak supaya
// smoke test pasca-deploy bisa membuktikan deployment baru benar-benar aktif.
const BUILD_COMMIT = envValue('VERCEL_GIT_COMMIT_SHA');

const template = `'use strict';

/*
 * config.js — DIHASILKAN OTOMATIS oleh tools/build-config.js saat build.
 * JANGAN edit manual; nilai berasal dari env PUSH_API_BASE /
 * PUSH_VAPID_PUBLIC_KEY. Template sumber ada di repo (string kosong).
 * Kredensial perangkat tidak pernah berada di file ini (audit p.493).
 */

const APP_CONFIG = {
  API_BASE: ${JSON.stringify(apiBase)},
  VAPID_PUBLIC_KEY: ${JSON.stringify(vapid)},
  APP_VERSION: '2.1.0',
  POLL_INTERVAL_MS: 30000,
  FETCH_TIMEOUT_MS: 15000,
  CONNECTION_BANNER_AFTER_FAILURES: 2
};

const APP_PROVISIONED = ${provisioned ? 'true' : 'false'};
const APP_BUILD_COMMIT = ${JSON.stringify(BUILD_COMMIT)};

try {
  Object.freeze(APP_CONFIG);
  Object.freeze(APP_PROVISIONED);
} catch (e) { /* older browsers: ignore */ }

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { APP_CONFIG: APP_CONFIG, APP_PROVISIONED: APP_PROVISIONED };
}
`;

fs.writeFileSync(CONFIG_PATH, template, 'utf8');
console.log(`[OK] menulis ${path.relative(ROOT, CONFIG_PATH)} (APP_PROVISIONED=${provisioned}).`);
process.exit(0);
