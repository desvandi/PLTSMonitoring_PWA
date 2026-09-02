// =============================================================================
// Voltage 3-point calibration UI logic (brief §11-14).
// -----------------------------------------------------------------------------
// 15S LiFePO4 pack: LOW (~45V), NOMINAL (~51V), FULL (~54V).
// The 3 points define a piecewise-linear correction curve:
//   raw < rawNominal → interpolate between (rawLow, refLow) and (rawNominal, refNominal)
//   raw >= rawNominal → interpolate between (rawNominal, refNominal) and (rawFull, refFull)
// =============================================================================

import type { Calibration, VoltageCalibrationPoint } from "./types";

export type VoltagePointKey = "low" | "nominal" | "full";

export const VOLTAGE_POINT_REFERENCES: Record<VoltagePointKey, { reference: number; label: string }> = {
  low: { reference: 45.0, label: "Low Voltage (~45V)" },
  nominal: { reference: 51.0, label: "Nominal Voltage (~51V)" },
  full: { reference: 54.0, label: "Full Voltage (~54V)" },
};

export function getVoltagePoint(
  cal: Calibration,
  key: VoltagePointKey,
): VoltageCalibrationPoint {
  switch (key) {
    case "low":
      return cal.voltageLow;
    case "nominal":
      return cal.voltageNominal;
    case "full":
      return cal.voltageFull;
  }
}

// Apply 3-point piecewise-linear correction to a raw ADC reading.
// Returns the corrected voltage (V).
export function applyVoltageCalibration(raw: number, cal: Calibration): number {
  const points = [cal.voltageLow, cal.voltageNominal, cal.voltageFull].sort(
    (a, b) => a.raw - b.raw,
  );
  // Below the lowest point: extrapolate using the first segment.
  if (raw <= points[0]!.raw) {
    return interpolate(points[0]!, points[1]!, raw);
  }
  // Above the highest point: extrapolate using the last segment.
  if (raw >= points[2]!.raw) {
    return interpolate(points[1]!, points[2]!, raw);
  }
  // Between points: find segment and interpolate.
  for (let i = 0; i < points.length - 1; i++) {
    if (raw >= points[i]!.raw && raw <= points[i + 1]!.raw) {
      return interpolate(points[i]!, points[i + 1]!, raw);
    }
  }
  return raw; // fallback (should never reach)
}

function interpolate(p1: VoltageCalibrationPoint, p2: VoltageCalibrationPoint, raw: number): number {
  if (p2.raw === p1.raw) return p1.reference;
  const slope = (p2.reference - p1.reference) / (p2.raw - p1.raw);
  return p1.reference + slope * (raw - p1.raw);
}

// Compute error before/after calibration for a given point.
export function computeError(
  reference: number,
  raw: number,
  cal: Calibration | null,
): { before: number; after: number } {
  const before = raw - reference;
  const after = cal ? applyVoltageCalibration(raw, cal) - reference : before;
  return { before, after };
}
