// =============================================================================
// GAS envelope parsing — canonical (v2+) nested shape + legacy flat fallback.
// -----------------------------------------------------------------------------
// [AUDIT 2026-08-28 F10] GAS LATEST returns the CANONICAL NESTED envelope
// (data.battery.voltage.value, data.battery.soc.value + provenance, …) — see
// code.gs rowToEnvelope_(). The fleet parser previously read FLAT fields
// (d.v_bat, d.soc_percent) which do not exist in that envelope, so every
// value parsed as null. The flat fallback is kept for any legacy backend
// that still returns the pre-v2 shape (defensive only — the GAS v2 adapter
// emits nested even for firmware-generic v1.4.0 rows).
//
// PURE module (no React, no DOM) so vitest can cover it in node environment.
// =============================================================================

export interface FleetTelemetry {
  v_bat: number | null;
  i_bat_dc: number | null;
  p_bat_dc: number | null;
  i_ac_load: number | null;
  // v1.7.0 [E-WAVE] — 2nd ACS712 (genset→inverter) + emergency relay state.
  i_ac_gen: number | null;
  emg_state: 'RUN' | 'EMERGENCY' | 'UNKNOWN';
  emg_reason: string | null;
  emg_estop: boolean | null;
  emg_trips: number | null;
  ina219_ok: string | null;
  soc_percent: number | null;
  // SOC provenance from the canonical GAS envelope — every surface that
  // shows SOC must also show WHERE it came from (BMS_DIRECT / SHUNT_COULOMB /
  // OCV_ESTIMATED / UNKNOWN). Null when the backend carries no provenance.
  soc_source: string | null;
  rssi: number | null;
  free_heap: number | null;
  fw_version: string | null;
  temp_celsius: number | null;
  timestamp: string | null;
  // legacy fields kept for backward-compat with older firmware
  i_bat?: number | null;
}

const asNum = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const asStr = (v: unknown): string | null =>
  typeof v === "string" && v.length > 0 ? v : null;

export function parseLatestEnvelope(data: unknown): FleetTelemetry {
  const d = (data ?? {}) as Record<string, unknown>;
  const batt = (d.battery ?? {}) as Record<string, unknown>;
  const battV = (batt.voltage ?? {}) as Record<string, unknown>;
  const battI = (batt.current ?? {}) as Record<string, unknown>;
  const battP = (batt.power ?? {}) as Record<string, unknown>;
  const soc = (batt.soc ?? {}) as Record<string, unknown>;
  const ac = (d.ac ?? {}) as Record<string, unknown>;
  const acI = (ac.rmsCurrent ?? {}) as Record<string, unknown>;
  const acGen = (ac.gensetRmsCurrent ?? {}) as Record<string, unknown>;
  const emg = (d.emergency ?? {}) as Record<string, unknown>;
  const env = (d.environment ?? {}) as Record<string, unknown>;
  const envT = (env.temperature ?? {}) as Record<string, unknown>;
  const health = (d.health ?? {}) as Record<string, unknown>;

  // v1.7.0 [E-WAVE] — emergency relay state (nested canonical; flat fallback
  // for pre-v1.7 GAS rows). UNKNOWN when absent — never a fabricated RUN.
  const emgStateRaw = String(emg.state ?? d.emg_state ?? "").toUpperCase();
  const emgState: FleetTelemetry["emg_state"] =
    emgStateRaw === "RUN" || emgStateRaw === "EMERGENCY" ? emgStateRaw : "UNKNOWN";

  return {
    // nested canonical (GAS v2+) first, flat legacy fallback second
    v_bat: asNum(battV.value ?? d.v_bat),
    i_bat_dc: asNum(battI.value ?? d.i_bat_dc ?? (d as { i_bat?: unknown }).i_bat),
    p_bat_dc: asNum(battP.value ?? d.p_bat_dc),
    i_ac_load: asNum(acI.value ?? d.i_ac_load),
    i_ac_gen: asNum(acGen.value ?? d.i_ac_gen),
    emg_state: emgState,
    emg_reason: asStr(emg.reason ?? d.emg_reason),
    emg_estop:
      emg.estopLineOpen != null
        ? emg.estopLineOpen === true || emg.estopLineOpen === "TRUE"
        : d.emg_estop != null
          ? d.emg_estop === true || d.emg_estop === "true" || d.emg_estop === "TRUE"
          : null,
    emg_trips: asNum(emg.tripCount ?? d.emg_trips),
    ina219_ok:
      health.ina219Online != null
        ? health.ina219Online === true || health.ina219Online === "TRUE"
          ? "true"
          : "false"
        : asStr(d.ina219_ok),
    soc_percent: asNum(soc.value ?? d.soc_percent),
    soc_source: asStr(soc.provenance),
    rssi: asNum(health.rssi ?? d.rssi),
    free_heap: asNum(health.freeHeap ?? d.free_heap),
    fw_version: asStr(health.firmwareVersion ?? d.fw_version),
    temp_celsius: asNum(envT.value ?? d.temp_celsius),
    timestamp: asStr(d.eventTime ?? d.timestamp),
  };
}
