// =============================================================================
// compatibility.test.ts — [P0 PWA-02 regression tests]
// Policy under test:
//   UNKNOWN / unreachable / unverified  →  canViewTelemetry = FALSE and
//   canControlRelays = FALSE (fail-closed). "UNKNOWN" must NEVER be reported
//   as a verified/compatible state.
// Plus the compatibility matrix: telemetry gate vs relay gate.
// [AUDIT p.477/p.478 REMEDIATION 2026-09] Malformed-version and
// null-protocol/schema fail-closed regressions + cross-layer normalization.
// =============================================================================
import { describe, expect, it } from "vitest";

import {
  evaluateCompatibility,
  unreachableCompatibilityStatus,
  normalizeFirmwareInfo,
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

// =============================================================================
// [AUDIT p.477 REMEDIATION 2026-09] Malformed firmware version → fail-closed.
// The old compareVersions() returned 0 ("equal") when parse failed, letting
// garbage versions pass the range check and reach "compatible".
// =============================================================================
describe("p.477 — malformed firmware version fails closed", () => {
  const malformed = ["not-a-version", "", "1.9.x", "abc.1.2", "9", "1..3", "@@@", "null"];

  it.each(malformed)("malformed version %j → status unknown, BOTH gates blocked", (v) => {
    const st = evaluateCompatibility(v, 1, 1);
    expect(st.status).toBe("unknown");
    expect(st.canViewTelemetry).toBe(false);
    expect(st.canControlRelays).toBe(false);
    expect(st.message).toMatch(/missing or malformed/i);
  });

  it("REGRESSION: malformed version can never reach a range comparison (was compared 'equal')", () => {
    // A garbage version ABOVE the max boundary, or below the min, previously
    // slipped through compareVersions() === 0; now it must be rejected
    // outright as UNKNOWN before any comparison.
    const st = evaluateCompatibility("999999.garbage", 1, 1);
    expect(st.status).toBe("unknown");
  });
});

// =============================================================================
// [AUDIT p.478 REMEDIATION 2026-09] protocolVersion/configSchemaVersion null
// means "contract NOT verified" — never "compatible".
// =============================================================================
describe("p.478 — null protocol/config schema is NOT compatible", () => {
  it("null protocolVersion on a valid version → protocol_mismatch, BOTH gates blocked", () => {
    const st = evaluateCompatibility("1.9.3", null, 1);
    expect(st.status).toBe("protocol_mismatch");
    expect(st.canViewTelemetry).toBe(false);
    expect(st.canControlRelays).toBe(false);
    expect(st.message).toMatch(/not reported/i);
  });

  it("null configSchemaVersion on a valid version → config_schema_mismatch, BOTH gates blocked", () => {
    const st = evaluateCompatibility("1.9.3", 1, null);
    expect(st.status).toBe("config_schema_mismatch");
    expect(st.canViewTelemetry).toBe(false);
    expect(st.canControlRelays).toBe(false);
  });

  it("undefined (missing fields) is treated exactly like null — fail-closed", () => {
    const st = evaluateCompatibility("1.9.3", undefined, undefined);
    expect(st.status).toBe("protocol_mismatch");
    expect(st.canViewTelemetry).toBe(false);
    expect(st.canControlRelays).toBe(false);
  });

  it("unparseable protocol value ('garbage') is also unverified → fail-closed", () => {
    const st = evaluateCompatibility("1.9.3", "garbage", 1);
    expect(st.status).toBe("protocol_mismatch");
    expect(st.canViewTelemetry).toBe(false);
    expect(st.canControlRelays).toBe(false);
  });
});

// =============================================================================
// [CROSS-LAYER CONTRACT] The ESP32 /api/version response (ArduinoJson) uses
// the keys firmwareVersion/configVersion with STRING values; the PWA mock
// uses currentVersion/configSchemaVersion with numbers. Both must evaluate.
// =============================================================================
describe("cross-layer — firmware string serialization + key mapping", () => {
  it("string '1'/'1' (ArduinoJson) is coerced and accepted as compatible", () => {
    const st = evaluateCompatibility("1.9.3", "1", "1");
    expect(st.status).toBe("compatible");
    expect(st.protocolVersion).toBe(1);
    expect(st.configSchemaVersion).toBe(1);
    expect(st.canViewTelemetry).toBe(true);
    expect(st.canControlRelays).toBe(true);
  });

  it("string '2' protocol (future firmware) → protocol_mismatch", () => {
    const st = evaluateCompatibility("1.9.3", "2", "1");
    expect(st.status).toBe("protocol_mismatch");
  });

  it("normalizeFirmwareInfo maps the REAL device shape (firmwareVersion/configVersion, strings)", () => {
    const info = normalizeFirmwareInfo({
      firmwareVersion: "1.9.3",
      protocolVersion: "1",
      configVersion: "1",
      calibrationVersion: "1",
      buildDate: "2026-09-01",
      buildProfile: "PRODUCTION",
    });
    expect(info.currentVersion).toBe("1.9.3");
    expect(info.protocolVersion).toBe(1);
    expect(info.configSchemaVersion).toBe(1);
  });

  it("normalizeFirmwareInfo keeps the MOCK shape (currentVersion/configSchemaVersion, numbers)", () => {
    const info = normalizeFirmwareInfo({
      currentVersion: "1.9.3",
      protocolVersion: 1,
      configSchemaVersion: 1,
    });
    expect(info.currentVersion).toBe("1.9.3");
    expect(info.protocolVersion).toBe(1);
    expect(info.configSchemaVersion).toBe(1);
  });

  it("normalizeFirmwareInfo fails closed on absent/garbage fields (empty version, null protocol)", () => {
    const info = normalizeFirmwareInfo({ buildDate: "2026-09-01" });
    expect(info.currentVersion).toBe("");
    expect(info.protocolVersion).toBeNull();
    expect(info.configSchemaVersion).toBeNull();
    // And the gate treats that exactly as fail-closed:
    const st = evaluateCompatibility(info.currentVersion || null, info.protocolVersion, info.configSchemaVersion);
    expect(st.status).toBe("unknown");
    expect(st.canViewTelemetry).toBe(false);
    expect(st.canControlRelays).toBe(false);
  });
});
