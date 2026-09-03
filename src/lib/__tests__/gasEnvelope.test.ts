// =============================================================================
// gasEnvelope.test.ts — [W12] canonical GAS LATEST envelope parsing regression
// -----------------------------------------------------------------------------
// Locks the WAVE-12 cross-layer telemetry contract on the PWA side:
//   * emergency block: canonical names (state / reason / estopLineOpen /
//     tripCount) as emitted by GAS rowToEnvelope_ and (post-W12-1) by the
//     modular firmware serializer — plus the legacy flat fallback.
//   * PZEM meter block: ac.meter { connected, voltage, power } as emitted by
//     GAS LATEST after the [W12-2] ingest columns — honest nulls when the
//     meter is absent or disconnected (never a fabricated 0).
// PURE module tests (node environment, no DOM).
// =============================================================================
import { describe, expect, it } from "vitest";
import { parseLatestEnvelope } from "../gasEnvelope";

describe("parseLatestEnvelope — emergency block (W12-1 canonical names)", () => {
  it("parses nested state/reason/estopLineOpen/tripCount", () => {
    const t = parseLatestEnvelope({
      emergency: { state: "EMERGENCY", reason: "ESTOP", estopLineOpen: true, tripCount: 7 },
    });
    expect(t.emg_state).toBe("EMERGENCY");
    expect(t.emg_reason).toBe("ESTOP");
    expect(t.emg_estop).toBe(true);
    expect(t.emg_trips).toBe(7);
  });

  it("accepts the modular firmware REST/MQTT envelope (same canonical names)", () => {
    // Post-W12-1 the BatteryStatusSerializer emits the PWA SystemStatus
    // emergency names — the fleet parser must accept them verbatim.
    const t = parseLatestEnvelope({
      protocolVersion: 1,
      emergency: {
        state: "RUN",
        reason: "OPERATOR",
        estopLineOpen: false,
        tripCount: 2,
        relayEnergized: true,
        crashChain: 0,
      },
    });
    expect(t.emg_state).toBe("RUN");
    expect(t.emg_estop).toBe(false);
    expect(t.emg_trips).toBe(2);
  });

  it("legacy flat fallback still parses (pre-v1.7 rows)", () => {
    const t = parseLatestEnvelope({
      emg_state: "EMERGENCY",
      emg_reason: "VBAT_LOW",
      emg_estop: true,
      emg_trips: 3,
    });
    expect(t.emg_state).toBe("EMERGENCY");
    expect(t.emg_reason).toBe("VBAT_LOW");
    expect(t.emg_estop).toBe(true);
    expect(t.emg_trips).toBe(3);
  });

  it("string 'TRUE' estop from sheet round-trips as true", () => {
    const t = parseLatestEnvelope({
      emergency: { state: "EMERGENCY", estopLineOpen: "TRUE", tripCount: 1 },
    });
    expect(t.emg_estop).toBe(true);
  });

  it("absent emergency block → UNKNOWN / nulls (never a fabricated RUN)", () => {
    const t = parseLatestEnvelope({ battery: { voltage: { value: 51.2 } } });
    expect(t.emg_state).toBe("UNKNOWN");
    expect(t.emg_reason).toBeNull();
    expect(t.emg_estop).toBeNull();
    expect(t.emg_trips).toBeNull();
  });

  it("garbage state string → UNKNOWN", () => {
    const t = parseLatestEnvelope({ emergency: { state: "MAYBE" } });
    expect(t.emg_state).toBe("UNKNOWN");
  });
});

describe("parseLatestEnvelope — PZEM meter block (W12-2)", () => {
  it("parses nested ac.meter { connected, voltage, power }", () => {
    const t = parseLatestEnvelope({
      ac: {
        rmsCurrent: { value: 2.5 },
        meter: { connected: true, voltage: 219.8, power: 488.5 },
      },
    });
    expect(t.p_ac_meter).toBe(488.5);
    expect(t.meter_v).toBe(219.8);
    expect(t.meter_connected).toBe(true);
  });

  it("disconnected meter → nulls, never 0 (honest absence)", () => {
    const t = parseLatestEnvelope({
      ac: { meter: { connected: false, voltage: null, power: null } },
    });
    expect(t.p_ac_meter).toBeNull();
    expect(t.meter_v).toBeNull();
    expect(t.meter_connected).toBe(false);
  });

  it("absent meter block → all null (firmware without PLTS_ENABLE_PZEM_AC)", () => {
    const t = parseLatestEnvelope({ ac: { rmsCurrent: { value: 1.2 } } });
    expect(t.p_ac_meter).toBeNull();
    expect(t.meter_v).toBeNull();
    expect(t.meter_connected).toBeNull();
  });

  it("flat fallback columns (legacy backend) still parse", () => {
    const t = parseLatestEnvelope({
      p_ac_meter: 450,
      meter_v: 220,
      meter_connected: "TRUE",
    });
    expect(t.p_ac_meter).toBe(450);
    expect(t.meter_v).toBe(220);
    expect(t.meter_connected).toBe(true);
  });

  it("sheet string 'TRUE' connected round-trips as true", () => {
    const t = parseLatestEnvelope({
      ac: { meter: { connected: "TRUE", voltage: 215, power: 400 } },
    });
    expect(t.meter_connected).toBe(true);
    expect(t.p_ac_meter).toBe(400);
  });
});

describe("parseLatestEnvelope — genset channel (E-WAVE regression)", () => {
  it("nested gensetRmsCurrent + flat i_ac_gen both parse", () => {
    const nested = parseLatestEnvelope({
      ac: { gensetRmsCurrent: { value: 3.1 } },
    });
    const flat = parseLatestEnvelope({ i_ac_gen: 2.2 });
    expect(nested.i_ac_gen).toBe(3.1);
    expect(flat.i_ac_gen).toBe(2.2);
  });

  it("absent genset channel → null (modular RESERVED, honest)", () => {
    const t = parseLatestEnvelope({ ac: { rmsCurrent: { value: 0.5 } } });
    expect(t.i_ac_gen).toBeNull();
  });
});
