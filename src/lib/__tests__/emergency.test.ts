// =============================================================================
// emergency.test.ts — emergency layer contract (PWA side, WAVE-7).
// Pins the config schema (3-layer shared table), the fail-closed auth prompt,
// and the GAS command wire format via a mocked global fetch.
// =============================================================================
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_EMERGENCY_CONFIG,
  EMERGENCY_CONFIG_FIELDS,
  normalizeEmergencyConfig,
  parseEmergencyBlock,
  sendEmergencyCommand,
  fetchEmergencyLog,
} from "@/lib/emergency";

const device = {
  gas_webapp_url: "https://script.google.com/macros/s/TEST/exec",
  auth_token: "device-token",
  device_id: "PLTS_TEST_01",
  admin_token: "admin-secret",
};

describe("EMERGENCY_CONFIG_FIELDS schema (shared 3-layer table)", () => {
  it("has exactly the 12 fields the GAS + firmware tables define", () => {
    expect(EMERGENCY_CONFIG_FIELDS.map((f) => f.key)).toEqual([
      "vbatLowV",
      "vbatLowHystV",
      "vbatHighV",
      "vbatHighHystV",
      "iDcOverA",
      "iAcLoadOverA",
      "iAcGenOverA",
      "debounceN",
      "recoverySec",
      "relayPin",
      "estopPin",
      "estopEnabled",
    ]);
  });
  it("defaults match the firmware struct defaults", () => {
    expect(DEFAULT_EMERGENCY_CONFIG).toEqual({
      vbatLowV: 42.0,
      vbatLowHystV: 1.0,
      vbatHighV: 55.0,
      vbatHighHystV: 1.0,
      iDcOverA: 110.0,
      iAcLoadOverA: 28.0,
      iAcGenOverA: 28.0,
      debounceN: 3,
      recoverySec: 60,
      relayPin: 27,
      estopPin: 14,
      estopEnabled: 1,
    });
  });
});

describe("normalizeEmergencyConfig — client-side pre-validation", () => {
  it("clamps out-of-range values to the schema bounds", () => {
    const c = normalizeEmergencyConfig({ vbatLowV: 999, debounceN: -5, relayPin: 99 });
    expect(c.vbatLowV).toBe(60);
    expect(c.debounceN).toBe(1);
    expect(c.relayPin).toBe(39);
  });
  it("drops unknown keys (GAS re-whitelists; firmware re-validates)", () => {
    const c = normalizeEmergencyConfig({ rogueField: 1 } as Record<string, number>);
    expect((c as unknown as Record<string, unknown>).rogueField).toBeUndefined();
  });
  it("null / garbage input → pure defaults", () => {
    expect(normalizeEmergencyConfig(null)).toEqual(DEFAULT_EMERGENCY_CONFIG);
    expect(normalizeEmergencyConfig(undefined)).toEqual(DEFAULT_EMERGENCY_CONFIG);
  });
});

describe("parseEmergencyBlock — honest UNKNOWN", () => {
  it("absent block → UNKNOWN, never RUN", () => {
    const e = parseEmergencyBlock(null);
    expect(e.state).toBe("UNKNOWN");
  });
  it("parses the GAS LATEST emergency shape", () => {
    const e = parseEmergencyBlock({
      state: "EMERGENCY",
      reason: "VBAT_LOW",
      estopLineOpen: false,
      tripCount: 4,
    });
    expect(e.state).toBe("EMERGENCY");
    expect(e.reason).toBe("VBAT_LOW");
    expect(e.tripCount).toBe(4);
  });
  it("garbage state string → UNKNOWN", () => {
    expect(parseEmergencyBlock({ state: "SOMETHING" }).state).toBe("UNKNOWN");
  });
});

describe("sendEmergencyCommand — wire format + fail-closed", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("REFUSES to send without an admin token (fail-closed, honest prompt)", async () => {
    const res = await sendEmergencyCommand(
      { ...device, admin_token: undefined },
      "DISARM",
    );
    expect(res.ok).toBe(false);
    expect(res.message).toContain("ADMIN_TOKEN");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends token + admin_token + device_key in the body (OTA_PUBLISH pattern)", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: "SUCCESS",
          message: "Emergency command queued",
          data: { command_id: "cmd-1", status: "PENDING" },
        }),
        { status: 200 },
      ),
    );
    const res = await sendEmergencyCommand(device, "ARM", { note: "tes" });
    expect(res.ok).toBe(true);
    expect(res.commandId).toBe("cmd-1");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).toEqual({
      action: "EMERGENCY_COMMAND",
      token: "device-token",
      admin_token: "admin-secret",
      device_key: "PLTS_TEST_01",
      command: "ARM",
      note: "tes",
    });
  });

  it("CONFIG command carries the full normalized config object", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: "SUCCESS", data: {} }), { status: 200 }),
    );
    await sendEmergencyCommand(device, "CONFIG", {
      config: normalizeEmergencyConfig({ vbatLowV: 43 }),
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.command).toBe("CONFIG");
    expect(Object.keys(body.config).sort()).toEqual(
      EMERGENCY_CONFIG_FIELDS.map((f) => f.key).sort(),
    );
    expect(body.config.vbatLowV).toBe(43);
  });

  it("GAS logical error (status ERROR) → ok:false with the server message", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ status: "ERROR", message: "command must be one of ARM/DISARM/CONFIG" }),
        { status: 200 },
      ),
    );
    const res = await sendEmergencyCommand(device, "ARM");
    expect(res.ok).toBe(false);
    expect(res.message).toContain("ARM/DISARM/CONFIG");
  });

  it("network failure → ok:false with the error message (never a fake success)", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const res = await sendEmergencyCommand(device, "ARM");
    expect(res.ok).toBe(false);
    expect(res.message).toContain("Failed to fetch");
  });
});

describe("fetchEmergencyLog", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the newest-first events from GAS", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: "SUCCESS",
          data: {
            events: [
              { ts: "2026-09-01T02:00:00Z", type: "TRIP", reason: "VBAT_LOW", detail: "", stateAfter: "EMERGENCY", source: "device" },
            ],
          },
        }),
        { status: 200 },
      ),
    );
    const res = await fetchEmergencyLog(device, 5);
    expect(res.ok).toBe(true);
    expect(res.events).toHaveLength(1);
    expect(res.events[0].type).toBe("TRIP");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.action).toBe("EMERGENCY_LOG");
    expect(body.limit).toBe(5);
  });

  it("empty events array on a fresh device (no fabricated history)", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ status: "SUCCESS", data: { events: [] } }),
        { status: 200 },
      ),
    );
    const res = await fetchEmergencyLog(device);
    expect(res.ok).toBe(true);
    expect(res.events).toEqual([]);
  });
});
