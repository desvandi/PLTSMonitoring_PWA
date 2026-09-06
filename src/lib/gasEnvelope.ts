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
  // v1.7.0 [W12-2] — PZEM-004T real AC meter (GAS LATEST ac.meter block:
  // connected/power/voltage). null = no meter or not connected — the
  // estimate above stays the headline, never a fabricated reading.
  p_ac_meter: number | null;
  meter_v: number | null;
  meter_connected: boolean | null;
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
  const meter = (ac.meter ?? {}) as Record<string, unknown>;
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
    // v1.7.0 [W12-2] — PZEM meter trio (nested GAS LATEST; flat fallback for
    // a hypothetical legacy backend that stores the raw columns).
    p_ac_meter: asNum(meter.power ?? d.p_ac_meter),
    meter_v: asNum(meter.voltage ?? d.meter_v),
    meter_connected:
      meter.connected != null
        ? meter.connected === true || meter.connected === "TRUE"
        : d.meter_connected != null
          ? d.meter_connected === true || d.meter_connected === "TRUE"
          : null,
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

// =============================================================================
// [PARITY-3 2026-09-06] GAS INSIGHTS + DAILY clients.
// -----------------------------------------------------------------------------
// Two actions the backend gained in the same parity wave:
//   INSIGHTS — advisory AI insights per device (Gemini, server-side cache,
//             fail-closed honest errors; NEVER a mock). Called directly by
//             the PWA (browser → GAS, same transport as LATEST) when the
//             device path (/api/insights via the ESP32 HMAC proxy) is
//             unavailable — e.g. cloud-only deployments with no LAN route.
//   DAILY    — daily energy aggregation the PWA Reports view previously
//             NEVER called (the GAS action existed since WAVE-4 while the
//             Reports view could only serve the demo mock or the device's
//             honest 501). This is the missing three-layer wiring.
// Parse functions are PURE (vitest-coverable in node env); the fetch
// wrappers are thin and follow the useFleetStatus transport conventions.
// =============================================================================

import type { AiInsight, DailyEnergyRecord, InsightsEnvelope } from "./types";

/** GAS DAILY day row (subset the backend actually emits — see dailyReport_). */
interface GasDailyDay {
  date?: unknown;
  chargeWh?: unknown;
  dischargeWh?: unknown;
  chargeAh?: unknown;
  dischargeAh?: unknown;
  peakChargeA?: unknown;
  peakDischargeA?: unknown;
  socMin?: unknown;
  socMax?: unknown;
  samples?: unknown;
  completeness?: unknown;
  energyQuality?: unknown;
}

const gasNum = (v: unknown): number | null => {
  const n = asNum(v);
  return n;
};

/**
 * Map GAS DAILY `days` rows to the PWA DailyEnergyRecord contract.
 * HONESTY RULES (mirrors the backend's — never fabricate):
 *   - netWh is COMPUTED here (chargeWh - dischargeWh) — GAS does not emit it.
 *   - alarmCount / deviceAvailability are NOT mapped: the backend cannot
 *     derive them (alarms are device-local; availability would duplicate
 *     completeness). They stay undefined and render as '—'.
 *   - energyQuality is forwarded so COUNTER_RESET days are visible.
 */
export function mapGasDailyDays(days: unknown): DailyEnergyRecord[] {
  if (!Array.isArray(days)) return [];
  const out: DailyEnergyRecord[] = [];
  for (const raw of days) {
    if (!raw || typeof raw !== "object") continue;
    const d = raw as GasDailyDay;
    const chargeWh = gasNum(d.chargeWh);
    const dischargeWh = gasNum(d.dischargeWh);
    if (chargeWh === null && dischargeWh === null) continue;   // no energy row
    const eq = typeof d.energyQuality === "string"
      && ["NO_DATA", "COUNTER_RESET", "VALID", "PARTIAL"].includes(d.energyQuality)
      ? (d.energyQuality as DailyEnergyRecord["energyQuality"])
      : undefined;
    out.push({
      date: typeof d.date === "string" ? d.date : "",
      chargeWh: chargeWh ?? 0,
      dischargeWh: dischargeWh ?? 0,
      netWh: (chargeWh ?? 0) - (dischargeWh ?? 0),
      chargeAh: gasNum(d.chargeAh) ?? 0,
      dischargeAh: gasNum(d.dischargeAh) ?? 0,
      peakChargeA: gasNum(d.peakChargeA),
      peakDischargeA: gasNum(d.peakDischargeA),
      socMin: gasNum(d.socMin),
      socMax: gasNum(d.socMax),
      telemetryCompleteness: gasNum(d.completeness) ?? 0,
      energyQuality: eq,
    });
  }
  return out;
}

/** GAS daily report result: days array or a thrown error with the reason. */
export async function fetchGasDailyReport(
  gasUrl: string,
  token: string,
  deviceKey: string,
  days: number,
  timeoutMs = 15000,
): Promise<DailyEnergyRecord[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(gasUrl, {
      method: "POST",
      body: JSON.stringify({ action: "DAILY", token, device_key: deviceKey, days }),
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      signal: controller.signal,
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`GAS DAILY: HTTP ${res.status}`);
    const json = (await res.json().catch(() => null)) as
      | { status?: string; message?: string; data?: { days?: unknown } }
      | null;
    if (!json || json.status !== "SUCCESS" || !json.data) {
      throw new Error(`GAS DAILY: ${json?.message ?? "ERROR"}`);
    }
    const records = mapGasDailyDays(json.data.days);
    if (!records.length) throw new Error("GAS DAILY: no aggregated days returned");
    return records;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Parse a GAS INSIGHTS response body into the PWA InsightsEnvelope contract.
 * GAS wraps the payload as {status, code, data:{success, insights, ...}} —
 * SUCCESS returns the inner envelope; anything else throws with the honest
 * GAS message (GEMINI_API_KEY_NOT_CONFIGURED / NO_TELEMETRY / ...).
 */
export function parseGasInsightsEnvelope(raw: unknown): InsightsEnvelope {
  const body = raw as { status?: string; code?: number; message?: string; data?: unknown } | null;
  if (!body || typeof body !== "object" || body.status !== "SUCCESS" || !body.data) {
    const msg = body?.message ?? "GAS INSIGHTS: invalid response";
    throw new Error(msg);
  }
  const inner = body.data as Partial<InsightsEnvelope> & { generatedAt?: unknown };
  if (inner.success === false) {
    // Honest backend failure (fail-closed key / Gemini error) — surface it.
    throw new Error(inner.message ?? inner.error ?? "GAS INSIGHTS: unavailable");
  }
  // Normalize insights: GAS emits generatedAt as an ISO STRING; the PWA
  // AiInsight contract uses a ms-epoch NUMBER (same as the mock source).
  const insights: AiInsight[] = (Array.isArray(inner.insights) ? inner.insights : [])
    .map((i) => ({
      ...i,
      generatedAt: typeof i.generatedAt === "string"
        ? (Date.parse(i.generatedAt) || Date.now())
        : (i.generatedAt ?? Date.now()),
    }));
  return {
    success: true,
    insights,
    cached: inner.cached === true,
    mock: false,
    generatedAt: typeof inner.generatedAt === "string" ? inner.generatedAt : undefined,
  };
}

/** Fetch INSIGHTS directly from GAS (browser → GAS, token + device_key). */
export async function fetchGasInsights(
  gasUrl: string,
  token: string,
  deviceKey: string,
  timeoutMs = 20000,
): Promise<InsightsEnvelope> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(gasUrl, {
      method: "POST",
      body: JSON.stringify({ action: "INSIGHTS", token, device_key: deviceKey }),
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      signal: controller.signal,
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`GAS INSIGHTS: HTTP ${res.status}`);
    const json = await res.json().catch(() => null);
    return parseGasInsightsEnvelope(json);
  } finally {
    clearTimeout(timer);
  }
}
