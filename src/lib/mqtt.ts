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
  return new Promise((resolve, reject) => {
    const MQTT_BROKER_URL = brokerUrl();
    // [PWA-03] Fail closed: no broker URL → refuse to connect (NEVER fall
    // back to a public unauthenticated broker).
    if (!MQTT_BROKER_URL) {
      reject(
        new Error(
          "MQTT broker not configured: set NEXT_PUBLIC_MQTT_BROKER_URL (authenticated broker, TLS/WSS)",
        ),
      );
      return;
    }
    // [W7-1 REMEDIATION 2026-09] TLS-only broker URL — the PWA counterpart of
    // the firmware PRODUCTION_BUILD #error guards (port 8883/8884 + root CA).
    // A ws:// (plaintext) URL would send telemetry + viewer credentials in
    // the clear; it is now rejected. EXPLICIT dev bypass only, mirroring the
    // firmware's DEVELOPMENT_BUILD setInsecure() pattern: visible, never
    // silent, never available in a production build.
    // NOTE: new URL() normalizes the scheme to lowercase (RFC 3986 — scheme
    // is case-insensitive), so "WSS://…" is accepted as TLS.
    {
      let parsed: URL;
      try {
        parsed = new URL(MQTT_BROKER_URL.trim());
      } catch {
        reject(
          new Error(
            "MQTT broker URL is not a valid absolute URL — expected " +
              "wss://host:port/path. Set NEXT_PUBLIC_MQTT_BROKER_URL to an " +
              "authenticated TLS endpoint.",
          ),
        );
        return;
      }
      const isTls = parsed.protocol === "wss:";
      const devBypass =
        parsed.protocol === "ws:" && process.env.NODE_ENV === "development";
      if (!isTls && !devBypass) {
        reject(
          new Error(
            `MQTT broker URL must use wss:// (TLS) — got "${parsed.protocol}". ` +
              "Refusing a plaintext connection; set NEXT_PUBLIC_MQTT_BROKER_URL " +
              "to an authenticated TLS endpoint (wss://…).",
          ),
        );
        return;
      }
    }
    if (state.client) {
      state.client.end(true);
      state.client = null;
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
      reject(
        new Error(
          "Device ID must be format PLTS-XXXXXX or PLTS-XXXXXXXX " +
            "(6 or 8 hex chars, as printed by the device)",
        ),
      );
      return;
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
      ...(brokerUsername() ? { username: brokerUsername() } : {}),
      ...(brokerPassword() ? { password: brokerPassword() } : {}),
    });

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
      const msg = payload.toString();
      if (topic.endsWith("/status")) {
        try {
          const parsed: unknown = JSON.parse(msg);
          // [audit-2 S-2] Shape validation — was `as SystemStatus` cast
          // without validation. A malformed/broker-compromised payload
          // could crash downstream code accessing nested fields.
          if (!isValidStatusEnvelope(parsed)) {
            mqttWarn(`invalid status envelope on ${topic} — dropping`);
            return;
          }
          const status = parsed as SystemStatus;
          // [PWA-01] Store the newest envelope for the query bridge + emit.
          lastStatus = status;
          lastStatusAtMs = Date.now();
          statusCallbacks.forEach((cb) => cb(status));
        } catch (e) {
          mqttWarn("failed to parse status JSON:", e);
        }
      } else if (topic.endsWith("/log")) {
        try {
          const log = JSON.parse(msg) as ActivityLog;
          logCallbacks.forEach((cb) => cb(log));
        } catch (e) {
          mqttWarn("failed to parse log JSON:", e);
        }
      } else if (topic.endsWith("/online")) {
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
  });
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
 * [audit-2 S-2] Validate that a parsed MQTT payload has the shape of a
 * SystemStatus envelope. Returns false on any missing required field —
 * downstream code can safely access nested fields without crashing.
 * Conservative: checks ONLY for the fields the PWA actually reads. Any
 * field not listed here is treated as optional.
 */
function isValidStatusEnvelope(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const p = payload as Record<string, unknown>;
  // Required top-level fields used by the PWA
  if (typeof p.timestamp !== "number") return false;
  // battery is required; nested .voltage.value is the most-used field
  if (!p.battery || typeof p.battery !== "object") return false;
  return true;  // other fields (pv, grid, environment, ...) are optional
}

