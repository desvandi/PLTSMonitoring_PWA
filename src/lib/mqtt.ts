// =============================================================================
// MQTT Client — connects to broker via WebSocket TLS, SUBSCRIBE-ONLY.
// -----------------------------------------------------------------------------
// MONITORING-ONLY system — there are NO commands to send, NO ack transactions.
// The PWA only listens to status/log/online topics published by the ESP32.
//
// Topics (brief §7.3):
//   plts/<deviceId>/status  (QoS 0) — telemetry publish (5s)
//   plts/<deviceId>/log     (QoS 0) — log events
//   plts/<deviceId>/online  (QoS 1, retain, LWT) — presence
//
// [PWA-03 REMEDIATION 2026-08] NO PUBLIC BROKER DEFAULT. The previous default
// (wss://broker.hivemq.com:8884/mqtt) silently connected production builds to
// a free public broker with NO authentication — anyone guessing a device ID
// could read telemetry. Now: NEXT_PUBLIC_MQTT_BROKER_URL is REQUIRED;
// connectMqtt() fails closed with a clear message when it is not configured.
// Credentials must be scoped viewer credentials (broker ACL: read-only on
// plts/<deviceId>/#) — never a fleet-wide or write-enabled credential.
// =============================================================================

import mqtt from "mqtt";
import type { SystemStatus, ActivityLog } from "./types";

// [W7-1] Read at CALL time (not module load): identical runtime behavior in
// the browser (Next.js inlines NEXT_PUBLIC_* at build time) but lets tests
// stub the environment per-case without module gymnastics.
const brokerUrl = (): string => process.env.NEXT_PUBLIC_MQTT_BROKER_URL || "";
const brokerUsername = (): string => process.env.NEXT_PUBLIC_MQTT_USERNAME || "";
const brokerPassword = (): string => process.env.NEXT_PUBLIC_MQTT_PASSWORD || "";

/**
 * [AUDIT p.486-old REMEDIATION 2026-09] Server-held MQTT credentials.
 * Preferred source: the authenticated same-origin route /api/mqtt/credentials
 * (env MQTT_USERNAME/MQTT_PASSWORD on the server — NEVER baked into the public
 * bundle). Backwards-compatible fallback: NEXT_PUBLIC_* values (documented as
 * VIEWER, READ-ONLY-ACL credentials; must never carry publish rights).
 * Pure-MQTT viewer deployments without a PWA login keep working through the
 * fallback; new deployments should provision server-side credentials and a
 * read-only broker ACL instead.
 */
async function resolveMqttCredentials(): Promise<{
  username?: string;
  password?: string;
}> {
  try {
    const res = await fetch("/api/mqtt/credentials", {
      credentials: "include",
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      const json = (await res.json()) as {
        success?: boolean;
        data?: { username?: string; password?: string };
      } | null;
      if (json?.data?.username) {
        return {
          username: json.data.username,
          password: json.data.password ?? "",
        };
      }
    }
  } catch {
    // Route unreachable (offline dev, test env, unauthenticated session) —
    // fall through to the compatibility path below.
  }
  const u = brokerUsername();
  const p = brokerPassword();
  if (u) return { username: u, password: p };
  return {};
}

// [PWA-19] Diagnostics logging gated to development — the previous build
// logged broker URL + clientId + granted topics to the browser console.
const mqttLog = (...args: unknown[]) => {
  if (process.env.NODE_ENV === "development") console.log("[MQTT]", ...args);
};
const mqttWarn = (...args: unknown[]) => {
  if (process.env.NODE_ENV === "development") console.warn("[MQTT]", ...args);
};

type MqttState = {
  client: mqtt.MqttClient | null;
  deviceId: string | null;
  connected: boolean;
};

type StatusCallback = (status: SystemStatus) => void;
type LogCallback = (log: ActivityLog) => void;
type OnlineCallback = (online: boolean) => void;

const state: MqttState = {
  client: null,
  deviceId: null,
  connected: false,
};

const statusCallbacks = new Set<StatusCallback>();
const logCallbacks = new Set<LogCallback>();
const onlineCallbacks = new Set<OnlineCallback>();

// [PWA-01 REMEDIATION 2026-08] Last received telemetry snapshot — consumed by
// the React Query bridge so MQTT telemetry actually reaches the dashboard
// (previously the useMqttStatus hook had ZERO consumers: MQTT-only production
// mode rendered skeletons forever after login).
let lastStatus: SystemStatus | null = null;
let lastStatusAtMs = 0;

export function hasMqttStatus(): boolean {
  return lastStatus !== null;
}

/** Newest MQTT telemetry envelope (null when none received yet). */
export function getMqttStatus(): SystemStatus | null {
  return lastStatus;
}

export function getMqttStatusAge(): number | null {
  return lastStatus ? Date.now() - lastStatusAtMs : null;
}

export function getMqttDeviceId(): string | null {
  if (state.deviceId) return state.deviceId;
  if (typeof localStorage !== "undefined") {
    return localStorage.getItem("plts-mqtt-device-id");
  }
  return null;
}

export function setMqttDeviceId(deviceId: string | null) {
  state.deviceId = deviceId;
  if (typeof localStorage !== "undefined") {
    if (deviceId) {
      localStorage.setItem("plts-mqtt-device-id", deviceId);
    } else {
      localStorage.removeItem("plts-mqtt-device-id");
    }
  }
}

export function isMqttConfigured(): boolean {
  return !!getMqttDeviceId();
}

export function isMqttConnected(): boolean {
  return state.connected;
}

export function connectMqtt(deviceId: string): Promise<void> {
  // [p.487/p.486-old REMEDIATION 2026-09] connectMqtt is now async all the
  // way down: all fail-closed validations run BEFORE any network activity,
  // and credentials resolve from the authenticated server route first
  // (server-held), falling back to the documented NEXT_PUBLIC viewer pair.
  const MQTT_BROKER_URL = brokerUrl();
  // [PWA-03] Fail closed: no broker URL → refuse to connect (NEVER fall
  // back to a public unauthenticated broker).
  if (!MQTT_BROKER_URL) {
    return Promise.reject(
      new Error(
        "MQTT broker not configured: set NEXT_PUBLIC_MQTT_BROKER_URL (authenticated broker, TLS/WSS)",
      ),
    );
  }
  // [W7-1 REMEDIATION 2026-09] TLS-only broker URL — the PWA counterpart of
  // the firmware PRODUCTION_BUILD #error guards (port 8883/8884 + root CA).
  // A ws:// (plaintext) URL would send telemetry + viewer credentials in
  // the clear; it is now rejected. EXPLICIT dev bypass only, mirroring the
  // firmware's DEVELOPMENT_BUILD setInsecure() pattern: visible, never
  // silent, never available in a production build.
  // NOTE: new URL() normalizes the scheme to lowercase (RFC 3986 — scheme
  // is case-insensitive), so "WSS://…" is accepted as TLS.
  let parsed: URL;
  try {
    parsed = new URL(MQTT_BROKER_URL.trim());
  } catch {
    return Promise.reject(
      new Error(
        "MQTT broker URL is not a valid absolute URL — expected " +
          "wss://host:port/path. Set NEXT_PUBLIC_MQTT_BROKER_URL to an " +
          "authenticated TLS endpoint.",
      ),
    );
  }
  const isTls = parsed.protocol === "wss:";
  const devBypass =
    parsed.protocol === "ws:" && process.env.NODE_ENV === "development";
  if (!isTls && !devBypass) {
    return Promise.reject(
      new Error(
        `MQTT broker URL must use wss:// (TLS) — got "${parsed.protocol}". ` +
          "Refusing a plaintext connection; set NEXT_PUBLIC_MQTT_BROKER_URL " +
          "to an authenticated TLS endpoint (wss://…).",
      ),
    );
  }

  // [W11-1 REMEDIATION 2026-09] Device ID contract — the firmware/ modular
  // generates "PLTS-XXXXXX" (6 hex, lower 24-bit eFuse MAC, see
  // firmware_v1.ino snprintf "PLTS-%06X"); the documented generic form is
  // "PLTS-XXXXXXXX" (8 hex). The PWA previously demanded 8 hex ONLY —
  // stricter than every producer in the fleet, so MQTT realtime could
  // NEVER connect to a real modular device (operator typed the ID printed
  // by the device and got rejected). The PWA now accepts the EXACT union
  // {6, 8} (explicit alternation — NOT the {6,8} range, which would also
  // admit 7 hex and quietly blur the contract): charset stays uppercase
  // hex, so topic wildcards ('+','#','/') can never enter a topic via the
  // device ID.
  const normalized = deviceId.toUpperCase().replace(/[^A-Z0-9-]/g, "");
  if (!/^PLTS-(?:[A-F0-9]{6}|[A-F0-9]{8})$/.test(normalized)) {
    return Promise.reject(
      new Error(
        "Device ID must be format PLTS-XXXXXX or PLTS-XXXXXXXX " +
          "(6 or 8 hex chars, as printed by the device)",
      ),
    );
  }

  // [p.486-old REMEDIATION] Server-held credentials resolve BEFORE the
  // connection is opened (authenticated route first, documented
  // NEXT_PUBLIC viewer pair as the compatibility fallback).
  return resolveMqttCredentials().then((creds) => {
    if (state.client) {
      state.client.end(true);
      state.client = null;
    }
    state.deviceId = normalized;

    const baseTopic = `plts/${state.deviceId}`;
    const clientId = `pwa-${crypto.randomUUID()}`;

    mqttLog(`connecting to configured broker as ${clientId}`);

    const client = mqtt.connect(MQTT_BROKER_URL, {
      clientId,
      keepalive: 60,
      // [audit-2 S-8 FIX] Exponential backoff: was fixed 5s. A broker outage
      // caused the PWA to hammer reconnect every 5s forever — inadvertent
      // DDoS. mqtt.js library supports a single reconnectPeriod value (no
      // built-in backoff), so we implement backoff manually by intercepting
      // the reconnect event and adjusting the option before the next attempt.
      // Start at 1s, cap at 60s. The library will use this for the next
      // reconnect; we update it in the offline event handler below.
      reconnectPeriod: 1000,
      connectTimeout: 10000,
      clean: true,
      ...(creds.username ? { username: creds.username } : {}),
      ...(creds.password ? { password: creds.password } : {}),
    });

    // [p.486-old/p.487] The connection lifecycle now settles inside an inner
    // promise — the outer .then() chain keeps the credential fetch out of the
    // fail-closed validation path.
    return new Promise<void>((resolve, reject) => {
    // [audit-2 S-8] Manual exponential backoff. mqtt.js doesn't support
    // backoff natively — it uses a fixed reconnectPeriod. We override the
    // option on each offline event so the next reconnect waits longer.
    // Reset to 1s on successful connect.
    let reconnectMs = 1000;
    client.on("connect", () => {
      reconnectMs = 1000;   // reset on success
    });
    client.on("offline", () => {
      reconnectMs = Math.min(reconnectMs * 2, 60_000);  // cap at 60s
      try {
        (client.options as { reconnectPeriod: number }).reconnectPeriod = reconnectMs;
      } catch {
        // options may be frozen in some mqtt.js versions — best-effort
      }
    });

    state.client = client;

    let settled = false;
    const resolveOnce = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };
    const rejectOnce = (err: Error) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    };

    client.on("connect", () => {
      mqttLog("connected, subscribing...");
      // Subscribe-only — no command/ack/ota topics needed (monitoring-only).
      client.subscribe(
        [`${baseTopic}/status`, `${baseTopic}/log`, `${baseTopic}/online`],
        { qos: 1 },
        (err, granted) => {
          if (err) {
            mqttWarn("subscribe error:", err);
            state.connected = false;
            rejectOnce(new Error(`MQTT subscription failed: ${err.message}`));
            return;
          }
          const expectedTopics = 3;
          if (!granted || granted.length !== expectedTopics) {
            mqttWarn("incomplete subscriptions:", granted);
            state.connected = false;
            rejectOnce(
              new Error(
                `MQTT subscription incomplete: expected ${expectedTopics}, got ${granted?.length ?? 0}`,
              ),
            );
            return;
          }
          const denied = granted.filter((g: { qos: number; topic: string }) => g.qos === 128);
          if (denied.length > 0) {
            mqttWarn("subscriptions denied:", denied);
            state.connected = false;
            rejectOnce(
              new Error(
                `MQTT subscriptions denied: ${denied.map((d: { topic: string }) => d.topic).join(", ")}`,
              ),
            );
            return;
          }
          mqttLog("all subscriptions confirmed");
          state.connected = true;
          onlineCallbacks.forEach((cb) => cb(true));
          resolveOnce();
        },
      );
    });

    client.on("message", (topic: string, payload: Buffer) => {
      // [audit-2 S-2 FIX] Bound payload size — a compromised broker could
      // send a 100MB payload and OOM the client. 256 KB is generous for any
      // legitimate telemetry envelope (typical is < 4 KB).
      if (payload.length > 256 * 1024) {
        mqttWarn(`oversized payload on ${topic} (${payload.length} bytes) — dropping`);
        return;
      }
      // [p.487 REMEDIATION 2026-09] DEVICE-ID BINDING (authenticity layer):
      // a message is only accepted from the EXACT topic tree of the device
      // this session subscribed to (plts/<deviceId>/…). A broker bug or a
      // malicious publisher pushing look-alike topics (plts/<otherId>/status,
      // or a topic that merely ENDS with /status) can no longer inject
      // telemetry into this dashboard.
      const expectedPrefix = `plts/${state.deviceId}/`;
      if (state.deviceId && !topic.startsWith(expectedPrefix)) {
        mqttWarn(`topic binding mismatch — expected "${expectedPrefix}*", got "${topic}" — dropping`);
        return;
      }
      const msg = payload.toString();
      if (topic === `${expectedPrefix}status`) {
        try {
          const parsed: unknown = JSON.parse(msg);
          // [audit-2 S-2 + p.487] Shape validation — was `as SystemStatus`
          // cast with a shallow validator. Now: strict envelope contract
          // (timestamp bounds, battery.voltage presence, SOC range) plus
          // envelope deviceId↔session binding when the field is present.
          if (!isValidStatusEnvelope(parsed)) {
            mqttWarn(`invalid status envelope on ${topic} — dropping`);
            return;
          }
          const status = parsed as SystemStatus;
          const envelopeDeviceId = (parsed as { deviceId?: unknown }).deviceId;
          if (
            typeof envelopeDeviceId === "string" &&
            state.deviceId &&
            envelopeDeviceId.toUpperCase() !== state.deviceId
          ) {
            mqttWarn(
              `envelope deviceId "${envelopeDeviceId}" ≠ subscribed "${state.deviceId}" — dropping (possible spoof)`,
            );
            return;
          }
          // [PWA-01] Store the newest envelope for the query bridge + emit.
          lastStatus = status;
          lastStatusAtMs = Date.now();
          statusCallbacks.forEach((cb) => cb(status));
        } catch (e) {
          mqttWarn("failed to parse status JSON:", e);
        }
      } else if (topic === `${expectedPrefix}log`) {
        try {
          const parsed: unknown = JSON.parse(msg);
          // [p.487] /log payloads were previously cast with NO validation —
          // a malformed entry reached log consumers as garbage state.
          if (!isValidLogEntry(parsed)) {
            mqttWarn(`invalid log entry on ${topic} — dropping`);
            return;
          }
          const log = parsed as ActivityLog;
          logCallbacks.forEach((cb) => cb(log));
        } catch (e) {
          mqttWarn("failed to parse log JSON:", e);
        }
      } else if (topic === `${expectedPrefix}online`) {
        const online = msg === "1";
        onlineCallbacks.forEach((cb) => cb(online));
      }
    });

    client.on("error", (err: Error) => {
      mqttWarn("error:", err.message);
      if (!settled) {
        rejectOnce(err);
      }
    });

    client.on("offline", () => {
      mqttLog("offline");
      state.connected = false;
      onlineCallbacks.forEach((cb) => cb(false));
    });

    client.on("reconnect", () => {
      mqttLog("reconnecting...");
    });
    }); // end inner connection promise
  }); // end credentials .then()
}

export function disconnectMqtt() {
  if (state.client) {
    state.client.end(true);
    state.client = null;
  }
  state.connected = false;
  state.deviceId = null;
  lastStatus = null;      // [PWA-01] clear the bridge snapshot
  lastStatusAtMs = 0;
}

export function onStatusChange(cb: StatusCallback): () => void {
  statusCallbacks.add(cb);
  return () => statusCallbacks.delete(cb);
}

export function onLog(cb: LogCallback): () => void {
  logCallbacks.add(cb);
  return () => logCallbacks.delete(cb);
}

export function onOnlineChange(cb: OnlineCallback): () => void {
  onlineCallbacks.add(cb);
  return () => onlineCallbacks.delete(cb);
}

/**
 * [audit-2 S-2 + AUDIT p.487 REMEDIATION 2026-09] STRICT envelope contract.
 * The previous validator accepted `{timestamp: <any number>, battery: {}}` —
 * a partial/spoofed envelope was promoted to a fully-trusted SystemStatus.
 * Now every field the dashboard actually consumes is verified:
 *   - timestamp: finite AND bounded (not pre-2020, not > now + 10 min skew)
 *   - battery.voltage: PRESENT as an object with a `value` field — the value
 *     itself may legitimately be null (firmware NaN-safe serializer emits
 *     null for an absent sensor, never a fabricated 0)
 *   - battery.current.value: null or finite when the block is present
 *   - battery.soc.value: null or finite within [0,100] when present
 *   - deviceId (when present) is bound to the subscribed device at the
 *     call site (see the message handler's envelope binding check)
 */
const TIMESTAMP_MIN_MS = Date.UTC(2020, 0, 1);
const TIMESTAMP_MAX_SKEW_MS = 10 * 60 * 1000;

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** value must be present (key exists) and be null-or-finite. */
function isNullableFiniteNumber(v: unknown): boolean {
  return v === null || isFiniteNumber(v);
}

function isValidStatusEnvelope(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const p = payload as Record<string, unknown>;
  // timestamp: finite + bounded (rejects 123456789-style garbage seconds,
  // far-past/far-future clocks, and non-numeric values)
  if (!isFiniteNumber(p.timestamp)) return false;
  if (p.timestamp < TIMESTAMP_MIN_MS) return false;
  if (p.timestamp > Date.now() + TIMESTAMP_MAX_SKEW_MS) return false;
  // battery: required object with the voltage block PRESENT (value nullable)
  const b = p.battery;
  if (!b || typeof b !== "object") return false;
  const batt = b as Record<string, unknown>;
  const voltage = batt.voltage;
  if (!voltage || typeof voltage !== "object") return false;
  if (!("value" in (voltage as Record<string, unknown>))) return false;
  if (!isNullableFiniteNumber((voltage as Record<string, unknown>).value)) return false;
  // current block: optional, but when present its value must be null/finite
  const current = batt.current;
  if (current !== undefined && current !== null) {
    if (typeof current !== "object" || !("value" in (current as Record<string, unknown>))) return false;
    if (!isNullableFiniteNumber((current as Record<string, unknown>).value)) return false;
  }
  // soc block: optional; value must be null or finite within [0,100]
  const soc = batt.soc;
  if (soc !== undefined && soc !== null && typeof soc === "object") {
    const socValue = (soc as Record<string, unknown>).value;
    if (socValue !== undefined && socValue !== null) {
      if (!isFiniteNumber(socValue)) return false;
      if (socValue < 0 || socValue > 100) return false;
    }
  }
  return true; // other blocks (ac, environment, health, ...) are optional
}

/**
 * [p.487 REMEDIATION] /log entries were previously cast with NO validation.
 * Minimum honest contract: finite bounded timestamp + string type + string
 * message — anything else is dropped before reaching log consumers.
 */
function isValidLogEntry(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const p = payload as Record<string, unknown>;
  if (!isFiniteNumber(p.timestamp)) return false;
  if (p.timestamp < TIMESTAMP_MIN_MS) return false;
  if (p.timestamp > Date.now() + TIMESTAMP_MAX_SKEW_MS) return false;
  if (typeof p.type !== "string" || p.type.length === 0) return false;
  if (typeof p.message !== "string") return false;
  return true;
}

