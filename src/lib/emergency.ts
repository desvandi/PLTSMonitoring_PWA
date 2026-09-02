// =============================================================================
// lib/emergency.ts — Emergency relay control layer (PWA side, WAVE-7 contract)
// -----------------------------------------------------------------------------
// Mirrors Code.gs EMERGENCY_* actions and the firmware-generic v1.6.0 E-layer.
//
// SAFETY SEMANTICS (identical on all three tiers):
//   Relay ENERGIZED      = system RUN   (GPIO LOW on the active-LOW module)
//   Relay DE-ENERGIZED   = system ISOLATED (boot / crash / trip / E-stop)
//   ARM    = operator requests RUN     → device re-validates locally, may REJECT
//   DISARM = operator requests ISOLATE → always applied (safe direction)
//
// Auth model (operator-only, fail-closed):
//   EMERGENCY_COMMAND requires the Config-sheet ADMIN_TOKEN — the same
//   operator secret that gates OTA_PUBLISH. A device token can never ARM or
//   DISARM the fleet. The token is stored per-device in localStorage via
//   sysConfig (never baked into the build).
//
// PURE module (no React, no DOM) — vitest covers it in the node environment.
// =============================================================================

import type { DeviceProfile } from "@/lib/sysConfig";

// ---------------------------------------------------------------------------
// Trigger config schema — MUST equal Code.gs EMERGENCY_CONFIG_FIELDS and the
// firmware EmergencyConfig struct (field-for-field, range-for-range).
// ---------------------------------------------------------------------------

export interface EmergencyConfig {
  vbatLowV: number;
  vbatLowHystV: number;
  vbatHighV: number;
  vbatHighHystV: number;
  iDcOverA: number;
  iAcLoadOverA: number;
  iAcGenOverA: number;
  debounceN: number;
  recoverySec: number;
  relayPin: number;
  estopPin: number;
  estopEnabled: number;
}

/** [field, min, max, default] — the single schema shared by GAS + firmware. */
export const EMERGENCY_CONFIG_FIELDS: Array<{
  key: keyof EmergencyConfig;
  min: number;
  max: number;
  dflt: number;
}> = [
  { key: "vbatLowV", min: 30, max: 60, dflt: 42.0 },
  { key: "vbatLowHystV", min: 0.1, max: 5, dflt: 1.0 },
  { key: "vbatHighV", min: 48, max: 60, dflt: 55.0 },
  { key: "vbatHighHystV", min: 0.1, max: 5, dflt: 1.0 },
  { key: "iDcOverA", min: 10, max: 120, dflt: 110.0 },
  { key: "iAcLoadOverA", min: 5, max: 40, dflt: 28.0 },
  { key: "iAcGenOverA", min: 5, max: 40, dflt: 28.0 },
  { key: "debounceN", min: 1, max: 10, dflt: 3 },
  { key: "recoverySec", min: 0, max: 3600, dflt: 60 },
  { key: "relayPin", min: 12, max: 39, dflt: 27 },
  { key: "estopPin", min: -1, max: 39, dflt: 14 },
  { key: "estopEnabled", min: 0, max: 1, dflt: 1 },
];

export const DEFAULT_EMERGENCY_CONFIG: EmergencyConfig = EMERGENCY_CONFIG_FIELDS.reduce(
  (acc, f) => {
    acc[f.key] = f.dflt;
    return acc;
  },
  {} as EmergencyConfig,
);

/** Merge a partial config over the defaults, dropping unknown keys and
 *  clamping out-of-range values to the schema (client-side pre-validation;
 *  GAS re-validates, the device re-validates again — three locked gates). */
export function normalizeEmergencyConfig(
  raw: Partial<EmergencyConfig> | Record<string, number | undefined> | null | undefined,
): EmergencyConfig {
  const out: EmergencyConfig = { ...DEFAULT_EMERGENCY_CONFIG };
  if (!raw || typeof raw !== "object") return out;
  for (const f of EMERGENCY_CONFIG_FIELDS) {
    const v = (raw as Record<string, number | undefined>)[f.key];
    if (typeof v === "number" && Number.isFinite(v)) {
      out[f.key] = Math.min(Math.max(v, f.min), f.max);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Emergency state (from GAS LATEST — telemetry envelope v1.7)
// ---------------------------------------------------------------------------

export type EmergencyState = "RUN" | "EMERGENCY" | "UNKNOWN";

export interface EmergencySnapshot {
  state: EmergencyState;
  reason: string | null;
  estopLineOpen: boolean;
  tripCount: number | null;
}

export const UNKNOWN_EMERGENCY: EmergencySnapshot = {
  state: "UNKNOWN",
  reason: null,
  estopLineOpen: false,
  tripCount: null,
};

export function parseEmergencyBlock(raw: unknown): EmergencySnapshot {
  if (!raw || typeof raw !== "object") return UNKNOWN_EMERGENCY;
  const o = raw as Record<string, unknown>;
  const state = String(o.state ?? "").toUpperCase();
  return {
    state: state === "RUN" || state === "EMERGENCY" ? state : "UNKNOWN",
    reason: typeof o.reason === "string" && o.reason.length > 0 ? o.reason : null,
    estopLineOpen:
      o.estopLineOpen === true || String(o.estopLineOpen ?? "").toUpperCase() === "TRUE",
    tripCount: Number.isFinite(Number(o.tripCount)) ? Number(o.tripCount) : null,
  };
}

// ---------------------------------------------------------------------------
// GAS client (pure fetch wrapper — same shape as callGasAction elsewhere,
// extracted here so tests can mock global fetch)
// ---------------------------------------------------------------------------

export interface EmergencyCommandResult {
  ok: boolean;
  message: string;
  commandId?: string;
  queued?: boolean;
}

export interface EmergencyEventEntry {
  ts: string;
  type: string;
  reason: string;
  detail: string;
  stateAfter: string;
  source: string;
}

/** POST an EMERGENCY_COMMAND (ARM / DISARM / CONFIG) — operator-only. */
export async function sendEmergencyCommand(
  device: Pick<DeviceProfile, "gas_webapp_url" | "auth_token" | "admin_token" | "device_id">,
  command: "ARM" | "DISARM" | "CONFIG",
  opts: { note?: string; config?: EmergencyConfig } = {},
  timeoutMs = 12000,
): Promise<EmergencyCommandResult> {
  if (!device.admin_token) {
    return {
      ok: false,
      message:
        "ADMIN_TOKEN belum diisi — buka Settings, pilih perangkat, isi kolom Admin Token (rahasia operator dari Config sheet GAS).",
    };
  }
  const payload: Record<string, unknown> = {
    action: "EMERGENCY_COMMAND",
    token: device.auth_token,
    admin_token: device.admin_token,
    device_key: device.device_id,
    command,
  };
  if (opts.note) payload.note = opts.note.slice(0, 200);
  if (command === "CONFIG") payload.config = opts.config ?? DEFAULT_EMERGENCY_CONFIG;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(device.gas_webapp_url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
      signal: controller.signal,
      redirect: "follow",
    });
    clearTimeout(timer);
    if (!res.ok) return { ok: false, message: `HTTP ${res.status}` };
    const body = (await res.json().catch(() => null)) as {
      status?: string;
      message?: string;
      data?: { command_id?: string; status?: string } | null;
    } | null;
    if (!body) return { ok: false, message: "Respons GAS bukan JSON." };
    const ok = body.status === "SUCCESS";
    return {
      ok,
      message: body.message || (ok ? "OK" : "ERROR"),
      commandId: body.data?.command_id,
      queued: ok,
    };
  } catch (err) {
    clearTimeout(timer);
    return { ok: false, message: (err as Error).message };
  }
}

/** GET the recent emergency events for a device (operator UX). */
export async function fetchEmergencyLog(
  device: Pick<DeviceProfile, "gas_webapp_url" | "auth_token" | "device_id">,
  limit = 20,
  timeoutMs = 12000,
): Promise<{ ok: boolean; message: string; events: EmergencyEventEntry[] }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(device.gas_webapp_url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        action: "EMERGENCY_LOG",
        token: device.auth_token,
        device_key: device.device_id,
        limit,
      }),
      signal: controller.signal,
      redirect: "follow",
    } as RequestInit);
    clearTimeout(timer);
    if (!res.ok) return { ok: false, message: `HTTP ${res.status}`, events: [] };
    const body = (await res.json().catch(() => null)) as {
      status?: string;
      message?: string;
      data?: { events?: EmergencyEventEntry[] } | null;
    } | null;
    if (!body) return { ok: false, message: "Respons GAS bukan JSON.", events: [] };
    const ok = body.status === "SUCCESS";
    const events = Array.isArray(body.data?.events) ? body.data!.events! : [];
    return { ok, message: body.message || (ok ? "OK" : "ERROR"), events };
  } catch (err) {
    clearTimeout(timer);
    return { ok: false, message: (err as Error).message, events: [] };
  }
}
