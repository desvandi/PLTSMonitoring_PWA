#!/usr/bin/env node
/**
 * live-smoke-test.mjs — [AUDIT P0 CI-BINDING 2026-09-16]
 * =====================================================================
 * Menutup temuan auditor: "CI PASS → Vercel BUILD PASS → Production tetap
 * salah konfigurasi" — validator selama ini berjalan dengan environment
 * SINTETIS, terpisah dari build, dan tidak pernah melihat deployment nyata.
 *
 * Script ini memeriksa DEPLOYMENT PRODUKSI AKTIF setelah Vercel selesai:
 *
 *   Monitoring PWA (Mode A/B):
 *     - /api/health 200 + release.inSync (live tag == release-policy.json)
 *     - commit SHA live == SHA yang barusan di-push (bukti deployment baru)
 *     - deploymentMode eksplisit (browser-configured vs server-assisted)
 *     - security header hidup: CSP nonce-able, HSTS, XFO DENY, nosniff
 *
 *   Push Alarm (P0-1):
 *     - /js/config.js TIDAK berisi placeholder (GANTI_DENGAN dst.)
 *     - salah satu: (a) terprovision penuh (URL GAS valid + VAPID 65 byte),
 *       atau (b) status JUJUR "belum terprovision" (APP_PROVISIONED = false)
 *     - /sw.js tidak lagi menanam konstanta API_BASE
 *
 * Usage:
 *   node scripts/live-smoke-test.mjs \
 *     --monitoring https://jmse-plts-monitoring.vercel.app \
 *     --push-alarm https://plts-monitor-push-alarm.vercel.app \
 *     --expect-sha <git-sha>            # opsional; retry sampai cocok
 *     --require-provisioned             # wajib untuk gate rilis (tag v*)
 *
 * Exit: 0 = PASS, 1 = FAIL (memblokir release/gate).
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const argv = process.argv.slice(2);
function argValue(name) {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
}

const MONITORING = argValue("--monitoring") || process.env.MONITORING_URL || "";
const PUSH_ALARM = argValue("--push-alarm") || process.env.PUSH_ALARM_URL || "";
const EXPECT_SHA = argValue("--expect-sha") || process.env.EXPECTED_SHA || "";
const REQUIRE_PROVISIONED = argv.includes("--require-provisioned") ||
  process.env.REQUIRE_PROVISIONED === "true";

const PLACEHOLDER_RE = /GANTI_DENGAN|AKfycbxGANTI|CHANGEME|example\.com/i;

if (!MONITORING || !PUSH_ALARM) {
  console.error("[FAIL] --monitoring dan --push-alarm wajib diisi.");
  process.exit(1);
}

const failures = [];
const passes = [];
const fail = (m) => failures.push(m);
const pass = (m) => passes.push(m);

async function fetchWithRetry(url, opts, { timeoutMs = 15000, tries = 1, delayMs = 20000 } = {}) {
  let lastErr = null;
  for (let i = 0; i < tries; i++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetch(url, { ...opts, signal: ctrl.signal, cache: "no-store" });
        // [SELF-AUDIT 2026-09-17] Blip edge Vercel (DEPLOYMENT_NOT_FOUND 404 /
        // 502-504) bersifat transien — pantau diamati pulih dalam hitungan
        // menit. Retry hanya status transien; 4xx lain (mis. 401/403) gagal
        // cepat karena menunjukkan masalah nyata, bukan blip.
        if (process.env.SMOKE_DEBUG) {
          const dbgBody = await res.clone().text().catch(() => "?");
          console.error(`[dbg] ${i+1}/${tries} ${url.slice(0,55)} -> ${res.status} vid=${(res.headers.get("x-vercel-id")||"-").slice(0,38)} server=${res.headers.get("server")} body=${dbgBody.slice(0,90).replace(/\n/g," ")}`);
        }
        if ((res.status === 404 || res.status === 502 || res.status === 503 ||
             res.status === 504) && i + 1 < tries) {
          // Hygiene undici: batalkan body yang tidak dibaca agar koneksi
          // keep-alive kembali ke pool (mencegah pool habis saat retry).
          await res.body?.cancel().catch(() => {});
          await new Promise((r) => setTimeout(r, delayMs));
          continue;
        }
        return res;
      } finally {
        clearTimeout(t);
      }
    } catch (err) {
      lastErr = err;
      if (i + 1 < tries) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }
  throw lastErr;
}

/* ---------- 1. Monitoring PWA ---------- */
console.log("== [1/2] Monitoring PWA:", MONITORING, "==");

// 1a. Tunggu deployment baru (commit SHA cocok) — Vercel build ~1-3 menit.
// [SELF-AUDIT 2026-09-17] Tanpa --expect-sha pun, run manual pernah gagal
// palsu karena blip edge transien — beri minimal 3 percobaan selalu.
const WAIT_TRIES = EXPECT_SHA ? 18 : 3; // ~6 menit maksimum (mode CI)
let health = null;
let healthHeaders = null;
try {
  const res = await fetchWithRetry(`${MONITORING}/api/health`, {},
    { tries: WAIT_TRIES, delayMs: 20000 });
  healthHeaders = res.headers;
  const body = await res.json().catch(() => null);
  if (!res.ok || !body || body.success !== true) {
    fail(`Monitoring /api/health tidak sehat: HTTP ${res.status}`);
  } else {
    health = body.data || body;
  }
} catch (err) {
  fail(`Monitoring /api/health tidak dapat dihubungi: ${err.message}`);
}

if (health) {
  // 1b. Commit binding: deployment yang diuji adalah deployment BARU.
  const liveSha = (health.commitSha || health.release?.commitSha || "") || "";
  if (EXPECT_SHA) {
    if (liveSha) {
      if (liveSha.startsWith(EXPECT_SHA) || EXPECT_SHA.startsWith(liveSha)) {
        pass(`Deployment live cocok dengan commit yang di-push (${liveSha.slice(0, 10)}…).`);
      } else {
        fail(`Deployment live masih commit LAMA (${liveSha.slice(0, 10) || "?"} ≠ ${EXPECT_SHA.slice(0, 10)}) — Vercel belum selesai promote.`);
      }
    } else {
      fail("Deployment live tidak mengekspos commitSha — tidak bisa membuktikan deployment baru aktif.");
    }
  }

  // 1c. Release identity sync (R1): live tag == release-policy.json.
  try {
    const policy = JSON.parse(readFileSync(resolve(ROOT, "release-policy.json"), "utf8"));
    const liveTag = health.release?.authorizedProductionTag || "";
    if (liveTag === policy.authorizedProductionTag) {
      pass(`Release identity live (${liveTag}) == release-policy.json.`);
    } else {
      fail(`Release identity live (${liveTag || "?"}) != release-policy.json (${policy.authorizedProductionTag}).`);
    }
    if (health.release?.inSync === true) {
      pass("Live expectedFirmwareTag == authorizedProductionTag (inSync).");
    } else {
      fail("Live release.inSync !== true — deployment menjalankan tag di luar kebijakan.");
    }
  } catch (e) {
    fail(`release-policy.json tidak terbaca: ${e.message}`);
  }

  // 1d. Mode deployment eksplisit (Mode A vs Mode B).
  const mode = health.deploymentMode?.mode;
  if (mode === "browser-configured" || mode === "server-assisted") {
    pass(`Mode deployment eksplisit: ${mode} (dashboard tidak berpura-pura punya control plane).`);
  } else {
    fail(`deploymentMode hilang/tidak valid: ${String(mode)}`);
  }
}

// 1e. Security headers hidup di deployment.
if (healthHeaders) {
  const csp = healthHeaders.get("content-security-policy") || "";
  const hsts = healthHeaders.get("strict-transport-security") || "";
  const xfo = healthHeaders.get("x-frame-options") || "";
  const nosniff = healthHeaders.get("x-content-type-options") || "";
  if (/script-src [^;]*'self'/.test(csp)) pass("CSP live: script-src 'self' (+nonce policy).");
  else fail(`CSP live tidak memuat script-src 'self': ${csp.slice(0, 80)}`);
  if (/max-age=\d+/.test(hsts) && /includeSubDomains/.test(hsts)) pass("HSTS live aktif.");
  else fail(`HSTS live tidak aktif: "${hsts}"`);
  if (xfo.toUpperCase() === "DENY") pass("X-Frame-Options live: DENY.");
  else fail(`X-Frame-Options live: "${xfo}"`);
  if (nosniff.toLowerCase() === "nosniff") pass("X-Content-Type-Options live: nosniff.");
  else fail(`X-Content-Type-Options live: "${nosniff}"`);
}

/* ---------- 2. Push Alarm ---------- */
console.log("== [2/2] Push Alarm:", PUSH_ALARM, "==");

let cfgSrc = "";
try {
  const res = await fetchWithRetry(`${PUSH_ALARM}/js/config.js`, {}, { tries: 5, delayMs: 15000 });
  cfgSrc = await res.text();
  if (!res.ok) fail(`/js/config.js HTTP ${res.status}`);
} catch (err) {
  fail(`/js/config.js tidak dapat dihubungi: ${err.message}`);
}

if (cfgSrc) {
  if (PLACEHOLDER_RE.test(cfgSrc)) {
    fail("config.js live masih memuat POLA PLACEHOLDER (GANTI_DENGAN/CHANGEME) — inilah bug P0-1.");
  } else {
    pass("config.js live bebas placeholder.");
  }

  const apiBase = (/API_BASE:\s*['"]([^'"]*)['"]/.exec(cfgSrc) || [])[1] || "";
  const vapid = (/VAPID_PUBLIC_KEY:\s*['"]([^'"]*)['"]/.exec(cfgSrc) || [])[1] || "";
  const provisioned = /APP_PROVISIONED\s*=\s*true/.test(cfgSrc);

  if (REQUIRE_PROVISIONED) {
    // Gate rilis (tag v*): push alarm WAJIB terprovision penuh.
    if (!provisioned || !apiBase || !vapid) {
      fail("GATE RILIS: push alarm belum terprovision (PUSH_API_BASE/PUSH_VAPID_PUBLIC_KEY belum di-set di Vercel).");
    }
  }

  if (apiBase && !PLACEHOLDER_RE.test(apiBase)) {
    if (/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(apiBase)) {
      pass(`API_BASE live valid (terprovision): ${apiBase.slice(0, 48)}…`);
    } else {
      fail(`API_BASE live bukan URL Web App GAS valid: ${apiBase.slice(0, 60)}`);
    }
  } else if (provisioned === false && !apiBase) {
    pass("API_BASE live kosong + APP_PROVISIONED=false — keadaan JUJUR 'belum dikonfigurasi' (bukan gagal diam-diam).");
  }

  if (vapid && !PLACEHOLDER_RE.test(vapid)) {
    const b64 = vapid.replace(/-/g, "+").replace(/_/g, "/");
    const bytes = Buffer.from(b64, "base64");
    if (bytes.length === 65 && bytes[0] === 0x04) {
      pass("VAPID live valid (65 byte, P-256).");
    } else {
      fail(`VAPID live tidak valid: ${bytes.length} byte (harus 65).`);
    }
  }
}

let swSrc = "";
try {
  const res = await fetchWithRetry(`${PUSH_ALARM}/sw.js`, {}, { tries: 3, delayMs: 10000 });
  swSrc = await res.text();
} catch (err) {
  fail(`/sw.js tidak dapat dihubungi: ${err.message}`);
}
if (swSrc) {
  if (/const API_BASE\s*=/.test(swSrc)) {
    fail("sw.js live masih menanam konstanta API_BASE (bisa basi/placeholder).");
  } else if (/function getApiBase_/.test(swSrc)) {
    pass("sw.js live memakai getApiBase_() dinamis (runtime config).");
  }
}

/* ---------- Laporan ---------- */
console.log("");
for (const p of passes) console.log("[PASS]", p);
for (const f of failures) console.log("[FAIL]", f);
console.log("");
if (failures.length > 0) {
  console.log(`LIVE SMOKE TEST = FAIL (${failures.length} masalah) — deployment production tidak lolos gate.`);
  process.exit(1);
}
console.log(`LIVE SMOKE TEST = PASS (${passes.length} pemeriksaan pada deployment aktif).`);
process.exit(0);
