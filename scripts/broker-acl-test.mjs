#!/usr/bin/env node
/**
 * broker-acl-test.mjs — [GATE-7 / F8 2026-09] LIVE broker ACL acceptance test.
 * =====================================================================
 * Audit F8: "HiveMQ ACL adalah external unverified security dependency".
 * PWA scope markers (viewer:read:plts/…) adalah application metadata, BUKAN
 * bukti broker enforcement. Test ini menjalankan matriks acceptance F8
 * terhadap broker NYATA (HiveMQ Cloud atau MQTT broker apa pun) sehingga
 * deny/publish ACL diverifikasi di lapisan broker, bukan diasumsikan.
 *
 * Matriks (audit F8 "Acceptance test" + kontrak topik firmware/PWA):
 *   T0  kredensial SALAH ditolak saat CONNECT (auth fail-closed)
 *   T1  viewer  SUB plts/A/{status,log,online}      → GRANTED (3 topik)
 *   T2  viewer  SUB plts/B/status                   → DENIED (SUBACK 0x80 / close)
 *   T2b viewer  SUB plts/#  (wildcard fleet)        → DENIED
 *   T3  viewer  PUB plts/A/status (canary)          → TIDAK ter-deliver (write deny)
 *       + device PUB canary topik yang sama         → TER-deliver ke viewer
 *         (kontrol positif: membuktikan jalur observasi hidup — tanpa ini,
 *          "tidak diterima" tidak berarti apa-apa)
 *   T4  device  SUB plts/A/{config,ota}             → GRANTED (2 topik)
 *   T5  device  SUB plts/B/config                   → DENIED
 *   T6  device  PUB plts/A/{status,log,online}      → ter-deliver (viewer observasi)
 *       device  PUB plts/A/{ack,ota/event}          → tanpa error broker
 *   T7  device  PUB plts/B/status (cross-device)    → disconnect = DENY CONFIRMED;
 *       silent drop = UNCONFIRMED-DENY (limitasi observabilitas — tanpa kredensial
 *       observer sisi perangkat-B, non-delivery tidak bisa diamati langsung;
 *       dilaporkan jujur, tidak dihitung sebagai FAIL)
 *
 * Usage:
 *   node scripts/broker-acl-test.mjs \
 *     --url wss://<host>:8884/mqtt | mqtts://<host>:8883 \
 *     --viewer-user U --viewer-pass P \
 *     --device-user U --device-pass P \
 *     --device-id A [--other-device-id B] [--canary-ms 3000] [--json]
 *
 * Exit: 0 = semua test wajib PASS; 1 = FAIL (ACL bocor / matrix broken);
 *       2 = precondition error (argumen/broker tidak tersambung).
 * Tanpa argumen broker: fail-closed exit 2 (TIDAK silently pass — audit rule).
 */
import mqtt from "mqtt";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

const argv = process.argv.slice(2);
const argValue = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
};
const URL_ = argValue("--url");
const VIEWER_USER = argValue("--viewer-user");
const VIEWER_PASS = argValue("--viewer-pass");
const DEVICE_USER = argValue("--device-user");
const DEVICE_PASS = argValue("--device-pass");
const DEVICE_ID = argValue("--device-id");
const OTHER_ID = argValue("--other-device-id") || (DEVICE_ID ? `${DEVICE_ID}-other` : null);
const CANARY_MS = parseInt(argValue("--canary-ms") || "3000", 10);
const JSON_MODE = argv.includes("--json");

const log = (...a) => { if (!JSON_MODE) console.log(...a); };
const results = [];
const record = (id, name, status, detail) => {
  results.push({ id, name, status, detail });
  log(`  [${status}] ${id} ${name}${detail ? " — " + detail : ""}`);
};

function usageAndExit() {
  console.error(
    "[PRECONDITION-FAIL] Argumen broker wajib: --url, --viewer-user, --viewer-pass, " +
    "--device-user, --device-pass, --device-id. Live ACL verification TIDAK boleh " +
    "dilewati diam-diam (audit F8 fail-closed)."
  );
  process.exit(2);
}
if (!URL_ || !VIEWER_USER || !VIEWER_PASS || !DEVICE_USER || !DEVICE_PASS || !DEVICE_ID || !OTHER_ID) {
  usageAndExit();
}

/**
 * connect(url, username, password) → { client } | throws on auth failure/timeout.
 * reconnectPeriod 0: koneksi test deterministik, tanpa auto-reconnect.
 */
function connect(url, username, password, { expectFail = false, timeoutMs = 12000 } = {}) {
  return new Promise((resolve, reject) => {
    const client = mqtt.connect(url, {
      username,
      password,
      clientId: `acltest-${randomUUID().slice(0, 8)}`,
      clean: true,
      reconnectPeriod: 0,
      connectTimeout: timeoutMs,
      keepalive: 30,
    });
    let settled = false;
    const ok = (connack) => {
      if (settled) return;
      settled = true;
      if (expectFail) {
        client.end(true);
        reject(new Error(`CONNECT DITERIMA padahal harus DITOLAK (auth fail-open!)`));
      } else {
        resolve({ client, connack });
      }
    };
    const bad = (err) => {
      if (settled) return;
      settled = true;
      try { client.end(true); } catch { /* already closed */ }
      if (expectFail) resolve({ rejected: true, reason: String(err?.message || err) });
      else reject(new Error(`CONNECT gagal: ${err?.message || err}`));
    };
    client.on("connect", ok);
    client.on("error", bad);
    client.on("close", () => {
      // close tanpa error & tanpa connect → perlakukan sebagai kegagalan
      if (!settled) bad(new Error("connection closed before CONNECT"));
    });
    setTimeout(() => {
      if (!settled) { settled = true; try { client.end(true); } catch {}
        reject(new Error(`CONNECT timeout ${timeoutMs}ms`)); }
    }, timeoutMs + 2000);
  });
}

/** subscribe → granted list; qos 128 (0x80) = denied oleh broker. */
function subOnce(client, topic, qos = 1, timeoutMs = 8000) {
  return new Promise((resolve) => {
    let settled = false;
    const onErr = (err) => { if (!settled) { settled = true; resolve({ deniedBy: "error", err: String(err?.message || err) }); } };
    const onClose = () => { if (!settled) { settled = true; resolve({ deniedBy: "close" }); } };
    client.on("error", onErr);
    client.on("close", onClose);
    try {
      client.subscribe(topic, { qos }, (err, granted) => {
        if (settled) return;
        settled = true;
        client.off("error", onErr);
        client.off("close", onClose);
        if (err) resolve({ deniedBy: "error", err: String(err?.message || err) });
        else resolve({ granted: granted || [] });
      });
    } catch (e) {
      if (!settled) { settled = true; resolve({ deniedBy: "exception", err: String(e?.message || e) }); }
    }
    setTimeout(() => {
      if (!settled) { settled = true; client.off("error", onErr); client.off("close", onClose);
        resolve({ deniedBy: "timeout" }); }
    }, timeoutMs);
  });
}

/** Kumpulkan pesan yang diterima pada topic tertentu selama windowMs. */
async function observeMessages(client, topic, windowMs) {
  const got = [];
  const handler = (t, payload) => { if (t === topic) got.push(payload.toString()); };
  client.on("message", handler);
  await sleep(windowMs);
  client.off("message", handler);
  return got;
}

function isDenied(res) {
  if (res.granted) return res.granted.some((g) => g.qos === 128 || g.qos === 0x80);
  return Boolean(res.deniedBy); // error/close/exception/timeout setelah sub = bukti deny
}

/** publish dengan timeout — broker yang drop tanpa PUBACK tidak boleh menggantungkan test. */
function pub(client, topic, message, qos = 1, timeoutMs = 5000) {
  return new Promise((resolve) => {
    let settled = false;
    const fin = (err) => { if (!settled) { settled = true; resolve(err ? String(err?.message || err) : null); } };
    try { client.publish(topic, message, { qos, retain: false }, fin); } catch (e) { fin(e); }
    setTimeout(() => fin(new Error(`publish timeout ${timeoutMs}ms (broker drop tanpa PUBACK?)`)), timeoutMs);
  });
}

const endQuiet = (c) => { try { c?.end(true); } catch { /* ignore */ } };

// Publish tak-berizin menunggu PUBACK maksimal segini (broker yang meng-drop
// tanpa PUBACK tidak boleh membakar jendela observasi canary).
const PROBE_PUB_TIMEOUT_MS = 1500;

/**
 * Broker yang tepat bisa MEMUTUS koneksi pada publish/subscribe tak-berizin
 * (perilaku valid per MQTT + kebijakan HiveMQ). Karena itu:
 *  - publish TAK-BERIZIN dilakukan lewat koneksi PROBE sekali-pakai, agar
 *    kanal observasi (viewer utama) tidak ikut mati;
 *  - sebelum tiap fase, koneksi utama dijamin hidup (rekoneksi bila perlu).
 */
async function ensureConnected(holder, factory, label) {
  if (holder.client && holder.client.connected) return holder.client;
  endQuiet(holder.client);
  holder.client = (await factory()).client;
  log(`  (re)connected: ${label}`);
  return holder.client;
}

async function main() {
  log(`== [GATE-7 / F8] Broker ACL acceptance test ==`);
  log(`broker=${URL_} device=${DEVICE_ID} other=${OTHER_ID}`);
  let failures = 0;
  const fail = () => { failures++; };

  // ---------- T0: kredensial salah harus DITOLAK ----------
  log("T0: kredensial salah ditolak (auth fail-closed)");
  try {
    const r = await connect(URL_, VIEWER_USER, `${VIEWER_PASS}-salah`, { expectFail: true });
    record("T0", "CONNECT dengan password salah DITOLAK", "PASS", r.reason);
  } catch (e) {
    record("T0", "CONNECT dengan password salah DITERIMA (fail-open!)", "FAIL", e.message);
    fail();
  }

  // ---------- koneksi utama ----------
  const viewerHolder = {};
  const deviceHolder = {};
  const makeViewer = () => connect(URL_, VIEWER_USER, VIEWER_PASS);
  const makeDevice = () => connect(URL_, DEVICE_USER, DEVICE_PASS);
  try {
    viewerHolder.client = (await makeViewer()).client;
    deviceHolder.client = (await makeDevice()).client;
  } catch (e) {
    record("PRE", "koneksi kredensial valid", "FAIL", e.message);
    console.error(JSON.stringify({ verdict: "PRECONDITION-FAIL", results }));
    process.exit(2);
  }
  const viewer = () => ensureConnected(viewerHolder, makeViewer, "viewer");
  const device = () => ensureConnected(deviceHolder, makeDevice, "device");
  // penangan error pasif agar 'error' tanpa listener tidak melempar di Node
  for (const h of [viewerHolder, deviceHolder]) h.errorSink = () => {};
  viewerHolder.client.on("error", viewerHolder.errorSink);
  deviceHolder.client.on("error", deviceHolder.errorSink);

  // ---------- T1: viewer SUB device sendiri ----------
  log("T1: viewer SUB plts/<A>/{status,log,online}");
  for (const t of ["status", "log", "online"]) {
    const topic = `plts/${DEVICE_ID}/${t}`;
    const r = await subOnce(await viewer(), topic);
    const granted = r.granted && !isDenied(r);
    if (granted) record("T1", `SUB ${topic}`, "PASS", `granted qos=${r.granted[0].qos}`);
    else { record("T1", `SUB ${topic}`, "FAIL", `viewer harusnya boleh subscribe device sendiri: ${JSON.stringify(r)}`); fail(); }
  }

  // ---------- T2: viewer SUB device lain → DENY ----------
  log("T2: viewer SUB plts/<B>/status (cross-device read)");
  {
    const topic = `plts/${OTHER_ID}/status`;
    const r = await subOnce(await viewer(), topic);
    if (isDenied(r)) record("T2", `SUB ${topic} DITOLAK`, "PASS", `deny via ${r.deniedBy || "SUBACK 128"}`);
    else { record("T2", `SUB ${topic} DITERIMA (cross-device read bocor!)`, "FAIL", JSON.stringify(r)); fail(); }
  }

  // ---------- T2b: viewer SUB wildcard fleet → DENY ----------
  log("T2b: viewer SUB plts/# (wildcard fleet)");
  {
    const r = await subOnce(await viewer(), "plts/#");
    if (isDenied(r)) record("T2b", "SUB plts/# DITOLAK", "PASS", `deny via ${r.deniedBy || "SUBACK 128"}`);
    else { record("T2b", "SUB plts/# DITERIMA (fleet-wide read bocor!)", "FAIL", JSON.stringify(r)); fail(); }
  }

  // ---------- T3: viewer PUBLISH harus deny (canary + kontrol positif device) ----------
  log("T3: viewer PUB canary vs device PUB canary (write-deny + observation proof)");
  {
    const topic = `plts/${DEVICE_ID}/status`;
    const viewerCanary = `acltest-viewer-${randomUUID()}`;
    const deviceCanary = `acltest-device-${randomUUID()}`;
    // viewer utama wajib hidup dan ter-subscribe (dijamin ulang — T2/T2b mungkin
    // memutus koneksi pada broker yang ketat)
    const v = await viewer();
    const rsub = await subOnce(v, topic);
    if (!(rsub.granted && !isDenied(rsub))) {
      record("T3", "pre-subscribe ulang viewer gagal", "FAIL", JSON.stringify(rsub));
      fail();
    } else {
      // observasi dimulai TANPA await (jalankan paralel) — publish harus
      // terjadi DI DALAM jendela observasi, bukan setelahnya
      const receivedP = observeMessages(v, topic, PROBE_PUB_TIMEOUT_MS + 800 + CANARY_MS + 1500);
      // publish TAK-BERIZIN viewer via koneksi PROBE (broker sah boleh memutus
      // koneksi pelanggar — kanal observasi tidak boleh ikut mati)
      let probeDisconnected = false;
      let probeErr = null;
      try {
        const probe = (await connect(URL_, VIEWER_USER, VIEWER_PASS)).client;
        probe.on("close", () => { probeDisconnected = true; });
        probeErr = await pub(probe, topic, viewerCanary, 1, PROBE_PUB_TIMEOUT_MS);
        await sleep(800);
        endQuiet(probe);
      } catch (e) {
        probeErr = String(e?.message || e);
      }
      // publish SAH device via koneksi device utama
      await pub(await device(), topic, deviceCanary);
      await sleep(CANARY_MS + 600);
      const received = await receivedP;
      const gotViewer = received.includes(viewerCanary);
      const gotDevice = received.includes(deviceCanary);
      const denyNote = probeDisconnected ? " + probe viewer diputus broker" : (probeErr ? ` + probe err: ${probeErr}` : "");
      if (!gotViewer && gotDevice) {
        record("T3", "viewer write DITOLAK + device write ter-deliver", "PASS", "canary viewer tidak muncul, canary device diterima" + denyNote);
      } else if (gotViewer) {
        record("T3", "viewer write TER-DELIVER (write ACL bocor!)", "FAIL", "canary viewer diterima viewer sendiri");
        fail();
      } else if (!gotDevice) {
        record("T3", "kontrol positif GAGAL (device canary tidak diterima)", "FAIL", "jalur observasi mati — hasil test tidak konklusif");
        fail();
      } else {
        record("T3", "viewer write tidak ter-deliver namun kontrol positif tidak konklusif", "FAIL", "kombinasi tidak terduga");
        fail();
      }
    }
  }

  // ---------- T4: device SUB config + ota ----------
  log("T4: device SUB plts/<A>/{config,ota}");
  for (const t of ["config", "ota"]) {
    const topic = `plts/${DEVICE_ID}/${t}`;
    const r = await subOnce(await device(), topic);
    const granted = r.granted && !isDenied(r);
    if (granted) record("T4", `SUB ${topic}`, "PASS", `granted qos=${r.granted[0].qos}`);
    else { record("T4", `SUB ${topic}`, "FAIL", `device harusnya boleh subscribe command topiknya: ${JSON.stringify(r)}`); fail(); }
  }

  // ---------- T5: device SUB device lain → DENY ----------
  log("T5: device SUB plts/<B>/config (cross-device command read)");
  {
    const topic = `plts/${OTHER_ID}/config`;
    const r = await subOnce(await device(), topic);
    if (isDenied(r)) record("T5", `SUB ${topic} DITOLAK`, "PASS", `deny via ${r.deniedBy || "SUBACK 128"}`);
    else { record("T5", `SUB ${topic} DITERIMA (cross-device command injection surface!)`, "FAIL", JSON.stringify(r)); fail(); }
  }

  // ---------- T6: device PUBLISH topik telemetry sendiri ----------
  log("T6: device PUB plts/<A>/{status,log,online} (observasi viewer) + {ack,ota/event} (no-error)");
  {
    const v = await viewer();
    // viewer wajib ter-subscribe ulang (koneksi bisa terganti sejak T1)
    const observables = {};
    const topics = ["status", "log", "online"];
    for (const t of topics) {
      const topic = `plts/${DEVICE_ID}/${t}`;
      const rsub = await subOnce(v, topic);
      observables[`${DEVICE_ID}/${t}`] = `acltest-t6-${t}-${randomUUID().slice(0, 8)}`;
      if (!(rsub.granted && !isDenied(rsub))) {
        record("T6", `pre-subscribe viewer ${t} gagal`, "FAIL", JSON.stringify(rsub));
        fail();
      }
    }
    const waits = topics.map((t) => observeMessages(v, `plts/${DEVICE_ID}/${t}`, CANARY_MS + 1500));
    const d = await device();
    for (const t of topics) {
      await pub(d, `plts/${DEVICE_ID}/${t}`, observables[`${DEVICE_ID}/${t}`]);
      await sleep(150);
    }
    const got = await Promise.all(waits);
    topics.forEach((t, i) => {
      if (got[i].includes(observables[`${DEVICE_ID}/${t}`])) {
        record("T6", `device PUB ${t} ter-deliver`, "PASS", "");
      } else {
        record("T6", `device PUB ${t} TIDAK ter-deliver`, "FAIL", "device harusnya boleh publish telemetry sendiri");
        fail();
      }
    });
    // ack + ota/event: tidak ada observer yang berhak subscribe — verifikasi level "tanpa error broker"
    for (const t of ["ack", "ota/event"]) {
      const err = await pub(d, `plts/${DEVICE_ID}/${t}`, `acltest-t6-${randomUUID().slice(0, 8)}`);
      if (!err) record("T6", `device PUB ${t} tanpa error broker`, "PASS", "observasi delivery tidak tersedia (tidak ada subscriber berhak)");
      else { record("T6", `device PUB ${t} error`, "FAIL", err); fail(); }
    }
  }

  // ---------- T7: device PUBLISH ke device lain ----------
  log("T7: device PUB plts/<B>/status (cross-device write)");
  {
    const topic = `plts/${OTHER_ID}/status`;
    const canary = `acltest-t7-${randomUUID()}`;
    // publish tak-berizin via koneksi PROBE device (kanal utama tetap hidup)
    let disconnected = false;
    let pubErr = null;
    try {
      const probe = (await connect(URL_, DEVICE_USER, DEVICE_PASS)).client;
      probe.on("close", () => { disconnected = true; });
      pubErr = await pub(probe, topic, canary, 1, 2000);
      await sleep(1500);
      endQuiet(probe);
    } catch (e) {
      pubErr = String(e?.message || e);
    }
    if (disconnected || pubErr) {
      record("T7", "cross-device write DITOLAK broker (disconnect/error)", "PASS", pubErr || "broker memutus koneksi");
    } else {
      // tidak ada observer sisi B — non-delivery tidak teramati. Laporan jujur.
      record("T7", "cross-device write: TANPA BUKTI LANGSUNG (silent drop tidak teramati)", "UNCONFIRMED",
        "butuh kredensial observer device-B untuk bukti non-delivery; disconnect/error = deny terkonfirmasi. Tidak dihitung FAIL.");
    }
  }

  endQuiet(viewerHolder.client);
  endQuiet(deviceHolder.client);

  const required = results.filter((r) => r.status === "FAIL").length;
  const verdict = failures === 0 ? "PASS" : "FAIL";
  log("");
  log(`VERDICT: ${verdict} — ${results.filter((r) => r.status === "PASS").length} PASS, ${required} FAIL, ` +
      `${results.filter((r) => r.status === "UNCONFIRMED").length} unconfirmed`);
  if (JSON_MODE) console.log(JSON.stringify({ verdict, failures, results }));
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(JSON.stringify({ verdict: "HARNESS-ERROR", error: String(e?.message || e) }));
  process.exit(2);
});
