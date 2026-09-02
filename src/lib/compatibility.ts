// =============================================================================
// Compatibility — PWA ↔ Firmware version + protocol gating (brief §51)
// -----------------------------------------------------------------------------
// Mirrors reference Remote-Relay compatibility.ts but adapted for PLTS
// Protocol v1. Monitoring-only — no `canControl` (no actuators to gate).
// `canViewTelemetry` replaces `canControl`.
// =============================================================================

import { useQuery } from "@tanstack/react-query";
import { api } from "./api";

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
  };
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

export function useCompatibility() {
  const query = useQuery({
    queryKey: ["compatibility"],
    queryFn: async (): Promise<CompatibilityStatus> => {
      try {
        const info = await api.version();
        return evaluateCompatibility(
          info.currentVersion,
          info.protocolVersion,
          info.configSchemaVersion,
        );
      } catch {
        return {
          status: "unknown",
          pwaVersion: PWA_EXPECTED.pwaVersion,
          firmwareVersion: null,
          protocolVersion: null,
          configSchemaVersion: null,
          message: "Device unreachable — cannot verify firmware compatibility.",
          canViewTelemetry: true, // optimistic: let user see error state
        };
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
