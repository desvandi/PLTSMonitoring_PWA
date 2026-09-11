/**
 * truth-semantics.test.ts — PWA truth-state unit tests (Level 2 evidence)
 * =============================================================================
 * Verifies the P0-006 / P1-011 / P1-015 invariants implemented in
 * lib/types.ts + lib/mockStore.ts + lib/sysConfig.ts:
 *
 *   P1-015  freshness ladder: LIVE <10s / DELAYED 10–60s / STALE ≥60s / NO_DATA
 *   P1-011  effectiveQuality: STALE envelope never renders VALID
 *   P0-006  mock gating: production (non-demo) getSystemStatus() returns an
 *           explicit NO_DATA envelope — never fabricated numbers
 *   P0-006  diagnostics + daily energy fabrication disabled in production
 *   P0-007  sysConfig defaults are 48V/200Ah/45V
 * =============================================================================
 */
import { describe, it, expect } from "vitest";
import {
  computeFreshness,
  effectiveQuality,
} from "@/lib/types";
import { DEFAULT_DASHBOARD_SETTINGS } from "@/lib/sysConfig";

const NOW = 1_800_000_000_000; // fixed epoch for deterministic tests

describe("P1-015 — freshness ladder", () => {
  it("no timestamp / zero / invalid → NO_DATA", () => {
    expect(computeFreshness(null, { now: NOW })).toBe("NO_DATA");
    expect(computeFreshness(undefined, { now: NOW })).toBe("NO_DATA");
    expect(computeFreshness(0, { now: NOW })).toBe("NO_DATA");
    expect(computeFreshness(Number.NaN, { now: NOW })).toBe("NO_DATA");
  });

  it("age < 10s → LIVE", () => {
    expect(computeFreshness(NOW - 5_000, { now: NOW })).toBe("LIVE");
    expect(computeFreshness(NOW - 9_999, { now: NOW })).toBe("LIVE");
  });

  it("10s ≤ age < 60s → DELAYED", () => {
    expect(computeFreshness(NOW - 10_000, { now: NOW })).toBe("DELAYED");
    expect(computeFreshness(NOW - 59_999, { now: NOW })).toBe("DELAYED");
  });

  it("age ≥ 60s → STALE", () => {
    expect(computeFreshness(NOW - 60_000, { now: NOW })).toBe("STALE");
    expect(computeFreshness(NOW - 3_600_000, { now: NOW })).toBe("STALE");
  });

  it("future timestamp (clock skew) → LIVE, never error", () => {
    expect(computeFreshness(NOW + 30_000, { now: NOW })).toBe("LIVE");
  });

  // [PRODUCTION-GRADE 2026-09 / audit p.240-241] A device clock running far
  // AHEAD must surface as CLOCK_SKEW, not silently pass as LIVE — this
  // mirrors the GAS HMAC ±300 s window (one canonical clock policy).
  it("future timestamp beyond +5 min → CLOCK_SKEW (not LIVE)", () => {
    expect(computeFreshness(NOW + 300_001, { now: NOW })).toBe("CLOCK_SKEW");
    expect(computeFreshness(NOW + 600_000, { now: NOW })).toBe("CLOCK_SKEW");
    expect(computeFreshness(NOW + 3_600_000, { now: NOW })).toBe("CLOCK_SKEW");
  });

  it("minor future skew (< +5 min) still → LIVE", () => {
    expect(computeFreshness(NOW + 1_000, { now: NOW })).toBe("LIVE");
    expect(computeFreshness(NOW + 299_999, { now: NOW })).toBe("LIVE");
  });
});

describe("P1-011 — effective quality propagation", () => {
  it("STALE freshness demotes any non-error quality to STALE", () => {
    expect(effectiveQuality("VALID", "STALE")).toBe("STALE");
    expect(effectiveQuality("ESTIMATED", "STALE")).toBe("STALE");
    expect(effectiveQuality("DERIVED", "STALE")).toBe("STALE");
  });

  it("SENSOR_ERROR / NOT_AVAILABLE are never 'improved' by staleness", () => {
    expect(effectiveQuality("SENSOR_ERROR", "STALE")).toBe("SENSOR_ERROR");
    expect(effectiveQuality("NOT_AVAILABLE", "STALE")).toBe("NOT_AVAILABLE");
  });

  it("DELAYED demotes VALID to SUSPECT (uncertainty is visible)", () => {
    expect(effectiveQuality("VALID", "DELAYED")).toBe("SUSPECT");
    expect(effectiveQuality("STALE", "DELAYED")).toBe("STALE");
  });

  it("NO_DATA forces NOT_AVAILABLE regardless of the payload claim", () => {
    expect(effectiveQuality("VALID", "NO_DATA")).toBe("NOT_AVAILABLE");
  });

  it("LIVE preserves the payload quality", () => {
    expect(effectiveQuality("VALID", "LIVE")).toBe("VALID");
    expect(effectiveQuality("ESTIMATED", "LIVE")).toBe("ESTIMATED");
  });
});

describe("P0-007 — 48V canonical defaults", () => {
  it("sysConfig defaults: 48 V nominal / 200 Ah / 45.0 V low threshold", () => {
    expect(DEFAULT_DASHBOARD_SETTINGS.battery_nominal_voltage).toBe(48);
    expect(DEFAULT_DASHBOARD_SETTINGS.battery_capacity_ah).toBe(200);
    expect(DEFAULT_DASHBOARD_SETTINGS.low_battery_warning_threshold).toBe(45.0);
  });
});

describe("P0-006 — mock telemetry gating (production fail-closed)", () => {
  // The mock store gates on DEMO_MODE compiled from env at module load; in the
  // vitest node env NODE_ENV='test' with no MOCK_* env vars set, mock auth is
  // OFF — exactly the production-path condition we assert against.
  it("isMockAuthEnabled() === false without full MOCK env trio", async () => {
    const store = await import("@/lib/mockStore");
    expect(store.isMockAuthEnabled()).toBe(false);
  });

  it("getDailyEnergy() returns [] when mock auth disabled (no fabricated history)", async () => {
    const store = await import("@/lib/mockStore");
    expect(store.getDailyEnergy()).toEqual([]);
  });

  it("getSystemStatus() returns the NO_DATA envelope when mock disabled", async () => {
    const store = await import("@/lib/mockStore");
    const s = store.getSystemStatus();
    // [P0-006] THE invariant: no fabricated numbers, explicit NOT_AVAILABLE.
    expect(s.online).toBe(false);
    expect(s.simulated).toBe(false);
    expect(s.battery.voltage.value).toBeNull();
    expect(s.battery.voltage.quality).toBe("NOT_AVAILABLE");
    expect(s.battery.soc.value).toBeNull();
    expect(s.battery.soc.quality).toBe("NOT_AVAILABLE");
    expect(s.health.mqttConnected).toBe(false);
    expect(s.health.spoolSize).toBeNull();
    expect(s.timeQuality).toBe("UNKNOWN");
  });

  it("getDiagnostics() reports OFFLINE/UNKNOWN when mock disabled", async () => {
    const store = await import("@/lib/mockStore");
    const d = store.getDiagnostics();
    expect(d.mqttState).toBe("DISCONNECTED");
    expect(d.wifiState).toBe("DISCONNECTED");
    expect(d.sensorHealth.ina219).toBe("OFFLINE");
    expect(d.freeHeap).toBeNull();
  });

  it("mutations are rejected when mock disabled", async () => {
    const store = await import("@/lib/mockStore");
    expect(store.updateConfig({ batteryCapacityAh: 300 })).toBe(false);
  });
});
