// =============================================================================
// SOC state machine display helpers (brief §17-19, §58).
// -----------------------------------------------------------------------------
// SOC is ALWAYS ESTIMATED unless synchronized at full-charge (brief §17).
// `confidence` degrades over time since last sync (BASELINE_AGING).
//
// v1.6.0 — SOC PROVENANCE: with the multi-protocol BMS integration the SOC
// can now come from the battery itself (BMS_DIRECT), the INA219 shunt coulomb
// counter (SHUNT_COULOMB), the boot OCV estimate (OCV_ESTIMATED), or be
// unknown (UNKNOWN). This is displayed as an explicit badge so the operator
// always knows WHO measured the number — never a silent fallback.
// =============================================================================

import type { SocState, SocProvenance } from "./types";
import { normalizeSocProvenance } from "./types";

export type SocDisplay = {
  label: string;                       // "Synchronized" | "Estimated (Coulomb Counting)" | etc.
  badgeColor: string;                  // Tailwind classes (text + bg)
  qualityLabel: string;                // "VALID" | "ESTIMATED" | etc.
  sourceLabel: string;                 // "Coulomb Counting" | "Voltage Sync" | "Full Charge Detected"
  confidenceLabel: string;             // "High" | "Medium" | "Low" | "Baseline Aging"
  confidenceColor: string;             // Tailwind text color
  lastSyncLabel: string | null;        // formatted "last synced Xs ago"
  provenance: SocProvenance;           // v1.6.0 — resolved provenance
  provenanceLabel: string;             // "BMS Direct" | "Shunt (Coulomb)" | "OCV Estimate" | "Unknown"
  provenanceColor: string;             // Tailwind classes for the badge
};

const provenanceMeta: Record<SocProvenance, { label: string; color: string }> = {
  BMS_DIRECT:    { label: "BMS Direct",       color: "border-status-on/30 text-status-on" },
  SHUNT_COULOMB: { label: "Shunt (Coulomb)",  color: "border-status-info/30 text-status-info" },
  OCV_ESTIMATED: { label: "OCV Estimate",     color: "border-status-warn/30 text-status-warn" },
  UNKNOWN:       { label: "Unknown Source",   color: "border-status-error/30 text-status-error" },
};

/**
 * Resolve the honest provenance for display.
 * Firmware ≥1.6.0 sends `soc.provenance` directly. Older payloads lack it:
 *  - a present BMS block with connected=true implies BMS_DIRECT
 *  - otherwise the pre-1.6 firmware could only produce shunt/OCV values →
 *    we keep UNKNOWN rather than guessing between shunt and OCV (honest).
 */
export function resolveProvenance(
  soc: SocState,
  bmsConnected: boolean | undefined
): SocProvenance {
  if (soc.provenance) return normalizeSocProvenance(soc.provenance);
  if (bmsConnected === true) return "BMS_DIRECT";
  return "UNKNOWN";
}

export function describeSoc(
  soc: SocState,
  now: number = Date.now(),
  bmsConnected?: boolean
): SocDisplay {
  // [audit r5 / p.445 — cross-layer companion] The firmware persists and
  // sends `soc.lastSync` as UNIX epoch SECONDS (uint32_t — ms does not fit);
  // the demo mock and pre-contract payloads use epoch ms. Normalize at the
  // display boundary until the round-6 cross-layer time contract pins one
  // domain for every producer (device REST, MQTT, GAS rows).
  const syncMs = normalizeLastSyncMs(soc.lastSync);
  const sourceLabels: Record<SocState["source"], string> = {
    COULOMB_COUNTING: "Coulomb Counting",
    VOLTAGE_SYNC: "Voltage Sync",
    FULL_CHARGE_DETECTED: "Full Charge Detected",
  };
  const confidenceLabels: Record<SocState["confidence"], { label: string; color: string }> = {
    HIGH: { label: "High", color: "text-status-on" },
    MEDIUM: { label: "Medium", color: "text-status-info" },
    LOW: { label: "Low", color: "text-status-warn" },
    BASELINE_AGING: { label: "Baseline Aging", color: "text-status-error" },
  };
  const conf = confidenceLabels[soc.confidence];
  const provenance = resolveProvenance(soc, bmsConnected);
  const prov = provenanceMeta[provenance];

  if (soc.method === "SYNCHRONIZED" || soc.method === "BMS_DIRECT") {
    return {
      label: soc.method === "BMS_DIRECT" ? "BMS Measured" : "Synchronized",
      badgeColor: prov.color,
      qualityLabel: soc.method === "BMS_DIRECT" ? "VALID" : "VALID",
      sourceLabel: sourceLabels[soc.source],
      confidenceLabel: conf.label,
      confidenceColor: conf.color,
      lastSyncLabel: syncMs ? formatLastSync(syncMs, now) : null,
      provenance,
      provenanceLabel: prov.label,
      provenanceColor: prov.color,
    };
  }
  return {
    label: `Estimated (${sourceLabels[soc.source]})`,
    badgeColor: "border-status-warn/30 text-status-warn",
    qualityLabel: "ESTIMATED",
    sourceLabel: sourceLabels[soc.source],
    confidenceLabel: conf.label,
    confidenceColor: conf.color,
    lastSyncLabel: syncMs ? formatLastSync(syncMs, now) : "Never",
    provenance,
    provenanceLabel: prov.label,
    provenanceColor: prov.color,
  };
}

/**
 * [audit r5 / p.445 — cross-layer companion] Single-domain normalization for
 * the SOC sync timestamp. Firmware sends UNIX epoch SECONDS (uint32_t:
 * ~1.76e9 for 2026). Mock / older payloads send epoch MS (~1.76e12). The
 * discrimination threshold 1e11 cleanly separates the two domains for any
 * plausible date (seconds-epoch values stay far below it until year ~5138;
 * ms-epoch values are far above it since 2001). 0 / negative / null = unknown.
 */
export function normalizeLastSyncMs(v: number | null | undefined): number | null {
  if (v == null || v <= 0) return null;
  return v < 100_000_000_000 ? v * 1000 : v;
}

function formatLastSync(syncMs: number, now: number): string {
  const diff = now - syncMs;
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

// Estimate confidence from last sync age (used by mock only — firmware computes
// this directly from internal state).
export function estimateConfidenceFromAge(lastSyncMs: number | null): SocState["confidence"] {
  if (lastSyncMs == null) return "LOW";
  const daysSince = (Date.now() - lastSyncMs) / 86_400_000;
  if (daysSince < 1) return "HIGH";
  if (daysSince < 7) return "MEDIUM";
  if (daysSince < 30) return "LOW";
  return "BASELINE_AGING";
}
