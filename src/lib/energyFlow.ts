// =============================================================================
// lib/energyFlow.ts — Animated energy-flow model (PURE logic, no DOM)
// -----------------------------------------------------------------------------
// Derives the edges of the PLTS energy-flow diagram from a telemetry snapshot.
// The VIEW renders this model as animated SVG; ALL direction/power decisions
// live here so vitest can pin them down.
//
// Nodes:  PV (PLTS array) · BATTERY (48V pack) · GENSET (jenset)
//         INVERTER (hybrid inverter/charger) · LOAD (beban utama 220VAC)
// Edges:  pv→battery, battery→inverter, genset→inverter, inverter→load
//
// HONESTY RULES (brief §91/§92 — "never fake PV metrics"):
//   - Battery power (V×I) is MEASURED on the DC side.
//   - AC load / genset power is ESTIMATED from ACS712 RMS × assumed 220 V.
//   - PV power is NOT measured (no PV sensor) → the PV node renders in
//     "inferred" mode with a visible marker; adding a PV sensor later upgrades
//     this automatically (pvPowerW is part of the input contract).
//   - Every edge whose measurement is null renders UNKNOWN — never 0.
// =============================================================================

export interface EnergyFlowInput {
  /** Battery power, W, signed: + charging, − discharging. NaN/null → unknown. */
  batteryPowerW: number | null;
  /** Battery current, A, signed: + charging. Used for direction when power is null. */
  batteryCurrentA: number | null;
  /** ACS712 #1 — inverter→load RMS current, A. */
  loadCurrentA: number | null;
  /** ACS712 #2 — genset→inverter RMS current, A (v1.6.0). */
  gensetCurrentA: number | null;
  /** Optional FUTURE input: measured PV power, W. */
  pvPowerW?: number | null;
  /** Nominal AC voltage for power estimation (default 220). */
  assumedAcVoltage?: number;
  /** Emergency relay state — ISOLATED opens the kontaktor path visually. */
  emergencyState?: "RUN" | "EMERGENCY" | "UNKNOWN";
}

export type FlowDirection = "forward" | "reverse" | "none" | "unknown";
export type FlowCertainty = "measured" | "estimated" | "inferred" | "unknown";

export interface FlowEdge {
  id: string;
  from: string;
  to: string;
  /** Magnitude in W (never negative; 0 = no flow). */
  powerW: number;
  direction: FlowDirection;
  certainty: FlowCertainty;
  /** true when the emergency relay has isolated the path. */
  blocked?: boolean;
}

export interface EnergyFlowModel {
  edges: FlowEdge[];
  nodes: Array<{
    id: string;
    active: boolean;
    /** Why the node is active/inactive — rendered as a tooltip. */
    note: "supplying" | "charging" | "discharging" | "idle" | "unknown" | "isolated";
  }>;
  /** Which source currently dominates the inverter input (honest inference). */
  inverterSource: "battery" | "genset" | "battery+genset" | "unknown";
  /** True when the emergency relay is ISOLATED — the whole diagram dims. */
  isolated: boolean;
  /** Annotation for the honest-data banner ("" when everything is measured). */
  dataCaveat: string;
}

const EPS_W = 25;        // below 25 W an edge is considered idle (noise floor)

export function computeEnergyFlow(input: EnergyFlowInput): EnergyFlowModel {
  const vac = input.assumedAcVoltage ?? 220;
  const isolated = input.emergencyState === "EMERGENCY";

  const batP =
    input.batteryPowerW != null && Number.isFinite(input.batteryPowerW)
      ? input.batteryPowerW
      : null;
  const batI =
    input.batteryCurrentA != null && Number.isFinite(input.batteryCurrentA)
      ? input.batteryCurrentA
      : null;
  // Battery sign convention (types.ts): + = CHARGING (into battery),
  // − = DISCHARGING (out to the inverter). Edge direction semantics:
  //   forward  = battery → inverter (discharging)
  //   reverse  = inverter → battery (charging)
  const batFlow: FlowDirection =
    batP != null
      ? batP < -EPS_W
        ? "forward"
        : batP > EPS_W
          ? "reverse"
          : "none"
      : batI != null
        ? batI < -0.5
          ? "forward"
          : batI > 0.5
            ? "reverse"
            : "none"
        : "unknown";

  const loadA =
    input.loadCurrentA != null && Number.isFinite(input.loadCurrentA) ? input.loadCurrentA : null;
  const genA =
    input.gensetCurrentA != null && Number.isFinite(input.gensetCurrentA)
      ? input.gensetCurrentA
      : null;

  const loadW = loadA != null ? loadA * vac : null;
  const genW = genA != null ? Math.abs(genA) * vac : null;

  // --- Genset → inverter (charging feed through the inverter's charger) ---
  const gensetEdge: FlowEdge = {
    id: "genset-inverter",
    from: "genset",
    to: "inverter",
    powerW: genW != null ? Math.round(genW) : 0,
    direction: genW != null ? (genW > EPS_W ? "forward" : "none") : "unknown",
    certainty: genA != null ? "estimated" : "unknown",
    blocked: isolated,
  };

  // --- Battery ↔ inverter (DC side: discharging feeds the inverter,
  //     charging is fed BY the inverter/charger) ---
  const batteryEdge: FlowEdge = {
    id: "battery-inverter",
    from: "battery",
    to: "inverter",
    powerW: batP != null ? Math.round(Math.abs(batP)) : 0,
    direction: batFlow,
    certainty: batP != null ? "measured" : batI != null ? "estimated" : "unknown",
    blocked: isolated,
  };

  // --- PV → battery (NOT measured; inferred only when the battery is
  //     charging WITHOUT genset contribution — the honest heuristic) ---
  const pvMeasured = input.pvPowerW != null && Number.isFinite(input.pvPowerW);
  const gensetCharging = (genW ?? 0) > EPS_W;
  const batteryCharging = batFlow === "reverse";
  const pvInferredActive = batteryCharging && !gensetCharging;
  const pvEdge: FlowEdge = {
    id: "pv-battery",
    from: "pv",
    to: "battery",
    powerW: pvMeasured
      ? Math.round(Math.max(0, input.pvPowerW as number))
      : pvInferredActive
        ? Math.round(Math.abs(batP ?? 0))
        : 0,
    direction: pvMeasured
      ? (input.pvPowerW as number) > EPS_W
        ? "forward"
        : "none"
      : pvInferredActive
        ? "forward"
        : "unknown",
    certainty: pvMeasured ? "measured" : pvInferredActive ? "inferred" : "unknown",
    blocked: isolated,
  };

  // --- Inverter → load ---
  const loadEdge: FlowEdge = {
    id: "inverter-load",
    from: "inverter",
    to: "load",
    powerW: loadW != null ? Math.round(loadW) : 0,
    direction: loadW != null ? (loadW > EPS_W ? "forward" : "none") : "unknown",
    certainty: loadA != null ? "estimated" : "unknown",
    blocked: isolated,
  };

  // --- Inverter source inference ---
  const genActive = (genW ?? 0) > EPS_W;
  const batDischarging = batFlow === "forward";
  let inverterSource: EnergyFlowModel["inverterSource"] = "unknown";
  if (genActive && batDischarging) inverterSource = "battery+genset";
  else if (genActive) inverterSource = "genset";
  else if (batDischarging) inverterSource = "battery";

  const nodes: EnergyFlowModel["nodes"] = [
    {
      id: "pv",
      active: pvEdge.direction === "forward",
      note: pvEdge.direction === "forward" ? "supplying" : "unknown",
    },
    {
      id: "battery",
      active: batteryCharging || batDischarging,
      note: isolated
        ? "isolated"
        : batteryCharging
          ? "charging"
          : batDischarging
            ? "discharging"
            : batI != null || batP != null
              ? "idle"
              : "unknown",
    },
    {
      id: "genset",
      active: genActive,
      note: genActive ? "supplying" : genA != null ? "idle" : "unknown",
    },
    {
      id: "inverter",
      active: genActive || batDischarging || (loadW ?? 0) > EPS_W,
      note: isolated ? "isolated" : inverterSource === "unknown" ? "unknown" : "supplying",
    },
    {
      id: "load",
      active: (loadW ?? 0) > EPS_W && !isolated,
      note: isolated ? "isolated" : (loadW ?? 0) > EPS_W ? "supplying" : "idle",
    },
  ];

  // --- Honest-data caveat (rendered under the diagram) ---
  const caveats: string[] = [];
  if (!pvMeasured) caveats.push("Daya PLTS/PV tidak terukur — status PV adalah inferensi (baterai mengisi tanpa jenset).");
  if (loadA != null || genA != null) caveats.push("Daya AC = estimasi (arus ACS712 × 220 V asumsi, PF tidak diukur).");
  if (loadA == null || genA == null) caveats.push("Sebagian kanal arus tidak tersedia.");
  if (batP == null && batI == null) caveats.push("Arus baterai tidak tersedia.");

  return {
    edges: [pvEdge, batteryEdge, gensetEdge, loadEdge],
    nodes,
    inverterSource,
    isolated,
    dataCaveat: isolated
      ? "SISTEM TERISOLASI — relay darurat terbuka; tidak ada aliran energi."
      : caveats.join(" "),
  };
}

/** Animation duration (seconds) for an edge — speed ∝ power (clamped). */
export function edgeAnimationSeconds(powerW: number, active: boolean): number | null {
  if (!active || powerW <= 0) return null;
  // 250 W → 3.0 s, 5000 W → 0.6 s (inverse mapping, clamped)
  const s = Math.max(0.6, Math.min(3.0, 750 / Math.max(1, powerW)));
  return Math.round(s * 10) / 10;
}
