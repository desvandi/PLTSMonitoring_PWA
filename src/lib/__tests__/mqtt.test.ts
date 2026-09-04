// =============================================================================
// mqtt.test.ts — W7-1 remediation contract (TLS-only broker URL).
// -----------------------------------------------------------------------------
// AUDIT FINDING (W7-1, Wave 7 MQTT/TLS review): connectMqtt() accepted ANY
// broker URL scheme — a ws:// (plaintext) URL silently connected production
// builds without TLS, while the firmware side already failed closed
// (PRODUCTION_BUILD #error: port 8883/8884 + MQTT_ROOT_CA required).
//
// REMEDIATION TRUTH RULES under test:
//   W1  Empty broker URL → reject "not configured" (PWA-03, unchanged).
//   W2  ws:// (plaintext) in non-development → REJECTED with TLS message.
//   W3  wss:// → passes the scheme gate and reaches mqtt.connect().
//   W4  Foreign scheme (http://, tcp://, garbage) → REJECTED.
//   W5  ws:// is an EXPLICIT development-only bypass (NODE_ENV=development).
//   W6  The rejection does NOT tear down an existing client connection.
// =============================================================================
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- mqtt mock: capture the URL, resolve on "connect" -----------------------
type Conn = {
  url: string | undefined;
  on: (ev: string, cb: (...a: unknown[]) => void) => Conn;
  subscribe: (topics: string[], opts: unknown, cb: unknown) => void;
  end: (force?: boolean) => void;
};

const connectCalls: string[] = [];
const subscribedTopics: string[] = [];
const activeClients: Conn[] = [];

vi.mock("mqtt", () => ({
  default: {
    connect: (url: string): Conn => {
      connectCalls.push(url);
      const handlers = new Map<string, (...a: unknown[]) => void>();
      const c: Conn = {
        url,
        on: (ev, cb) => {
          handlers.set(ev, cb);
          return c;
        },
        subscribe: (topics, _o, cb) => {
          // Record the REAL topic strings the client would subscribe to.
          for (const t of (Array.isArray(topics) ? topics : [topics]) as string[]) {
            subscribedTopics.push(t);
          }
          (cb as (e: Error | null, g: unknown[]) => void)(null, [
            { topic: "t", qos: 1 },
            { topic: "t", qos: 1 },
            { topic: "t", qos: 1 },
          ]);
        },
        end: () => {
          const i = activeClients.indexOf(c);
          if (i >= 0) activeClients.splice(i, 1);
        },
      };
      activeClients.push(c);
      // Emit "connect" asynchronously like the real client would.
      setTimeout(() => {
        const h = handlers.get("connect");
        if (h) h();
      }, 0);
      return c;
    },
  },
}));

async function importMqtt() {
  // Env is read at CALL time in lib/mqtt.ts — a single import is enough;
  // vi.stubEnv takes effect on every connectMqtt() call.
  return import("@/lib/mqtt");
}

beforeEach(() => {
  connectCalls.length = 0;
  activeClients.length = 0;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("W7-1: TLS-only broker URL guard (connectMqtt)", () => {
  it("W1: rejects when the broker URL is not configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_MQTT_BROKER_URL", "");
    const { connectMqtt } = await importMqtt();
    await expect(connectMqtt("PLTS-AB12CD34")).rejects.toThrow(
      /not configured/i,
    );
    expect(connectCalls).toHaveLength(0);
  });

  it("W2: rejects ws:// (plaintext) outside development", async () => {
    vi.stubEnv("NEXT_PUBLIC_MQTT_BROKER_URL", "ws://broker.example.com:8083/mqtt");
    vi.stubEnv("NODE_ENV", "production");
    const { connectMqtt } = await importMqtt();
    await expect(connectMqtt("PLTS-AB12CD34")).rejects.toThrow(/wss:\/\/.*TLS/i);
    expect(connectCalls).toHaveLength(0);
  });

  it("W3: wss:// passes the scheme gate and reaches mqtt.connect()", async () => {
    vi.stubEnv("NEXT_PUBLIC_MQTT_BROKER_URL", "wss://broker.example.com:8884/mqtt");
    vi.stubEnv("NODE_ENV", "production");
    const { connectMqtt } = await importMqtt();
    // May still fail on subscribe semantics, but it must NOT fail on scheme.
    await connectMqtt("PLTS-AB12CD34").catch(() => {});
    expect(connectCalls).toEqual(["wss://broker.example.com:8884/mqtt"]);
    // Scheme is case-insensitive per RFC 3986 (new URL normalizes it).
    connectCalls.length = 0;
    vi.stubEnv("NEXT_PUBLIC_MQTT_BROKER_URL", "WSS://Broker.Example.Com:8884/mqtt");
    await connectMqtt("PLTS-AB12CD34").catch(() => {});
    expect(connectCalls).toHaveLength(1);
  });

  it("W4: rejects foreign schemes (http://, tcp://, malformed)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { connectMqtt } = await importMqtt();
    for (const bad of [
      "http://broker.example.com",
      "tcp://broker.example.com:1883",
      "broker.example.com:8884",
      "wss",
      "://no-scheme",
    ]) {
      vi.stubEnv("NEXT_PUBLIC_MQTT_BROKER_URL", bad);
      await expect(connectMqtt("PLTS-AB12CD34")).rejects.toThrow(/wss:\/\//i);
    }
    expect(connectCalls).toHaveLength(0);
  });

  it("W5: ws:// is an explicit development-only bypass", async () => {
    vi.stubEnv("NEXT_PUBLIC_MQTT_BROKER_URL", "ws://localhost:8083/mqtt");
    vi.stubEnv("NODE_ENV", "development");
    const { connectMqtt } = await importMqtt();
    await connectMqtt("PLTS-AB12CD34").catch(() => {});
    expect(connectCalls).toEqual(["ws://localhost:8083/mqtt"]);
  });

  it("W6: a rejected scheme does not tear down an existing connection", async () => {
    // First connect successfully with wss://
    vi.stubEnv("NEXT_PUBLIC_MQTT_BROKER_URL", "wss://broker.example.com:8884/mqtt");
    vi.stubEnv("NODE_ENV", "production");
    const m1 = await importMqtt();
    await m1.connectMqtt("PLTS-AB12CD34").catch(() => {});
    expect(activeClients).toHaveLength(1);
    const first = activeClients[0];

    // Same module instance, now a plaintext URL must be refused WITHOUT
    // ending the live client.
    vi.stubEnv("NEXT_PUBLIC_MQTT_BROKER_URL", "ws://evil.example.com/mqtt");
    await expect(m1.connectMqtt("PLTS-AB12CD34")).rejects.toThrow(/TLS/i);
    expect(activeClients).toHaveLength(1);
    expect(activeClients[0]).toBe(first);
  });
});

// =============================================================================
// W11-1: deviceId cross-layer contract (union {6,8} hex).
// -----------------------------------------------------------------------------
// AUDIT FINDING (W11-1, Wave 11 MQTT/TLS review): firmware/ modular generates
// "PLTS-%06X" (6 hex, lower 24-bit eFuse MAC — firmware_v1.ino) while this
// client demanded exactly 8 hex — stricter than every producer in the fleet,
// so MQTT realtime could NEVER connect to a real modular device. The contract
// is now the UNION: PLTS-XXXXXX (6) or PLTS-XXXXXXXX (8).
//
// TRUTH RULES under test:
//   D1  6-hex (real modular firmware form) is ACCEPTED and reaches
//       mqtt.connect().
//   D2  8-hex (documented generic form) still accepted (unchanged).
//   D3  5 / 7 / 9 hex → rejected (boundary check on both sides of the union).
//   D4  Topic-wildcard characters (+, #, /) can NEVER survive normalization —
//       the strip + charset regex keeps them out of the topic namespace.
//   D5  Lowercase input is normalized to uppercase before validation.
// =============================================================================
describe("W11-1: deviceId contract — union {6,8} hex", () => {
  const good = "wss://broker.example.com:8884/mqtt";

  it("D1: 6-hex deviceId (modular firmware form) is accepted", async () => {
    vi.stubEnv("NEXT_PUBLIC_MQTT_BROKER_URL", good);
    vi.stubEnv("NODE_ENV", "production");
    const { connectMqtt } = await importMqtt();
    await connectMqtt("PLTS-1A2B3C").catch(() => {});
    expect(connectCalls).toEqual([good]);
  });

  it("D2: 8-hex deviceId (generic documented form) is still accepted", async () => {
    vi.stubEnv("NEXT_PUBLIC_MQTT_BROKER_URL", good);
    vi.stubEnv("NODE_ENV", "production");
    const { connectMqtt } = await importMqtt();
    await connectMqtt("PLTS-AB12CD34").catch(() => {});
    expect(connectCalls).toEqual([good]);
  });

  it("D3: 5/7/9-hex deviceIds are rejected (union boundaries)", async () => {
    vi.stubEnv("NEXT_PUBLIC_MQTT_BROKER_URL", good);
    vi.stubEnv("NODE_ENV", "production");
    const { connectMqtt } = await importMqtt();
    for (const bad of ["PLTS-1A2B3", "PLTS-1A2B3C4", "PLTS-1A2B3C4D5"]) {
      await expect(connectMqtt(bad)).rejects.toThrow(/PLTS-XXXXXX or PLTS-XXXXXXXX/i);
    }
    expect(connectCalls).toHaveLength(0);
  });

  it("D4: wildcard/topic metacharacters never reach a topic", async () => {
    vi.stubEnv("NEXT_PUBLIC_MQTT_BROKER_URL", good);
    vi.stubEnv("NODE_ENV", "production");
    const { connectMqtt, disconnectMqtt, getMqttDeviceId } = await importMqtt();
    // Reset module state (previous tests left a deviceId behind).
    disconnectMqtt();
    subscribedTopics.length = 0;
    // Case 1 — input whose normalized form is INVALID ("PLTS-1A/+#" strips
    // to "PLTS-1A", 2 hex): rejected, no connection attempted.
    await expect(connectMqtt("PLTS-1A/+#")).rejects.toThrow(/PLTS-XXXXXX/i);
    expect(connectCalls).toHaveLength(0);
    // Case 2 — input whose normalized form is VALID ("PLTS-1A2B3C/+" strips
    // to "PLTS-1A2B3C"): the connection goes ahead, and the SECURITY
    // PROPERTY is that the subscribed topics contain NO MQTT metacharacters
    // ('+', '#', or a '/' inside the deviceId segment) — the strip +
    // [A-Z0-9-] charset makes wildcard smuggling into the topic namespace
    // impossible.
    await connectMqtt("PLTS-1A2B3C/+").catch(() => {});
    expect(connectCalls).toEqual([good]);
    expect(subscribedTopics).toHaveLength(3);
    for (const t of subscribedTopics) {
      expect(t).toMatch(/^plts\/PLTS-[A-Z0-9-]+\/(status|log|online)$/);
      expect(t).not.toMatch(/[+]/);
      expect(t).not.toMatch(/plts\/.*.*\/.*#|\/\//);
    }
    expect(getMqttDeviceId()).toBe("PLTS-1A2B3C");
  });

  it("D5: lowercase deviceId is normalized to uppercase", async () => {
    vi.stubEnv("NEXT_PUBLIC_MQTT_BROKER_URL", good);
    vi.stubEnv("NODE_ENV", "production");
    const { connectMqtt, disconnectMqtt, getMqttDeviceId } = await importMqtt();
    disconnectMqtt();   // isolate module state from previous cases
    await connectMqtt("plts-1a2b3c").catch(() => {});
    expect(getMqttDeviceId()).toBe("PLTS-1A2B3C");
  });
});
