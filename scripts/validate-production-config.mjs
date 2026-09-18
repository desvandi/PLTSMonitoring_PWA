#!/usr/bin/env node
/**
 * validate-production-config.mjs — [Audit 2026-09-05 re-audit · P1-8]
 * Production configuration gate.
 *
 * A production build MUST FAIL for:
 *   - missing transport (neither NEXT_PUBLIC_API_BASE_URL nor a TLS MQTT broker)
 *   - wrong firmware tag (env override != authorized release policy)
 *   - missing release identity (release-policy.json absent/malformed)
 *   - wrong trust key (malformed VAPID push key)
 *   - development fallback (NEXT_PUBLIC_DEMO_MODE enabled)
 *   - localhost endpoints (API base / push base / MQTT broker)
 *   - plaintext or public MQTT broker in production
 *
 * Usage:
 *   node scripts/validate-production-config.mjs [--mode production|staging]
 *                                                [--env-file .env.production]
 *
 * Exit: 0 = production-safe configuration
 *       1 = BLOCKED (at least one FAIL) — the build must not ship
 *
 * CI runs this with the DEFAULT environment (no env vars): it validates that
 * the committed defaults are production-safe. Vercel-style deployments should
 * run it with the real production env applied.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const argv = process.argv.slice(2);
function argValue(name) {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
}
const MODE = argValue("--mode") ?? "production";
const ENV_FILE = argValue("--env-file");

if (MODE !== "production" && MODE !== "staging") {
  console.error(`[FAIL] invalid --mode "${MODE}" (expected production|staging)`);
  process.exit(1);
}

// --- optional .env-file support (KEY=VALUE lines, # comments) ---------------
if (ENV_FILE) {
  const p = resolve(ENV_FILE);
  if (!existsSync(p)) {
    console.error(`[FAIL] --env-file not found: ${p}`);
    process.exit(1);
  }
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !line.trim().startsWith("#") && !(m[1] in process.env)) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

const env = (k) => (process.env[k] ?? "").trim();

const failures = [];
const warnings = [];
const passes = [];
const fail = (msg) => failures.push(msg);
const warn = (msg) => warnings.push(msg);
const pass = (msg) => passes.push(msg);

const LOCALHOST_RE = /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:\d+)?$/i;
const PUBLIC_BROKERS = [
  "public.mqtthq.com",
  "broker.hivemq.com",
  "test.mosquitto.org",
  "broker.emqx.io",
  "mqtt-dashboard.com",
  "broker.mqttdashboard.com",
];

// --- 1. Release identity (release-policy.json) ------------------------------
const POLICY_PATH = resolve(ROOT, "release-policy.json");
let policy = null;
try {
  policy = JSON.parse(readFileSync(POLICY_PATH, "utf8"));
} catch (e) {
  fail(`release-policy.json missing or malformed (${e.message}) — the authorized release identity is undefined.`);
}
const authorizedTag = policy?.authorizedProductionTag ?? "";
const authorizedVersion = policy?.authorizedProductionVersion ?? "";
if (policy) {
  if (!/^v\d+\.\d+\.\d+$/.test(authorizedTag)) {
    fail(`release-policy.json authorizedProductionTag "${authorizedTag}" is not a well-formed vX.Y.Z tag.`);
  } else if (authorizedTag.slice(1) !== authorizedVersion) {
    fail(`release-policy.json tag/version mismatch: ${authorizedTag} vs ${authorizedVersion}.`);
  } else {
    pass(`release identity: authorized production tag = ${authorizedTag} (release-policy.json).`);
  }
}

// --- 2. Release channel ------------------------------------------------------
const channel = env("NEXT_PUBLIC_RELEASE_CHANNEL") || "production";
if (MODE === "production") {
  if (channel !== "production") {
    fail(`NEXT_PUBLIC_RELEASE_CHANNEL="${channel}" — a production build must run on the production channel.`);
  } else {
    pass("release channel: production.");
  }
} else {
  if (channel !== "staging") {
    fail(`--mode staging but NEXT_PUBLIC_RELEASE_CHANNEL="${channel}" — staging mode requires the explicit staging channel.`);
  } else {
    pass("release channel: staging (explicit).");
  }
}

// --- 3. Firmware tag invariant ------------------------------------------------
const envTag = env("NEXT_PUBLIC_EXPECTED_FIRMWARE_TAG");
if (MODE === "production") {
  if (envTag === "") {
    pass("firmware tag: not overridden — policy invariant applies.");
  } else if (envTag !== authorizedTag) {
    fail(`NEXT_PUBLIC_EXPECTED_FIRMWARE_TAG="${envTag}" != authorized "${authorizedTag}" — production release identity is an INVARIANT (release-policy.json), not an operator choice.`);
  } else {
    pass(`firmware tag: env override equals authorized tag ${authorizedTag}.`);
  }
} else {
  if (envTag !== "" && !/^v\d+\.\d+\.\d+$/.test(envTag)) {
    fail(`staging tag override "${envTag}" is not a well-formed vX.Y.Z tag.`);
  } else {
    pass(`firmware tag: staging override ${envTag || `(none — policy default ${authorizedTag})`} allowed on explicit staging channel.`);
  }
}

// --- 4. Transport: REST base and/or MQTT broker -------------------------------
const apiBase = env("NEXT_PUBLIC_API_BASE_URL");
const brokerUrl = env("NEXT_PUBLIC_MQTT_BROKER_URL");
if (apiBase === "" && brokerUrl === "") {
  fail("no transport configured: neither NEXT_PUBLIC_API_BASE_URL nor NEXT_PUBLIC_MQTT_BROKER_URL is set. A production PWA must reach the device (direct REST or MQTT).");
} else if (apiBase === "") {
  pass("transport: MQTT-only mode (documented production mode — works behind CGNAT).");
} else {
  pass("transport: direct REST mode (NEXT_PUBLIC_API_BASE_URL set).");
}

// --- 5. API base URL -----------------------------------------------------------
if (apiBase !== "") {
  let u = null;
  try {
    u = new URL(apiBase);
  } catch {
    fail(`NEXT_PUBLIC_API_BASE_URL="${apiBase}" is not a valid URL.`);
  }
  if (u) {
    if (LOCALHOST_RE.test(u.host)) {
      fail(`NEXT_PUBLIC_API_BASE_URL points at localhost ("${u.host}") — a development fallback. Production must use the device's LAN address or a Cloudflare Tunnel URL.`);
    } else if (u.protocol !== "https:" && u.protocol !== "http:") {
      fail(`NEXT_PUBLIC_API_BASE_URL scheme "${u.protocol}" is invalid (use https:// or http://LAN-address).`);
    } else if (u.protocol === "http:") {
      // [GATE-8 / A2-02 REMEDIATION 2026-09] audit Phase 10 A2-02 / Phase 6
      // S2 design contradiction: the documented production transport is
      // PWA -> HTTPS -> TLS gateway (Cloudflare Tunnel / nginx) -> device,
      // and production cookies are Secure — yet the gate still ACCEPTED a
      // plaintext http:// LAN base. A plaintext direct API sends session
      // credentials + CSRF headers + device commands over the network in
      // the clear. Production now requires https:// (MQTT-only production
      // remains allowed without any direct API). Staging/development keep
      // http:// for bench work (pass --mode staging).
      if (MODE === "production") {
        fail(
          `NEXT_PUBLIC_API_BASE_URL must use https:// in production — got "http://${u.host}". ` +
            "The documented production transport is the TLS gateway (Cloudflare Tunnel / nginx) in front " +
            "of the device; plaintext direct API would expose session credentials and device commands. " +
            "Use https:// (TLS gateway URL) or run an MQTT-only production (--mode staging keeps http:// for bench).",
        );
      } else {
        pass(`API base URL OK (staging): ${u.protocol}//${u.host} — plaintext allowed in staging.`);
      }
    } else {
      pass(`API base URL OK: ${u.protocol}//${u.host}.`);
    }
  }
}

// --- 6. MQTT broker URL --------------------------------------------------------
if (brokerUrl !== "") {
  let u = null;
  try {
    u = new URL(brokerUrl);
  } catch {
    fail(`NEXT_PUBLIC_MQTT_BROKER_URL="${brokerUrl}" is not a valid URL.`);
  }
  if (u) {
    if (u.protocol !== "wss:") {
      fail(`NEXT_PUBLIC_MQTT_BROKER_URL must use wss:// (TLS) — got "${u.protocol}". Plaintext MQTT is forbidden in production.`);
    } else if (LOCALHOST_RE.test(u.host)) {
      fail(`NEXT_PUBLIC_MQTT_BROKER_URL points at localhost ("${u.host}") — a development fallback.`);
    } else if (PUBLIC_BROKERS.includes(u.host)) {
      fail(`NEXT_PUBLIC_MQTT_BROKER_URL points at the PUBLIC broker "${u.host}" — production must use a self-hosted authenticated broker.`);
    } else {
      pass(`MQTT broker OK: wss://${u.host} (TLS, non-public).`);
    }
  }
}

// --- 6b. [GATE-3 / S1-01 REMEDIATION 2026-09] PUBLIC MQTT CREDENTIALS = BLOCKED -
// The NEXT_PUBLIC_MQTT_USERNAME / NEXT_PUBLIC_MQTT_PASSWORD fallback was
// DELETED from src/lib/mqtt.ts (audit Phase 10 S1-01: a misconfigured
// deployment could inline the broker password into the public JS bundle).
// This gate makes the removal ENFORCED: setting either variable now FAILS the
// production configuration check — the only accepted credential path is the
// server-side MQTT_USERNAME / MQTT_PASSWORD served by /api/mqtt/credentials.
{
  const pubUser = env("NEXT_PUBLIC_MQTT_USERNAME");
  const pubPass = env("NEXT_PUBLIC_MQTT_PASSWORD");
  if (pubUser !== "" || pubPass !== "") {
    fail(
      "NEXT_PUBLIC_MQTT_USERNAME / NEXT_PUBLIC_MQTT_PASSWORD must NOT be set — " +
        "public MQTT credentials are forbidden (they would be inlined into the " +
        "browser bundle). Provision MQTT_USERNAME / MQTT_PASSWORD server-side " +
        "(served only via /api/mqtt/credentials).",
    );
  } else {
    pass("no public MQTT credentials configured (server-held path only).");
  }
}

// --- 7. Demo / mock mode --------------------------------------------------------
const demo = env("NEXT_PUBLIC_DEMO_MODE").toLowerCase();
if (demo === "true" || demo === "1") {
  fail("NEXT_PUBLIC_DEMO_MODE is enabled — demo/mock fallback must never ship in a production build.");
} else {
  pass("demo/mock mode: disabled.");
}

// --- 8. Push-alarm base + VAPID trust key ---------------------------------------
const pushBase = env("NEXT_PUBLIC_PUSH_API_BASE");
if (pushBase !== "") {
  let u = null;
  try {
    u = new URL(pushBase);
  } catch {
    fail(`NEXT_PUBLIC_PUSH_API_BASE="${pushBase}" is not a valid URL.`);
  }
  if (u && LOCALHOST_RE.test(u.host)) {
    fail(`NEXT_PUBLIC_PUSH_API_BASE points at localhost ("${u.host}") — a development fallback.`);
  } else if (u) {
    pass(`push base URL OK: ${u.protocol}//${u.host}.`);
  }
}

const vapid = env("NEXT_PUBLIC_PUSH_VAPID_PUBLIC_KEY");
if (vapid !== "") {
  // VAPID application server key: 65 raw bytes, base64url-encoded
  const b64u = vapid.replace(/-/g, "+").replace(/_/g, "/");
  const ok = /^[A-Za-z0-9+/]+={0,2}$/.test(b64u) && Buffer.from(b64u, "base64").length === 65;
  if (!ok) {
    fail(`NEXT_PUBLIC_PUSH_VAPID_PUBLIC_KEY is malformed — expected 65-byte (base64url) VAPID application server key.`);
  } else {
    pass("VAPID public key: well-formed (65 bytes).");
  }
}

// --- 9. GAS insights URL (server-side only) -------------------------------------
const gas = env("NEXT_PUBLIC_GAS_INSIGHTS_URL");
if (gas !== "") {
  warn("NEXT_PUBLIC_GAS_INSIGHTS_URL is set — it is server-side only; browser code must never read it.");
  let u = null;
  try {
    u = new URL(gas);
  } catch {
    warn("NEXT_PUBLIC_GAS_INSIGHTS_URL is not a valid URL.");
  }
  if (u && LOCALHOST_RE.test(u.host)) {
    fail(`NEXT_PUBLIC_GAS_INSIGHTS_URL points at localhost ("${u.host}") — a development fallback.`);
  }
}

// --- report ---------------------------------------------------------------------
for (const p of passes) console.log(`[PASS] ${p}`);
for (const w of warnings) console.log(`[WARN] ${w}`);
for (const f of failures) console.log(`[FAIL] ${f}`);
console.log("");
if (failures.length > 0) {
  console.log(`PRODUCTION CONFIG = BLOCKED (${failures.length} failure${failures.length > 1 ? "s" : ""}) — build must not ship.`);
  process.exit(1);
}
console.log(`PRODUCTION CONFIG = PASS (${MODE} mode, ${passes.length} checks, ${warnings.length} warning${warnings.length === 1 ? "" : "s"}).`);
process.exit(0);
