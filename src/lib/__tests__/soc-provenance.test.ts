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
import { describeSoc, normalizeLastSyncMs, resolveProvenance } from "../soc";
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

// =============================================================================
// [audit r5 / p.445 — cross-layer companion] lastSync time-domain contract.
// The firmware persists and sends soc.lastSync as UNIX epoch SECONDS (uint32_t
// — ms does not fit 32 bits); the demo mock emits epoch ms. Before this guard,
// a device value of e.g. 1757000000 (seconds) was subtracted from Date.now()
// (ms) producing "20274d ago" — a real device could never show a sane label
// while the mock masked the bug. normalizeLastSyncMs() must accept BOTH
// domains and never fabricate a timestamp for 0 / null / negative.
// =============================================================================
describe("normalizeLastSyncMs (p.445 cross-layer domain normalization)", () => {
  it("treats firmware seconds-domain values as seconds (x1000)", () => {
    const sec = Math.floor(Date.now() / 1000) - 30; // 30 s ago, firmware domain
    expect(normalizeLastSyncMs(sec)).toBe(sec * 1000);
  });

  it("keeps mock ms-domain values as ms (no double conversion)", () => {
    const ms = Date.now() - 30_000; // 30 s ago, mock domain
    expect(normalizeLastSyncMs(ms)).toBe(ms);
  });

  it("returns null for unknown values (0, negative, null, undefined)", () => {
    expect(normalizeLastSyncMs(0)).toBeNull();
    expect(normalizeLastSyncMs(-1757000000)).toBeNull();
    expect(normalizeLastSyncMs(null)).toBeNull();
    expect(normalizeLastSyncMs(undefined)).toBeNull();
  });

  it("describeSoc renders a sane 'Xs ago' label for firmware seconds-domain input", () => {
    const now = Date.now();
    const soc = makeSoc({
      method: "SYNCHRONIZED",
      lastSync: Math.floor(now / 1000) - 45, // firmware: 45 s ago, SECONDS
    });
    const d = describeSoc(soc, now);
    expect(d.lastSyncLabel).toBe("45s ago"); // was "20274d ago" pre-fix
  });

  it("describeSoc renders 'Never' for zero/unknown sync (honest unknown)", () => {
    const d = describeSoc(makeSoc({ lastSync: 0 }));
    expect(d.lastSyncLabel).toBe("Never");
  });

  it("describeSoc keeps working for the ms-domain mock producer", () => {
    const now = Date.now();
    const soc = makeSoc({
      method: "SYNCHRONIZED",
      lastSync: now - 120_000, // mock: 2 m ago, MS
    });
    const d = describeSoc(soc, now);
    expect(d.lastSyncLabel).toBe("2m ago");
  });
});
