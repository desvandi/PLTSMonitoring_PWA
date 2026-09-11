// =============================================================================
// DeviceApiClient — calls ESP32 firmware REST API directly (LAN mode).
// [P1-2 AUDIT 2026-09] Split from src/lib/api.ts to enforce clear authority:
//   - DeviceApi  = primitives owned by the ESP32 device itself
//                  (status, version, config, calibration, alarms, events,
//                   logs, diagnostics, reboot, factory_reset, OTA upload)
//   - BackendApi = aggregations / cross-device data owned by GAS/Next.js
//                  (telemetry, history, daily, reports, OTA manifest/log)
// A call to /api/reports on a DeviceApiClient is a CONTRACT VIOLATION —
// reports are aggregated server-side from many devices, never a primitive
// of a single ESP32.
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
  RelayStatusResponse,
  RelayCommandResult,
  RelayChannelId,
} from "@/lib/types";
import { getCompatibilitySnapshot, IncompatibleFirmwareError } from "./compatibility";
import { API_BASE_URL, ApiError, getCsrfToken, generateRequestId, buildCommandEnvelope } from "./apiShared";

export interface DeviceApiClient {
  // ---------- Status & version ----------
  status: () => Promise<SystemStatus>;
  version: () => Promise<FirmwareInfo>;
  diagnostics: () => Promise<Diagnostics>;

  // ---------- Config & calibration ----------
  config: () => Promise<SystemConfig>;
  calibration: () => Promise<Calibration>;
  updateConfig: (cfg: Partial<DeviceConfig>) => Promise<{ updated: boolean }>;
  updateCalibration: (cal: Partial<Calibration>) => Promise<{ updated: boolean }>;
  voltageCalibrationPoint: (
    point: "low" | "nominal" | "full",
    reference: number,
    raw: number,
  ) => Promise<{ updated: boolean }>;
  acs712ZeroCal: () => Promise<{ updated: boolean; newOffset: number }>;

  // ---------- Logs ----------
  logs: (filter?: { type?: LogType | "all"; limit?: number; since?: number }) =>
    Promise<{ logs: ActivityLog[]; total: number }>;

  // ---------- Alarms (canonical: POST /api/alarms/{alarmId}/acknowledge) ----------
  alarms: () => Promise<{ active: Alarm[]; history: Alarm[] }>;
  acknowledgeAlarm: (alarmId: string) => Promise<{ acknowledged: boolean }>;

  // ---------- Events ----------
  events: (filter?: { from?: number; to?: number; limit?: number }) =>
    Promise<{ events: SystemEvent[]; total: number }>;

  // ---------- AI insights (advisory only — through ESP32 HMAC proxy) ----------
  insights: () => Promise<InsightsEnvelope>;

  // ---------- OTA — directly to ESP32 ----------
  // meta is REQUIRED in PRODUCTION_BUILD: the device's OtaHandlers.cpp enforces
  // X-Expected-SHA256, X-Signature, X-Firmware-Version headers at UPLOAD_FILE_START.
  // Without these headers, production devices reject the upload with HTTP 500.
  // The meta object carries the Ed25519 signature (hex), SHA-256 (hex), and
  // firmware version string that the device uses to verify the binary before
  // flashing.
  otaUpload: (
    file: File | Blob,
    onProgress?: (pct: number) => void,
    meta?: { sha256: string; signature: string; version: string },
  ) => Promise<{ success: boolean; newVersion?: string }>;

  // ---------- System ----------
  reboot: () => Promise<{ rebooting: boolean }>;
  factoryResetPrepare: () => Promise<{ token: string; expiresAt: number }>;
  factoryResetConfirm: (token: string) => Promise<{ reset: boolean }>;

  // ---------- Device config (on-device metadata) ----------
  updateDevice: (opts: { deviceName?: string; siteName?: string; timezone?: string }) =>
    Promise<{ updated: boolean }>;
  changePassword: (current: string, next: string) => Promise<{ changed: boolean }>;
  exportConfig: () => Promise<{ config: SystemConfig }>;
  importConfig: (cfg: SystemConfig) => Promise<{ imported: boolean }>;

  // ---------- 8-Channel Relay (v1.8.0) ----------
  relayStatus: () => Promise<RelayStatusResponse>;
  // [RG-RELAY-09] Final-outcome reconciliation — poll after a QUEUED ack.
  relayTransaction: (transactionId: string) => Promise<RelayCommandResult>;
  relayOn: (channel: RelayChannelId) => Promise<RelayCommandResult>;
  relayOff: (channel: RelayChannelId) => Promise<RelayCommandResult>;
  relayPulse: (channel: RelayChannelId, durationMs: number) => Promise<RelayCommandResult>;
  relayAllOff: () => Promise<RelayCommandResult>;
  relayAcknowledge: (channel: RelayChannelId) => Promise<RelayCommandResult>;
  relayClear: (channel: RelayChannelId) => Promise<RelayCommandResult>;
}

async function deviceRequest<T>(
  path: string,
  opts: {
    method?: "GET" | "POST" | "PUT" | "DELETE";
    body?: unknown;
    signal?: AbortSignal;
    skipCsrf?: boolean;
    // [PARITY-4] extra request headers (e.g. X-Request-Id on config import —
    // the import body is CRC32-verified by the device and cannot carry the
    // transaction id inline).
    headers?: Record<string, string>;
  } = {},
): Promise<T> {
  const url = `${API_BASE_URL}${path}`;
  const headers: Record<string, string> = { Accept: "application/json", ...opts.headers };
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

/**
 * [Audit 2026-09-05 · P1 PWA-03] Defense-in-depth for ACTUATOR mutations.
 *
 * The UI gates relay controls behind `canControlRelays`, but the command
 * layer must enforce the same policy independently — a caller that bypasses
 * UI gating (script, console, future code path) still cannot reach the relay
 * endpoints unless compatibility was VERIFIED and relays are supported.
 *
 * Fail-closed on BOTH:
 *   - compatibility snapshot missing  (never verified → BLOCKED)
 *   - canControlRelays === false      (firmware <1.8.0 or unknown → BLOCKED)
 */
function assertRelayCommandAllowed(): void {
  const compat = getCompatibilitySnapshot();
  if (!compat) {
    throw new IncompatibleFirmwareError(
      "Relay command BLOCKED (fail-closed): firmware compatibility has not been " +
        "verified yet. Wait for the /api/version check to complete, then retry.",
    );
  }
  if (!compat.canControlRelays) {
    throw new IncompatibleFirmwareError(
      `Relay command BLOCKED: ${compat.message}`,
    );
  }
}

export const deviceApi: DeviceApiClient = {
  status:      () => deviceRequest<SystemStatus>("/api/status"),
  version:     () => deviceRequest<FirmwareInfo>("/api/version"),
  diagnostics: () => deviceRequest<Diagnostics>("/api/diagnostics"),

  config:      () => deviceRequest<SystemConfig>("/api/config"),
  calibration: () => deviceRequest<Calibration>("/api/calibration"),

  updateConfig: (cfg) => {
    const compat = getCompatibilitySnapshot();
    if (compat && !compat.canViewTelemetry) throw new IncompatibleFirmwareError(compat.message);
    return deviceRequest<{ updated: boolean }>("/api/config", {
      method: "POST",
      // [PRODUCTION-GRADE 2026-09 / CORE-02] Full command envelope
      body: { ...cfg, ...buildCommandEnvelope() },
    });
  },
  updateCalibration: (cal) => {
    const compat = getCompatibilitySnapshot();
    if (compat && !compat.canViewTelemetry) throw new IncompatibleFirmwareError(compat.message);
    return deviceRequest<{ updated: boolean }>("/api/calibration", {
      method: "POST",
      body: { ...cal, ...buildCommandEnvelope() },
    });
  },
  voltageCalibrationPoint: (point, reference, raw) => {
    const compat = getCompatibilitySnapshot();
    if (compat && !compat.canViewTelemetry) throw new IncompatibleFirmwareError(compat.message);
    return deviceRequest<{ updated: boolean }>(`/api/calibration/voltage/point/${point}`, {
      method: "POST",
      body: { reference, raw, ...buildCommandEnvelope() },
    });
  },
  acs712ZeroCal: () => {
    const compat = getCompatibilitySnapshot();
    if (compat && !compat.canViewTelemetry) throw new IncompatibleFirmwareError(compat.message);
    return deviceRequest<{ updated: boolean; newOffset: number }>(
      "/api/calibration/acs712/zero",
      { method: "POST", body: { ...buildCommandEnvelope() } },
    );
  },

  logs: (filter) => {
    const params = new URLSearchParams();
    if (filter?.type && filter.type !== "all") params.set("type", filter.type);
    if (filter?.limit) params.set("limit", String(filter.limit));
    if (filter?.since) params.set("since", String(filter.since));
    const q = params.toString();
    return deviceRequest<{ logs: ActivityLog[]; total: number }>(`/api/log${q ? `?${q}` : ""}`);
  },

  // P1-3 canonical contract: POST /api/alarms/{alarmId}/acknowledge
  // [audit-2 S-5 FIX] URL-encode alarmId to prevent path injection if the
  // firmware ever emits an alarm code with `/`, `?`, `#`, or unicode chars.
  alarms: () => deviceRequest<{ active: Alarm[]; history: Alarm[] }>("/api/alarms"),
  acknowledgeAlarm: (alarmId: string) =>
    deviceRequest<{ acknowledged: boolean }>(
      `/api/alarms/${encodeURIComponent(alarmId)}/acknowledge`,
      {
        method: "POST",
        body: { ...buildCommandEnvelope() },
      },
    ),

  events: (filter) => {
    const params = new URLSearchParams();
    if (filter?.from) params.set("from", String(filter.from));
    if (filter?.to) params.set("to", String(filter.to));
    if (filter?.limit) params.set("limit", String(filter.limit));
    const q = params.toString();
    return deviceRequest<{ events: SystemEvent[]; total: number }>(`/api/events${q ? `?${q}` : ""}`);
  },

  insights: () => deviceRequest<InsightsEnvelope>("/api/insights"),

  // OTA — uploads binary directly to ESP32 (NOT demo route)
  // [Audit 2026-09-04] Fix PWA→firmware contract gap: send X-Expected-SHA256,
  // X-Signature, X-Firmware-Version headers. PRODUCTION_BUILD devices reject
  // uploads without these headers (OtaHandlers.cpp UPLOAD_FILE_START gate).
  otaUpload: (file, onProgress, meta) =>
    new Promise<{ success: boolean; newVersion?: string }>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${API_BASE_URL}/api/ota`);
      xhr.withCredentials = true;
      const csrf = getCsrfToken();
      if (csrf) xhr.setRequestHeader("X-CSRF-Token", csrf);
      // [P0 fix] Production OTA contract: device requires these headers to
      // verify the binary BEFORE flashing. SHA-256 is streamed on the device
      // and compared to X-Expected-SHA256; Ed25519 signature is verified
      // against the compiled-in OTA_ED25519_PUBLIC_KEY_HEX.
      if (meta) {
        xhr.setRequestHeader("X-Expected-SHA256", meta.sha256);
        xhr.setRequestHeader("X-Signature", meta.signature);
        xhr.setRequestHeader("X-Firmware-Version", meta.version);
      }
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

  reboot: () => deviceRequest<{ rebooting: boolean }>("/api/reboot", { method: "POST" }),
  factoryResetPrepare: () =>
    deviceRequest<{ token: string; expiresAt: number }>("/api/factory_reset/prepare", {
      method: "POST",
    }),
  factoryResetConfirm: (token) =>
    deviceRequest<{ reset: boolean }>("/api/factory_reset/confirm", {
      method: "POST",
      body: { token, confirm: "RESET" },
    }),

  // [PARITY-4 2026-09-06] Transaction identity parity (audit P1): device
  // config mutations now carry requestId on EVERY path — the firmware
  // handleDevicePost already ran the canonical pipeline (journal + dedup),
  // but a body without requestId skipped it entirely.
  updateDevice: (opts) =>
    deviceRequest<{ updated: boolean }>("/api/config/device", {
      method: "POST",
      body: { ...opts, ...buildCommandEnvelope() },
    }),
  changePassword: (current, next) =>
    deviceRequest<{ changed: boolean }>("/api/config/password", {
      method: "POST",
      // [PARITY-4] the firmware joins password changes to the canonical
      // config.password command path (journal + dedup).
      body: { current, next, ...buildCommandEnvelope() },
    }),
  exportConfig: () => deviceRequest<{ config: SystemConfig }>("/api/config/export"),
  // [PARITY-4] Config import: requestId rides the X-Request-Id HEADER. The
  // body is the exported CRC32-verified backup — injecting a key would
  // break the device's Utils::verifyCRC. The firmware journals the
  // transaction with sha256(raw-body) as the command hash: same bytes +
  // same id = replayed ACK; different bytes + same id = 409 CONFLICT.
  importConfig: (cfg) =>
    deviceRequest<{ imported: boolean }>("/api/config/import", {
      method: "POST",
      body: cfg,
      headers: { "X-Request-Id": generateRequestId() },
    }),

  // ---------- 8-Channel Relay (v1.8.0) ----------
  // [Brief §6] All relay mutations use IDEMPOTENT_STATE (on/off), NOT toggle.
  // [PRODUCTION-GRADE 2026-09 / audit p.62-65] Every mutation now carries the
  // FULL command envelope (requestId/transactionId/version/issuedAt/expiresAt)
  // — the firmware CORE-02 gate rejects envelope-less mutations, so replay
  // protection is freshness + journal retention, never journal-only.
  // TIMEOUT on PWA side → UNKNOWN state (NOT FAILED) — reconcile after reconnect.
  relayStatus: () => deviceRequest<RelayStatusResponse>("/api/relays"),
  // [RG-RELAY-09] Query the final outcome of a queued relay transaction.
  relayTransaction: (transactionId: string) =>
    deviceRequest<RelayCommandResult>(
      `/api/relays/transactions/${encodeURIComponent(transactionId)}`,
    ),
  // [P1 PWA-03] Every relay mutation passes through assertRelayCommandAllowed()
  // BEFORE the POST — command-layer enforcement, not just UI gating.
  // NOTE: relay mutations are `async` so the guard's throw surfaces as a
  // REJECTED promise (not a synchronous exception) — safe for every caller
  // style (useMutation, plain await, .catch()).
  relayOn: async (channel) => {
    assertRelayCommandAllowed();
    return deviceRequest<RelayCommandResult>(`/api/relays/${channel}/on`, {
      method: "POST",
      body: { source: "MANUAL", ...buildCommandEnvelope() },
    });
  },
  relayOff: async (channel) => {
    assertRelayCommandAllowed();
    return deviceRequest<RelayCommandResult>(`/api/relays/${channel}/off`, {
      method: "POST",
      body: { source: "MANUAL", ...buildCommandEnvelope() },
    });
  },
  relayPulse: async (channel, durationMs) => {
    assertRelayCommandAllowed();
    return deviceRequest<RelayCommandResult>(`/api/relays/${channel}/pulse`, {
      method: "POST",
      body: { source: "MANUAL", durationMs, ...buildCommandEnvelope() },
    });
  },
  relayAllOff: async () => {
    assertRelayCommandAllowed();
    return deviceRequest<RelayCommandResult>("/api/relays/all_off", {
      method: "POST",
      body: { source: "MANUAL", ...buildCommandEnvelope() },
    });
  },
  relayAcknowledge: async (channel) => {
    assertRelayCommandAllowed();
    return deviceRequest<RelayCommandResult>(`/api/relays/${channel}/acknowledge`, {
      method: "POST",
      body: { ...buildCommandEnvelope() },
    });
  },
  relayClear: async (channel) => {
    assertRelayCommandAllowed();
    return deviceRequest<RelayCommandResult>(`/api/relays/${channel}/clear`, {
      method: "POST",
      body: { ...buildCommandEnvelope() },
    });
  },
};
