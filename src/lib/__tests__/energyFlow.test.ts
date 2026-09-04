// =============================================================================
// energyFlow.test.ts — pins the energy-flow direction/power decisions.
// The SVG view only renders this model; every safety/honesty rule is tested
// HERE (never fake PV metrics, never fabricate unknown channels as 0 W).
// =============================================================================
import { describe, expect, it } from "vitest";
import {
  computeEnergyFlow,
  edgeAnimationSeconds,
  type EnergyFlowInput,
} from "@/lib/energyFlow";

const base: EnergyFlowInput = {
  batteryPowerW: null,
  batteryCurrentA: null,
  loadCurrentA: null,
  gensetCurrentA: null,
};

describe("computeEnergyFlow — honesty rules", () => {
  it("renders every edge UNKNOWN when nothing is measured (never 0 W flows)", () => {
    const m = computeEnergyFlow(base);
    for (const e of m.edges) {
      expect(e.certainty).toBe("unknown");
      expect(e.direction).toBe("unknown");
    }
    expect(m.inverterSource).toBe("unknown");
    expect(m.dataCaveat.length).toBeGreaterThan(0);
  });

  it("NEVER fakes PV: inferred only when battery charges WITHOUT genset", () => {
    // Battery charging 500 W, genset idle → PV inferred active.
    const m = computeEnergyFlow({ ...base, batteryPowerW: 500, gensetCurrentA: 0.1 });
    const pv = m.edges.find((e) => e.id === "pv-battery")!;
    expect(pv.certainty).toBe("inferred");
    expect(pv.direction).toBe("forward");
    expect(pv.powerW).toBe(500);
  });

  it("battery charging WITH genset active → PV NOT inferred (could be genset charging)", () => {
    const m = computeEnergyFlow({ ...base, batteryPowerW: 500, gensetCurrentA: 5 });
    const pv = m.edges.find((e) => e.id === "pv-battery")!;
    expect(pv.certainty).not.toBe("inferred");
    expect(pv.direction).toBe("unknown");   // honest: contribution unknowable
  });

  it("measured pvPowerW upgrades certainty and bypasses the heuristic", () => {
    const m = computeEnergyFlow({ ...base, batteryPowerW: -300, pvPowerW: 800 });
    const pv = m.edges.find((e) => e.id === "pv-battery")!;
    expect(pv.certainty).toBe("measured");
    expect(pv.powerW).toBe(800);
  });

  it("AC power is ESTIMATED from RMS × assumed voltage (default 220)", () => {
    const m = computeEnergyFlow({ ...base, loadCurrentA: 2, gensetCurrentA: 3 });
    const load = m.edges.find((e) => e.id === "inverter-load")!;
    const gen = m.edges.find((e) => e.id === "genset-inverter")!;
    expect(load.powerW).toBe(440);
    expect(load.certainty).toBe("estimated");
    expect(gen.powerW).toBe(660);
  });

  it("battery discharging feeds the inverter (forward), charging is reverse", () => {
    const dis = computeEnergyFlow({ ...base, batteryPowerW: -1200 });
    expect(dis.edges.find((e) => e.id === "battery-inverter")!.direction).toBe("forward");
    expect(dis.inverterSource).toBe("battery");
    const chg = computeEnergyFlow({ ...base, batteryPowerW: 900 });
    expect(chg.edges.find((e) => e.id === "battery-inverter")!.direction).toBe("reverse");
  });

  it("genset dominant → inverterSource genset; both → battery+genset", () => {
    const g = computeEnergyFlow({ ...base, gensetCurrentA: 6, batteryPowerW: -100 });
    expect(g.inverterSource).toBe("battery+genset");
    const gOnly = computeEnergyFlow({ ...base, gensetCurrentA: 6 });
    expect(gOnly.inverterSource).toBe("genset");
  });

  it("ISOLATED emergency state blocks every edge + dims the diagram", () => {
    const m = computeEnergyFlow({
      ...base,
      batteryPowerW: -1000,
      loadCurrentA: 4,
      emergencyState: "EMERGENCY",
    });
    expect(m.isolated).toBe(true);
    for (const e of m.edges) expect(e.blocked).toBe(true);
    expect(m.dataCaveat).toContain("TERISOLASI");
  });

  it("noise floor: tiny currents render idle edges (no jitter animation)", () => {
    const m = computeEnergyFlow({ ...base, batteryPowerW: 10, loadCurrentA: 0.1 });
    expect(m.edges.find((e) => e.id === "battery-inverter")!.direction).toBe("none");
    expect(m.edges.find((e) => e.id === "inverter-load")!.direction).toBe("none");
  });

  it("battery direction falls back to current sign when power is null (+ = charging = reverse)", () => {
    const charging = computeEnergyFlow({ ...base, batteryCurrentA: 8 });
    expect(charging.edges.find((e) => e.id === "battery-inverter")!.direction).toBe("reverse");
    const discharging = computeEnergyFlow({ ...base, batteryCurrentA: -8 });
    expect(discharging.edges.find((e) => e.id === "battery-inverter")!.direction).toBe("forward");
  });
});

describe("edgeAnimationSeconds — speed ∝ power", () => {
  it("returns null for inactive / zero-power edges (no animation)", () => {
    expect(edgeAnimationSeconds(0, true)).toBeNull();
    expect(edgeAnimationSeconds(500, false)).toBeNull();
  });
  it("clamps to [0.6, 3.0] seconds", () => {
    expect(edgeAnimationSeconds(5000, true)).toBe(0.6);
    expect(edgeAnimationSeconds(100, true)).toBe(3.0);
    expect(edgeAnimationSeconds(750, true)).toBe(1.0);
  });
});
