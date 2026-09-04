// =============================================================================
// config-shape.ts — dual-shape GET /api/config normalization (audit 2026-08-27)
// -----------------------------------------------------------------------------
// The PWA has TWO legitimate /api/config backends:
//   1. PRODUCTION: the ESP32 firmware itself (via Cloudflare Tunnel,
//      NEXT_PUBLIC_API_BASE_URL) — returns the device config FLAT
//      (siteName/deviceName/timezone/thresholds/bms* at the top level).
//   2. DEMO / same-origin Next routes (mockStore) — returns the payload
//      nested inside SystemConfig (`{ deviceName, siteName, timezone,
//      config: DeviceConfig, calibration }`).
// Historically every consumer papered over this with `(x as any)?.data || x`,
// which (a) never actually matched either shape (there is no `.data` wrapper)
// and (b) hid a real bug: BmsCommPanel showed "Firmware < 1.6.0" forever in
// demo mode. This helper discriminates STRUCTURALLY — no `any`, both shapes
// supported, fields resolved honestly.
// =============================================================================

import type { DeviceConfig, SystemConfig } from "./types";

export type ConfigPayload = SystemConfig | DeviceConfig | undefined | null;

/**
 * Normalize either /api/config shape into a flat Partial<DeviceConfig>.
 * Nested SystemConfig: the nested `config` object wins, overlaid with the
 * top-level identity fields when present. Flat firmware shape: returned as-is.
 */
export function deviceConfigOf(raw: ConfigPayload): Partial<DeviceConfig> {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  if (r.config && typeof r.config === "object") {
    const nested = r.config as Partial<DeviceConfig>;
    const merged: Partial<DeviceConfig> = { ...nested };
    if (typeof r.deviceName === "string") merged.deviceName = r.deviceName;
    if (typeof r.siteName === "string") merged.siteName = r.siteName;
    if (typeof r.timezone === "string") merged.timezone = r.timezone;
    return merged;
  }
  return raw as Partial<DeviceConfig>;
}
