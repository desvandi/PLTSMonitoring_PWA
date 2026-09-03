// =============================================================================
// API Client — backward-compatible façade over DeviceApiClient + BackendApiClient.
// [P1-2 AUDIT 2026-09] This file is preserved for backward compatibility with
// existing imports. New code SHOULD import from "@/lib/deviceApi" or
// "@/lib/backendApi" directly so the API authority (device vs. backend) is
// visible at the call site.
//
// Authoritative split:
//   - DeviceApi  (@/lib/deviceApi)  : primitives owned by the ESP32 device
//   - BackendApi (@/lib/backendApi) : aggregations owned by GAS/Next.js
//
// The façade below composes both. The split makes it impossible to
// accidentally call /api/reports on a direct-to-ESP32 connection (which
// would 404 — reports are server-side aggregations, not device primitives).
// =============================================================================

import type {
  ApiResponse,
  SystemStatus,
  SystemConfig,
  FirmwareInfo,
  ActivityLog,
  LogType,
  Alarm,
  SystemEvent,
  Diagnostics,
  Calibration,
  DeviceConfig,
  InsightsEnvelope,
  DailyEnergyRecord,
  ReportRequest,
  OtaHistoryEntry,
} from "@/lib/types";

// Re-export shared symbols so existing imports keep working.
export { API_BASE_URL, ApiError, setCsrfToken, getCsrfToken, generateRequestId } from "./apiShared";
import { API_BASE_URL, setCsrfToken, getCsrfToken, generateRequestId } from "./apiShared";
export { deviceApi } from "./deviceApi";
export { backendApi } from "./backendApi";
import { deviceApi } from "./deviceApi";
import { backendApi } from "./backendApi";

// Re-export client interfaces for type-only consumers.
export type { DeviceApiClient } from "./deviceApi";
export type { BackendApiClient } from "./backendApi";

/**
 * @deprecated since P1-2 (2026-09). Use `deviceApi` or `backendApi` directly.
 *
 * The combined `api` object is kept only so existing imports keep working.
 * New code MUST pick the appropriate client — mixing device + backend calls
 * through one object is exactly the ambiguity the audit flagged.
 */
export const api = {
  // ---------- Auth (lives on BOTH device and backend — same cookie session) ----------
  login: (username: string, password: string) =>
    deviceRequest<{ token: string; csrfToken: string; expiresAt: number; username: string }>(
      "/api/login",
      { method: "POST", body: { username, password }, skipCsrf: true },
    ),
  logout: () => deviceRequest<{ success: boolean }>("/api/logout", { method: "POST" }),
  session: () =>
    deviceRequest<{ isAuthenticated: boolean; username: string | null; expiresAt: number | null }>(
      "/api/session",
    ),

  // ---------- Status & version (device) ----------
  status:      () => deviceApi.status(),
  version:     () => deviceApi.version(),
  diagnostics: () => deviceApi.diagnostics(),

  // ---------- Config & calibration (device) ----------
  config:      () => deviceApi.config(),
  calibration: () => deviceApi.calibration(),
  updateConfig:           (cfg: Partial<DeviceConfig>)  => deviceApi.updateConfig(cfg),
  updateCalibration:      (cal: Partial<Calibration>)   => deviceApi.updateCalibration(cal),
  voltageCalibrationPoint: deviceApi.voltageCalibrationPoint,
  acs712ZeroCal:          () => deviceApi.acs712ZeroCal(),

  // ---------- Logs (device) ----------
  logs: deviceApi.logs,

  // ---------- Alarms (device) ----------
  alarms:            () => deviceApi.alarms(),
  acknowledgeAlarm:  deviceApi.acknowledgeAlarm,

  // ---------- Events (device) ----------
  events: deviceApi.events,

  // ---------- Reports (BACKEND — P1-4) ----------
  reports: (req: ReportRequest) => backendApi.reports(req),

  // ---------- AI insights (device — through ESP32 HMAC proxy) ----------
  insights: () => deviceApi.insights(),

  // ---------- OTA (device + backend split) ----------
  otaHistory: () => backendApi.otaHistory(),
  otaCheck:   () => backendApi.otaCheck(),
  otaUpload:  deviceApi.otaUpload,

  // ---------- System (device) ----------
  reboot:              () => deviceApi.reboot(),
  factoryResetPrepare: () => deviceApi.factoryResetPrepare(),
  factoryResetConfirm: deviceApi.factoryResetConfirm,

  // ---------- Device config ----------
  updateDevice:   deviceApi.updateDevice,
  changePassword: deviceApi.changePassword,
  exportConfig:   () => deviceApi.exportConfig(),
  importConfig:   (cfg: SystemConfig) => deviceApi.importConfig(cfg),
};

// Local helper — same as deviceApi's internal one, kept for the auth routes
// above (login/logout/session are on the device too, but were not moved to
// deviceApi because they sit at the boundary of where the session is set).
async function deviceRequest<T>(
  path: string,
  opts: {
    method?: "GET" | "POST" | "PUT" | "DELETE";
    body?: unknown;
    signal?: AbortSignal;
    skipCsrf?: boolean;
  } = {},
): Promise<T> {
  const url = `${API_BASE_URL}${path}`;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (opts.body !== undefined && !(opts.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }
  if (!opts.skipCsrf && opts.method && opts.method !== "GET") {
    const csrf = getCsrfToken();
    if (csrf) headers["X-CSRF-Token"] = csrf;
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? "GET",
      headers,
      body:
        opts.body instanceof FormData
          ? opts.body
          : opts.body !== undefined
            ? JSON.stringify(opts.body)
            : undefined,
      credentials: "include",
      signal: opts.signal,
      cache: "no-store",
    });
  } catch (err) {
    const { ApiError } = await import("./apiShared");
    throw new ApiError(
      err instanceof Error ? `Network error: ${err.message}` : "Network error",
      0,
    );
  }

  if (res.status === 204) return undefined as T;
  let json: ApiResponse<T> | null = null;
  try {
    json = (await res.json()) as ApiResponse<T>;
  } catch {
    const { ApiError } = await import("./apiShared");
    throw new ApiError(`Invalid JSON response (status ${res.status})`, res.status);
  }
  if (!res.ok || !json.success) {
    const { ApiError } = await import("./apiShared");
    const msg = json?.message || `Request failed (${res.status})`;
    throw new ApiError(msg, res.status);
  }
  return json.data;
}

// silence unused-import warning for symbols re-exported above
void setCsrfToken;
void generateRequestId;
