// =============================================================================
// SOC provenance semantics — v1.6.0 multi-protocol BMS integration.
// -----------------------------------------------------------------------------
// Truth rules under test:
//   1. resolveProvenance trusts the firmware's explicit provenance field.
//   2. Absent provenance + connected BMS  → BMS_DIRECT (implied by the block).
//   3. Absent provenance + no BMS         → UNKNOWN (NEVER guessed — a pre-1.6
//      payload could be shunt OR OCV and we refuse to fabricate which).
//   4. Garbage strings normalize to UNKNOWN, never throw.
//   5. describeSoc surfaces the provenance badge for every combination and
//      keeps BMS_DIRECT visually distinct from the shunt estimate.
// =============================================================================
import { describe, expect, it } from "vitest";
import { describeSoc, resolveProvenance } from "../soc";
import type { SocState } from "../types";

function makeSoc(overrides: Partial<SocState> = {}): SocState {
  return {
    value: 55,
    quality: "ESTIMATED",
    source: "COULOMB_COUNTING",
    method: "ESTIMATED",
    lastSync: null,
    confidence: "MEDIUM",
    ...overrides,
  };
}

describe("resolveProvenance (firmware → PWA provenance contract)", () => {
  it("uses the explicit firmware provenance when present", () => {
    expect(resolveProvenance(makeSoc({ provenance: "BMS_DIRECT" }), undefined)).toBe("BMS_DIRECT");
    expect(resolveProvenance(makeSoc({ provenance: "SHUNT_COULOMB" }), true)).toBe("SHUNT_COULOMB");
    expect(resolveProvenance(makeSoc({ provenance: "OCV_ESTIMATED" }), false)).toBe("OCV_ESTIMATED");
  });

  it("implies BMS_DIRECT from a connected BMS block on legacy-but-BMS payloads", () => {
    expect(resolveProvenance(makeSoc(), true)).toBe("BMS_DIRECT");
  });

  it("returns UNKNOWN for pre-1.6 payloads without a BMS — never guesses shunt vs OCV", () => {
    expect(resolveProvenance(makeSoc(), undefined)).toBe("UNKNOWN");
    expect(resolveProvenance(makeSoc(), false)).toBe("UNKNOWN");
  });

  it("normalizes garbage to UNKNOWN without throwing", () => {
    expect(resolveProvenance(makeSoc({ provenance: "definitely-not-real" as never }), true)).toBe("UNKNOWN");
    expect(resolveProvenance(makeSoc({ provenance: "" as never }), false)).toBe("UNKNOWN");
  });
});

describe("describeSoc provenance badge", () => {
  it("labels BMS-measured SOC as BMS Direct (not 'Estimated')", () => {
    const d = describeSoc(makeSoc({ method: "BMS_DIRECT", provenance: "BMS_DIRECT" }));
    expect(d.label).toBe("BMS Measured");
    expect(d.provenanceLabel).toBe("BMS Direct");
    expect(d.provenance).toBe("BMS_DIRECT");
  });

  it("labels shunt coulomb SOC honestly as an estimate", () => {
    const d = describeSoc(makeSoc({ provenance: "SHUNT_COULOMB" }));
    expect(d.label).toContain("Estimated");
    expect(d.provenanceLabel).toBe("Shunt (Coulomb)");
  });

  it("labels OCV SOC as the coarsest basis", () => {
    const d = describeSoc(makeSoc({ provenance: "OCV_ESTIMATED" }));
    expect(d.provenanceLabel).toBe("OCV Estimate");
  });

  it("flags unknown provenance as an error-tone badge (operator must investigate)", () => {
    const d = describeSoc(makeSoc());
    expect(d.provenance).toBe("UNKNOWN");
    expect(d.provenanceLabel).toBe("Unknown Source");
    expect(d.provenanceColor).toContain("status-error");
  });

  it("keeps the three badges independent: quality vs provenance vs source", () => {
    const d = describeSoc(makeSoc({ method: "BMS_DIRECT", provenance: "BMS_DIRECT", quality: "SUSPECT" }));
    // A mismatch-flagged BMS SOC: provenance stays BMS_DIRECT, quality is
    // rendered from the measurement itself — the operator sees both facts.
    expect(d.provenance).toBe("BMS_DIRECT");
    expect(d.qualityLabel).toBe("VALID"); // describeSoc labels method, quality flag lives on the measurement
  });
});
