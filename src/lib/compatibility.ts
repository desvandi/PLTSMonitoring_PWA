// =============================================================================
// Compatibility — PWA ↔ Firmware version + protocol gating (brief §51)
// -----------------------------------------------------------------------------
// Mirrors reference Remote-Relay compatibility.ts but adapted for PLTS
// Protocol v1. Monitoring-only — no `canControl` (no actuators to gate).
// `canViewTelemetry` replaces `canControl`.
// =============================================================================

import { useQuery } from "@tanstack/react-query";
// NOTE: `./api` is imported DYNAMICALLY inside the queryFn to break the
// static import cycle  api.ts → deviceApi.ts → compatibility.ts → api.ts.
// When a consumer imports deviceApi (or this module) directly, the cycle
// would otherwise evaluate api.ts while deviceApi is still uninitialized
// (api.ts reads `deviceApi.voltageCalibrationPoint` at module-init time).

export const PWA_EXPECTED = {
  pwaVersion: "1.0.0",
  firmwareMin: "1.0.0",
  firmwareMax: null as string | null,
  protocolVersion: 1,
  configSchemaVersion: 1,
} as const;

export type CompatibilityStatus = {
  status:
    | "compatible"
    | "pwa_too_old"
    | "firmware_too_old"
    | "protocol_mismatch"
    | "config_schema_mismatch"
    | "unknown";
  pwaVersion: string;
  firmwareVersion: string | null;
  protocolVersion: number | null;
  configSchemaVersion: number | null;
  message: string;
  canViewTelemetry: boolean;
  canControlRelays: boolean;   // [v1.8.0] firmware ≥ 1.8.0 has 8-channel relay
};

function parseVersion(v: string): [number, number, number] | null {
  const m = v.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [parseInt(m[1]!, 10), parseInt(m[2]!, 10), parseInt(m[3]!, 10)];
}

function compareVersions(a: string, b: string): number {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  if (!va || !vb) return 0;
  for (let i = 0; i < 3; i++) {
    if (va[i]! < vb[i]!) return -1;
    if (va[i]! > vb[i]!) return 1;
  }
  return 0;
}

export function evaluateCompatibility(
  firmwareVersion: string | null,
  protocolVersion: number | null,
  configSchemaVersion: number | null,
): CompatibilityStatus {
  const pwaVersion = PWA_EXPECTED.pwaVersion;

  if (!firmwareVersion) {
    return {
      status: "unknown",
      pwaVersion,
      firmwareVersion: null,
      protocolVersion: null,
      configSchemaVersion: null,
      message: "Firmware version unknown — telemetry display disabled until verified.",
      canViewTelemetry: false,
      canControlRelays: false,
    };
  }
  if (compareVersions(firmwareVersion, PWA_EXPECTED.firmwareMin) < 0) {
    return {
      status: "firmware_too_old",
      pwaVersion,
      firmwareVersion,
      protocolVersion,
      configSchemaVersion,
      message: `Firmware ${firmwareVersion} is too old. PWA requires ≥ ${PWA_EXPECTED.firmwareMin}.`,
      canViewTelemetry: false,
      canControlRelays: false,
    };
  }
  if (PWA_EXPECTED.firmwareMax && compareVersions(firmwareVersion, PWA_EXPECTED.firmwareMax) > 0) {
    return {
      status: "pwa_too_old",
      pwaVersion,
      firmwareVersion,
      protocolVersion,
      configSchemaVersion,
      message: `Firmware ${firmwareVersion} is newer than this PWA supports.`,
      canViewTelemetry: false,
      canControlRelays: false,
    };
  }
  if (protocolVersion !== null && protocolVersion !== PWA_EXPECTED.protocolVersion) {
    return {
      status: "protocol_mismatch",
      pwaVersion,
      firmwareVersion,
      protocolVersion,
      configSchemaVersion,
      message: `Protocol mismatch: PWA expects ${PWA_EXPECTED.protocolVersion}, firmware reports ${protocolVersion}.`,
      canViewTelemetry: false,
      canControlRelays: false,
    };
  }
  if (configSchemaVersion !== null && configSchemaVersion !== PWA_EXPECTED.configSchemaVersion) {
    return {
      status: "config_schema_mismatch",
      pwaVersion,
      firmwareVersion,
      protocolVersion,
      configSchemaVersion,
      message: `Config schema mismatch: PWA expects ${PWA_EXPECTED.configSchemaVersion}, firmware reports ${configSchemaVersion}.`,
      canViewTelemetry: false,
      canControlRelays: false,
    };
  }
  return {
    status: "compatible",
    pwaVersion,
    firmwareVersion,
    protocolVersion,
    configSchemaVersion,
    message: "Firmware compatible — telemetry display enabled.",
    canViewTelemetry: true,
    // [self-review fix] canControlRelays = true ONLY if firmware ≥ 1.8.0
    // (8-channel relay support was added in v1.8.0). Older firmware does
    // not have /api/relays endpoint — the relay view must be hidden.
    canControlRelays: _firmwareSupportsRelays(parseVersion(firmwareVersion)),
  };
}

/** [self-review fix] Check if firmware version supports 8-channel relay. */
function _firmwareSupportsRelays(fwVer: [number, number, number] | null): boolean {
  if (!fwVer) return false;
  const [major, minor] = fwVer;
  // v1.8.0+ has relay support (PCF8574 I²C expander, /api/relays endpoint)
  if (major > 1) return true;
  if (major === 1 && minor >= 8) return true;
  return false;
}

export class IncompatibleFirmwareError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IncompatibleFirmwareError";
  }
}

let _compatibilitySnapshot: CompatibilityStatus | null = null;

export function setCompatibilitySnapshot(status: CompatibilityStatus | null): void {
  _compatibilitySnapshot = status;
}

export function getCompatibilitySnapshot(): CompatibilityStatus | null {
  return _compatibilitySnapshot;
}

/**
 * [Audit 2026-09-05 · P0 PWA-02] Status returned when the device cannot be
 * reached — compatibility is UNVERIFIED, which MUST be represented as a
 * fail-closed state: telemetry display and relay control are both BLOCKED
 * until `/api/version` succeeds. "UNKNOWN" must never be reported as a
 * verified/compatible state.
 */
export function unreachableCompatibilityStatus(): CompatibilityStatus {
  return {
    status: "unknown",
    pwaVersion: PWA_EXPECTED.pwaVersion,
    firmwareVersion: null,
    protocolVersion: null,
    configSchemaVersion: null,
    message:
      "Device unreachable — cannot verify firmware compatibility. " +
      "Compatibility: UNKNOWN · Firmware: UNVERIFIED · Telemetry: BLOCKED · " +
      "Relay control: BLOCKED (until /api/version is verified).",
    // [P0 PWA-02 FIX] was `canViewTelemetry: true` — an unverifiable device
    // must NOT be treated as telemetry-compatible. Fail closed on BOTH gates.
    canViewTelemetry: false,
    canControlRelays: false,
  };
}

export function useCompatibility() {
  const query = useQuery({
    queryKey: ["compatibility"],
    queryFn: async (): Promise<CompatibilityStatus> => {
      try {
        // Dynamic import — see NOTE above (static-import cycle breaker).
        const { api } = await import("./api");
        const info = await api.version();
        return evaluateCompatibility(
          info.currentVersion,
          info.protocolVersion,
          info.configSchemaVersion,
        );
      } catch {
        // [P0 PWA-02 FIX] Device unreachable → fail-closed (see helper above).
        return unreachableCompatibilityStatus();
      }
    },
    refetchInterval: 60 * 1000,
    staleTime: 30 * 1000,
  });
  if (query.data) {
    setCompatibilitySnapshot(query.data);
  }
  return query;
}
