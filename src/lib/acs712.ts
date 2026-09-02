// =============================================================================
// ACS712 display helpers (brief §26-28).
// -----------------------------------------------------------------------------
// The ACS712 measures AC current only. RMS, peak, and average are MEASURED.
// Power is ESTIMATED (no AC voltage or PF sensor) — must be visually marked.
// =============================================================================

import type { AcTelemetry } from "./types";

export type AcSignalQualityInfo = {
  label: string;
  color: string;                     // Tailwind text color
  borderColor: string;                // Tailwind border color
  description: string;
};

export function describeAcSignalQuality(q: AcTelemetry["signalQuality"]): AcSignalQualityInfo {
  switch (q) {
    case "GOOD":
      return {
        label: "Good",
        color: "text-status-on",
        borderColor: "border-status-on/30",
        description: "RMS window has sufficient samples and stable zero-crossing.",
      };
    case "DEGRADED":
      return {
        label: "Degraded",
        color: "text-status-warn",
        borderColor: "border-status-warn/30",
        description: "Some samples dropped or noisy — RMS may be slightly off.",
      };
    case "POOR":
      return {
        label: "Poor",
        color: "text-status-warn",
        borderColor: "border-status-warn/40",
        description: "Significant noise or insufficient samples — treat readings with caution.",
      };
    case "UNKNOWN":
      return {
        label: "Unknown",
        color: "text-muted-foreground",
        borderColor: "border-border/40",
        description: "No valid AC measurement available.",
      };
    case "INVALID":
      return {
        label: "Invalid",
        color: "text-status-error",
        borderColor: "border-status-error/40",
        description: "Sensor returned invalid data — readings should not be trusted.",
      };
  }
}

export function estimateAcPower(rmsA: number, voltage: number, powerFactor: number): number {
  if (!Number.isFinite(rmsA) || !Number.isFinite(voltage) || !Number.isFinite(powerFactor))
    return 0;
  if (rmsA <= 0 || voltage <= 0 || powerFactor <= 0) return 0;
  return rmsA * voltage * powerFactor;
}
