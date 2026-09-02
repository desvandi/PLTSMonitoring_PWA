// =============================================================================
// API Client — calls ESP32 firmware v1.0 REST API contract (LAN mode).
// -----------------------------------------------------------------------------
// In production: NEXT_PUBLIC_API_BASE_URL points to the Cloudflare Tunnel URL
//   (e.g., https://plts.example.com) which routes to the ESP32.
// In demo/mock mode: BASE_URL is empty so all calls go to the relative
//   /api/* Next.js route handlers in this project.
//
// MONITORING-ONLY — no relay/PIR/schedule mutations. Only:
//   - Read methods (status, config, calibration, logs, alarms, events, diagnostics, version)
//   - Configuration mutations (config, calibration, voltage 3-point, ACS712 zero)
//   - System mutations (ack alarm, reboot, factory reset, OTA)
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
import { getCompatibilitySnapshot, IncompatibleFirmwareError } from "./compatibility";

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}

// CSRF token cache (per session)
let csrfTokenCache: string | null = null;

export function setCsrfToken(token: string | null) {
  csrfTokenCache = token;
}

export function getCsrfToken(): string | null {
  return csrfTokenCache;
}

/**
 * Generate a requestId for REST mutations.
 * Uses crypto.randomUUID() — CSPRNG. Firmware validateRequestId() accepts
 * 1-64 chars of [a-zA-Z0-9-_]; UUID v4 (36 chars, hex+hyphens) is valid.
 */
function generateRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback for older runtimes — still CSPRNG-based.
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  arr[6] = (arr[6]! & 0x0f) | 0x40;
  arr[8] = (arr[8]! & 0x3f) | 0x80;
  const hex = Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function request<T>(
  path: string,
  opts: {
    method?: "GET" | "POST" | "PUT" | "DELETE";
    body?: unknown;
    signal?: AbortSignal;
    skipCsrf?: boolean;
  } = {},
): Promise<T> {
  const url = `${API_BASE_URL}${path}`;
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (opts.body !== undefined && !(opts.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }
  if (!opts.skipCsrf && opts.method && opts.method !== "GET" && csrfTokenCache) {
    headers["X-CSRF-Token"] = csrfTokenCache;
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
    throw new ApiError(
      err instanceof Error ? `Network error: ${err.message}` : "Network error",
      0,
    );
  }

  // Handle 204 No Content (no body to parse)
  if (res.status === 204) {
    return undefined as T;
  }

  let json: ApiResponse<T> | null = null;
  try {
    json = (await res.json()) as ApiResponse<T>;
  } catch {
    throw new ApiError(`Invalid JSON response (status ${res.status})`, res.status);
  }

  if (!res.ok || !json.success) {
    const msg = json?.message || `Request failed (${res.status})`;
    throw new ApiError(msg, res.status);
  }
  return json.data;
}

export const api = {
  // ---------- Auth ----------
  login: (username: string, password: string) =>
    request<{ token: string; csrfToken: string; expiresAt: number; username: string }>(
      "/api/login",
      { method: "POST", body: { username, password }, skipCsrf: true },
    ),
  logout: () => request<{ success: boolean }>("/api/logout", { method: "POST" }),
  session: () =>
    request<{ isAuthenticated: boolean; username: string | null; expiresAt: number | null }>(
      "/api/session",
    ),

  // ---------- Status & version ----------
  status: () => request<SystemStatus>("/api/status"),
  version: () => request<FirmwareInfo>("/api/version"),
  diagnostics: () => request<Diagnostics>("/api/diagnostics"),

  // ---------- Config & calibration ----------
  config: () => request<SystemConfig>("/api/config"),
  calibration: () => request<Calibration>("/api/calibration"),

  // Mutations — all REST mutations send requestId for transaction journal (firmware C2-C5)
  updateConfig: (cfg: Partial<DeviceConfig>) => {
    const compat = getCompatibilitySnapshot();
    if (compat && !compat.canViewTelemetry) throw new IncompatibleFirmwareError(compat.message);
    return request<{ updated: boolean }>("/api/config", {
      method: "POST",
      body: { ...cfg, requestId: generateRequestId() },
    });
  },
  updateCalibration: (cal: Partial<Calibration>) => {
    const compat = getCompatibilitySnapshot();
    if (compat && !compat.canViewTelemetry) throw new IncompatibleFirmwareError(compat.message);
    return request<{ updated: boolean }>("/api/calibration", {
      method: "POST",
      body: { ...cal, requestId: generateRequestId() },
    });
  },
  voltageCalibrationPoint: (
    point: "low" | "nominal" | "full",
    reference: number,
    raw: number,
  ) => {
    const compat = getCompatibilitySnapshot();
    if (compat && !compat.canViewTelemetry) throw new IncompatibleFirmwareError(compat.message);
    return request<{ updated: boolean }>(`/api/calibration/voltage/point/${point}`, {
      method: "POST",
      body: { reference, raw, requestId: generateRequestId() },
    });
  },
  acs712ZeroCal: () => {
    const compat = getCompatibilitySnapshot();
    if (compat && !compat.canViewTelemetry) throw new IncompatibleFirmwareError(compat.message);
    return request<{ updated: boolean; newOffset: number }>(
      "/api/calibration/acs712/zero",
      { method: "POST", body: { requestId: generateRequestId() } },
    );
  },

  // ---------- Logs ----------
  logs: (filter?: { type?: LogType | "all"; limit?: number; since?: number }) => {
    const params = new URLSearchParams();
    if (filter?.type && filter.type !== "all") params.set("type", filter.type);
    if (filter?.limit) params.set("limit", String(filter.limit));
    if (filter?.since) params.set("since", String(filter.since));
    const q = params.toString();
    return request<{ logs: ActivityLog[]; total: number }>(`/api/log${q ? `?${q}` : ""}`);
  },

  // ---------- Alarms ----------
  alarms: () => request<{ active: Alarm[]; history: Alarm[] }>("/api/alarms"),
  acknowledgeAlarm: (alarmId: string) =>
    request<{ acknowledged: boolean }>(`/api/alarms/${alarmId}/acknowledge`, {
      method: "POST",
      body: { requestId: generateRequestId() },
    }),

  // ---------- Events ----------
  events: (filter?: { from?: number; to?: number; limit?: number }) => {
    const params = new URLSearchParams();
    if (filter?.from) params.set("from", String(filter.from));
    if (filter?.to) params.set("to", String(filter.to));
    if (filter?.limit) params.set("limit", String(filter.limit));
    const q = params.toString();
    return request<{ events: SystemEvent[]; total: number }>(`/api/events${q ? `?${q}` : ""}`);
  },

  // ---------- Reports ----------
  reports: (req: ReportRequest) =>
    request<{ records: DailyEnergyRecord[]; generatedAt: number }>("/api/reports", {
      method: "POST",
      body: { ...req, requestId: generateRequestId() },
    }),

  // ---------- AI insights (advisory only — through ESP32 HMAC proxy) ----------
  insights: () => request<InsightsEnvelope>("/api/insights"),

  // ---------- OTA ----------
  otaHistory: () => request<{ entries: OtaHistoryEntry[] }>("/api/ota/history"),
  otaCheck: () =>
    request<{ available: boolean; latestVersion: string | null }>("/api/ota/check", {
      method: "POST",
    }),
  otaUpload: (file: File, onProgress?: (pct: number) => void) =>
    new Promise<{ success: boolean; newVersion?: string }>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${API_BASE_URL}/api/ota`);
      xhr.withCredentials = true;
      if (csrfTokenCache) xhr.setRequestHeader("X-CSRF-Token", csrfTokenCache);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      };
      xhr.onload = () => {
        try {
          const json = JSON.parse(xhr.responseText) as ApiResponse<{ success: boolean; newVersion?: string }>;
          if (xhr.status >= 200 && xhr.status < 300 && json.success) resolve(json.data);
          else reject(new ApiError(json.message || "OTA failed", xhr.status));
        } catch {
          reject(new ApiError("Invalid OTA response", xhr.status));
        }
      };
      xhr.onerror = () => reject(new ApiError("OTA network error", 0));
      const fd = new FormData();
      fd.append("file", file);
      xhr.send(fd);
    }),

  // ---------- System ----------
  reboot: () => request<{ rebooting: boolean }>("/api/reboot", { method: "POST" }),
  factoryResetPrepare: () =>
    request<{ token: string; expiresAt: number }>("/api/factory_reset/prepare", {
      method: "POST",
    }),
  factoryResetConfirm: (token: string) =>
    request<{ reset: boolean }>("/api/factory_reset/confirm", {
      method: "POST",
      body: { token, confirm: "RESET" },
    }),

  // ---------- Device config ----------
  updateDevice: (opts: { deviceName?: string; siteName?: string; timezone?: string }) =>
    request<{ updated: boolean }>("/api/config/device", { method: "POST", body: opts }),

  changePassword: (current: string, next: string) =>
    request<{ changed: boolean }>("/api/config/password", {
      method: "POST",
      body: { current, next },
    }),
  exportConfig: () => request<{ config: SystemConfig }>("/api/config/export"),
  importConfig: (cfg: SystemConfig) =>
    request<{ imported: boolean }>("/api/config/import", { method: "POST", body: cfg }),
};
