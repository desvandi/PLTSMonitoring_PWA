// =============================================================================
// BackendApiClient — calls GAS / Next.js backend (server-side aggregations).
// [P1-2 AUDIT 2026-09] Split from src/lib/api.ts:
//   - DeviceApi  = primitives owned by the ESP32 device itself
//   - BackendApi = aggregations / cross-device data owned by GAS/Next.js
//                  (telemetry, history, daily, reports, OTA manifest/log)
//
// Reports were previously mixed into the device API client — a contract
// violation: reports aggregate data from MANY devices (and history) on the
// server, they are NOT a primitive of any single ESP32. Moving them here
// makes the authority explicit and prevents the PWA from accidentally
// calling /api/reports on a direct-to-ESP32 connection (which would 404).
// =============================================================================

import type {
  ApiResponse,
  DailyEnergyRecord,
  ReportRequest,
  OtaHistoryEntry,
} from "@/lib/types";
import { API_BASE_URL, ApiError, getCsrfToken, generateRequestId } from "./apiShared";

export interface BackendApiClient {
  // ---------- Reports (server-side aggregation; NOT a device primitive) ----
  reports: (req: ReportRequest) =>
    Promise<{ records: DailyEnergyRecord[]; generatedAt: number }>;

  // ---------- OTA history & manifest (server-side, fleet-wide) -------------
  // These come from GAS, not the ESP32. A single device only knows its own
  // current firmware; the backend knows the fleet's OTA history.
  otaHistory: () => Promise<{ entries: OtaHistoryEntry[] }>;
  otaCheck: () => Promise<{ available: boolean; latestVersion: string | null }>;
}

async function backendRequest<T>(
  path: string,
  opts: {
    method?: "GET" | "POST" | "PUT" | "DELETE";
    body?: unknown;
    signal?: AbortSignal;
    skipCsrf?: boolean;
  } = {},
): Promise<T> {
  // Backend API uses NEXT_PUBLIC_BACKEND_API_BASE_URL if set (separate origin
  // from the device), otherwise falls back to the same origin (Next.js route
  // handlers under /api/*). This split lets the PWA call GAS directly without
  // proxying through the device.
  const backendBase = process.env.NEXT_PUBLIC_BACKEND_API_BASE_URL ?? API_BASE_URL;
  const url = `${backendBase}${path}`;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (opts.body !== undefined) {
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
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
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

  if (res.status === 204) return undefined as T;
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

export const backendApi: BackendApiClient = {
  reports: (req) =>
    backendRequest<{ records: DailyEnergyRecord[]; generatedAt: number }>("/api/reports", {
      method: "POST",
      body: { ...req, requestId: generateRequestId() },
    }),

  otaHistory: () => backendRequest<{ entries: OtaHistoryEntry[] }>("/api/ota/history"),
  otaCheck: () =>
    backendRequest<{ available: boolean; latestVersion: string | null }>("/api/ota/check", {
      method: "POST",
    }),
};
