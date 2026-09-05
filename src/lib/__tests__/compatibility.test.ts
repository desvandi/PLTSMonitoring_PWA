// =============================================================================
// compatibility.test.ts — [P0 PWA-02 regression tests]
// Policy under test:
//   UNKNOWN / unreachable / unverified  →  canViewTelemetry = FALSE and
//   canControlRelays = FALSE (fail-closed). "UNKNOWN" must NEVER be reported
//   as a verified/compatible state.
// Plus the compatibility matrix: telemetry gate vs relay gate.
// =============================================================================
import { describe, expect, it } from "vitest";

import {
  evaluateCompatibility,
  unreachableCompatibilityStatus,
} from "@/lib/compatibility";

describe("evaluateCompatibility — fail-closed on unverified firmware (P0 PWA-02)", () => {
  it("firmware version unknown → telemetry BLOCKED, relay BLOCKED", () => {
    const st = evaluateCompatibility(null, null, null);
    expect(st.status).toBe("unknown");
    expect(st.canViewTelemetry).toBe(false);
    expect(st.canControlRelays).toBe(false);
  });

  it("firmware too old (0.9.x) → both gates blocked", () => {
    const st = evaluateCompatibility("0.9.0", 1, 1);
    expect(st.status).toBe("firmware_too_old");
    expect(st.canViewTelemetry).toBe(false);
    expect(st.canControlRelays).toBe(false);
  });

  it("protocol mismatch → both gates blocked", () => {
    const st = evaluateCompatibility("1.9.3", 2, 1);
    expect(st.status).toBe("protocol_mismatch");
    expect(st.canViewTelemetry).toBe(false);
    expect(st.canControlRelays).toBe(false);
  });

  it("config schema mismatch → both gates blocked", () => {
    const st = evaluateCompatibility("1.9.3", 1, 2);
    expect(st.status).toBe("config_schema_mismatch");
    expect(st.canViewTelemetry).toBe(false);
    expect(st.canControlRelays).toBe(false);
  });
});

describe("unreachableCompatibilityStatus — device unreachable (P0 PWA-02)", () => {
  it("REGRESSION: unreachable device → canViewTelemetry = FALSE (was true)", () => {
    const st = unreachableCompatibilityStatus();
    expect(st.status).toBe("unknown");
    // The exact P0 bug: this branch previously returned canViewTelemetry=true
    // while claiming "cannot verify firmware compatibility".
    expect(st.canViewTelemetry).toBe(false);
    expect(st.canControlRelays).toBe(false);
  });

  it("message states UNKNOWN / UNVERIFIED / BLOCKED explicitly", () => {
    const msg = unreachableCompatibilityStatus().message;
    expect(msg).toContain("UNKNOWN");
    expect(msg).toContain("UNVERIFIED");
    expect(msg).toContain("BLOCKED");
  });
});

describe("compatibility matrix — telemetry gate vs relay gate", () => {
  it("firmware 1.7.5 (telemetry-compatible, pre-relay) → telemetry OK, relay BLOCKED", () => {
    const st = evaluateCompatibility("1.7.5", 1, 1);
    expect(st.status).toBe("compatible");
    expect(st.canViewTelemetry).toBe(true);
    expect(st.canControlRelays).toBe(false);
  });

  it("firmware 1.8.0 (first relay release) → both gates open", () => {
    const st = evaluateCompatibility("1.8.0", 1, 1);
    expect(st.status).toBe("compatible");
    expect(st.canViewTelemetry).toBe(true);
    expect(st.canControlRelays).toBe(true);
  });

  it("firmware 1.9.3 (current candidate) → both gates open", () => {
    const st = evaluateCompatibility("1.9.3", 1, 1);
    expect(st.status).toBe("compatible");
    expect(st.canViewTelemetry).toBe(true);
    expect(st.canControlRelays).toBe(true);
  });
});
