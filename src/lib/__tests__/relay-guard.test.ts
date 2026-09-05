// =============================================================================
// relay-guard.test.ts — [P1 PWA-03 regression tests]
// Policy under test: relay MUTATIONS are guarded at the COMMAND LAYER, not
// only in the UI. A caller that bypasses UI gating still cannot reach the
// relay endpoints unless compatibility was VERIFIED and relays supported.
//   - snapshot missing (never verified) → BLOCKED (fail-closed)
//   - canControlRelays === false        → BLOCKED
//   - compatible firmware ≥ 1.8.0       → POST goes through with requestId
// =============================================================================
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { deviceApi } from "@/lib/deviceApi";
import {
  IncompatibleFirmwareError,
  setCompatibilitySnapshot,
  type CompatibilityStatus,
} from "@/lib/compatibility";

const UNKNOWN_ST: CompatibilityStatus = {
  status: "unknown",
  pwaVersion: "1.0.0",
  firmwareVersion: null,
  protocolVersion: null,
  configSchemaVersion: null,
  message: "Device unreachable — cannot verify firmware compatibility.",
  canViewTelemetry: false,
  canControlRelays: false,
};

const OLD_FW_ST: CompatibilityStatus = {
  status: "compatible",
  pwaVersion: "1.0.0",
  firmwareVersion: "1.7.5",
  protocolVersion: 1,
  configSchemaVersion: 1,
  message: "Firmware compatible — telemetry display enabled.",
  canViewTelemetry: true,
  canControlRelays: false, // relays require firmware ≥ 1.8.0
};

const COMPAT_193_ST: CompatibilityStatus = {
  status: "compatible",
  pwaVersion: "1.0.0",
  firmwareVersion: "1.9.3",
  protocolVersion: 1,
  configSchemaVersion: 1,
  message: "Firmware compatible — telemetry display enabled.",
  canViewTelemetry: true,
  canControlRelays: true,
};

beforeEach(() => {
  setCompatibilitySnapshot(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
  setCompatibilitySnapshot(null);
});

describe("relay command-layer guard (P1 PWA-03) — fail-closed", () => {
  it("snapshot missing (compatibility never verified) → ALL relay mutations rejected", async () => {
    setCompatibilitySnapshot(null);
    await expect(deviceApi.relayOn(1)).rejects.toThrow(IncompatibleFirmwareError);
    await expect(deviceApi.relayOff(1)).rejects.toThrow(IncompatibleFirmwareError);
    await expect(deviceApi.relayPulse(1, 500)).rejects.toThrow(IncompatibleFirmwareError);
    await expect(deviceApi.relayAllOff()).rejects.toThrow(IncompatibleFirmwareError);
    await expect(deviceApi.relayAcknowledge(1)).rejects.toThrow(IncompatibleFirmwareError);
    await expect(deviceApi.relayClear(1)).rejects.toThrow(IncompatibleFirmwareError);
  });

  it("firmware < 1.8.0 (canControlRelays=false) → rejected, no network call", async () => {
    setCompatibilitySnapshot(OLD_FW_ST);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(deviceApi.relayOn(2)).rejects.toThrow(IncompatibleFirmwareError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("device unreachable (unknown status) → rejected (P0 PWA-02 synergy)", async () => {
    setCompatibilitySnapshot(UNKNOWN_ST);
    await expect(deviceApi.relayOn(1)).rejects.toThrow(IncompatibleFirmwareError);
  });
});

describe("relay command-layer guard — allowed path", () => {
  it("compatible firmware ≥ 1.8.0 → POST proceeds with requestId + source", async () => {
    setCompatibilitySnapshot(COMPAT_193_ST);
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          success: true,
          data: { ok: true, result: "EXECUTED", channel: 1, message: "on", transactionId: "tx-1" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await deviceApi.relayOn(1);
    expect(result.ok).toBe(true);
    expect(result.result).toBe("EXECUTED");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toContain("/api/relays/1/on");
    expect(init.method).toBe("POST");
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    // Request identity contract (durable transaction identity) is preserved.
    expect(typeof body.requestId).toBe("string");
    expect((body.requestId as string).length).toBeGreaterThan(0);
    expect(body.source).toBe("MANUAL");
  });
});
