// =============================================================================
// gasParity.test.ts — [PARITY-3 2026-09-06] cross-layer parity regression
// -----------------------------------------------------------------------------
// Locks the PWA side of the parity wave on the GAS backend (see the
// firmware repo's scripts/test_gas_parity_insights.js for the server side):
//   * mapGasDailyDays — GAS DAILY rows → DailyEnergyRecord (honest optionals,
//     computed netWh, forwarded energyQuality, no fabricated fields)
//   * parseGasInsightsEnvelope — GAS INSIGHTS resp envelope → InsightsEnvelope
//     (unwrap resp_.data, normalize generatedAt to ms epoch, surface honest
//     failures as thrown errors, never a mock)
// PURE module tests (node environment, no DOM — same convention as
// gasEnvelope.test.ts).
// =============================================================================
import { describe, expect, it } from "vitest";
import { mapGasDailyDays, parseGasInsightsEnvelope } from "../gasEnvelope";

describe("mapGasDailyDays — GAS DAILY → DailyEnergyRecord", () => {
  it("maps a full day row with peaks + energy quality", () => {
    const recs = mapGasDailyDays([
      {
        date: "2026-09-05",
        chargeWh: 1200.5,
        dischargeWh: 3400.25,
        chargeAh: 24.1,
        dischargeAh: 68.2,
        peakChargeA: 5.4,
        peakDischargeA: 3.2,
        socMin: 40,
        socMax: 95,
        samples: 24,
        completeness: 1,
        energyQuality: "VALID",
      },
    ]);
    expect(recs).toHaveLength(1);
    const r = recs[0];
    expect(r.date).toBe("2026-09-05");
    expect(r.netWh).toBeCloseTo(1200.5 - 3400.25, 6);   // computed, not emitted
    expect(r.peakChargeA).toBe(5.4);
    expect(r.peakDischargeA).toBe(3.2);
    expect(r.socMin).toBe(40);
    expect(r.energyQuality).toBe("VALID");
    expect(r.telemetryCompleteness).toBe(1);
    // alarmCount / deviceAvailability are NOT derivable server-side — the
    // mapper must leave them undefined (rendered as '—'), never fabricate.
    expect(r.alarmCount).toBeUndefined();
    expect(r.deviceAvailability).toBeUndefined();
  });

  it("carries the COUNTER_RESET verdict (honest quality flags)", () => {
    const recs = mapGasDailyDays([
      { date: "2026-09-04", chargeWh: 100, dischargeWh: 200, completeness: 0.5, energyQuality: "COUNTER_RESET" },
    ]);
    expect(recs[0].energyQuality).toBe("COUNTER_RESET");
  });

  it("null peaks stay null (no positive/negative samples)", () => {
    const recs = mapGasDailyDays([
      { date: "2026-09-03", chargeWh: 10, dischargeWh: 0, peakChargeA: null, peakDischargeA: null },
    ]);
    expect(recs[0].peakChargeA).toBeNull();
    expect(recs[0].peakDischargeA).toBeNull();
  });

  it("skips rows without any energy counters (honest no-data days)", () => {
    const recs = mapGasDailyDays([
      { date: "2026-09-02", chargeWh: null, dischargeWh: null },
      { date: "2026-09-01", chargeWh: 5, dischargeWh: 5 },
    ]);
    expect(recs).toHaveLength(1);
    expect(recs[0].date).toBe("2026-09-01");
  });

  it("rejects non-array / garbage input without throwing", () => {
    expect(mapGasDailyDays(null)).toEqual([]);
    expect(mapGasDailyDays("nope")).toEqual([]);
    expect(mapGasDailyDays([null, 42, "x"])).toEqual([]);
  });

  it("unknown energyQuality values are dropped (not guessed)", () => {
    const recs = mapGasDailyDays([
      { date: "2026-08-31", chargeWh: 1, dischargeWh: 1, energyQuality: "SOMETHING_ELSE" },
    ]);
    expect(recs[0].energyQuality).toBeUndefined();
  });
});

describe("parseGasInsightsEnvelope — GAS INSIGHTS → InsightsEnvelope", () => {
  const gasBody = {
    status: "SUCCESS",
    code: 200,
    message: "AI insights",
    data: {
      success: true,
      cached: false,
      generatedAt: "2026-09-06T01:30:00.000Z",
      insights: [
        {
          id: "gas-1-0",
          category: "battery_analysis",
          severity: "info",
          title: "Steady discharge",
          body: "Current held around -3.2 A.",
          generatedAt: "2026-09-06T01:30:00.000Z",
          source: "gemini",
          advisoryOnly: true,
        },
      ],
    },
  };

  it("unwraps resp_.data and normalizes generatedAt to ms epoch", () => {
    const env = parseGasInsightsEnvelope(gasBody);
    expect(env.success).toBe(true);
    expect(env.cached).toBe(false);
    expect(env.mock).toBe(false);
    expect(env.generatedAt).toBe("2026-09-06T01:30:00.000Z");
    expect(env.insights).toHaveLength(1);
    expect(typeof env.insights![0].generatedAt).toBe("number");
    expect(env.insights![0].generatedAt).toBe(Date.parse("2026-09-06T01:30:00.000Z"));
  });

  it("marks cache hits (cached:true replay)", () => {
    const env = parseGasInsightsEnvelope({
      ...gasBody,
      data: { ...gasBody.data, cached: true },
    });
    expect(env.cached).toBe(true);
  });

  it("throws with the honest GAS message on a fail-closed error envelope", () => {
    expect(() =>
      parseGasInsightsEnvelope({
        status: "ERROR",
        code: 503,
        message: "AI insights unavailable: GEMINI_API_KEY not configured",
        data: null,
      }),
    ).toThrowError(/GEMINI_API_KEY/);
  });

  it("throws when data.success === false (honest backend failure, never a mock)", () => {
    expect(() =>
      parseGasInsightsEnvelope({
        status: "SUCCESS",
        code: 200,
        data: { success: false, error: "NO_TELEMETRY", message: "no rows" },
      }),
    ).toThrowError(/no rows/);
  });

  it("throws on a malformed body (status missing)", () => {
    expect(() => parseGasInsightsEnvelope(null)).toThrow();
    expect(() => parseGasInsightsEnvelope({ data: {} })).toThrow();
  });

  it("empty insights array is preserved (not turned into an error)", () => {
    const env = parseGasInsightsEnvelope({
      status: "SUCCESS",
      data: { success: true, insights: [] },
    });
    expect(env.insights).toEqual([]);
  });
});
