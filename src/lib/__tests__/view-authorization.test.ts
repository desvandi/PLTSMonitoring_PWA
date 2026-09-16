// =============================================================================
// view-authorization.test.ts — [AUDIT p.484 / p.485b REMEDIATION tests]
// Policy under test:
//   - ONE single source of truth (lib/view-authorization.ts) decides which
//     views are operator-only;
//   - 'emergency' IS operator-only (was missing — viewer sessions could open
//     the ARM/DISARM/CONFIG panel);
//   - viewer role is blocked from every operator-only view (the desktop
//     sidebar previously bypassed the mobile-only canOpenView gate, and the
//     page.tsx render switch had NO role check at all).
// =============================================================================
import { describe, expect, it } from "vitest";
import {
  OPERATOR_ONLY_VIEWS,
  canOpenView,
  isOperatorOnlyView,
} from "@/lib/view-authorization";
import type { ViewKey } from "@/lib/store";

describe("OPERATOR_ONLY_VIEWS — the single source of truth", () => {
  it("contains every mutating surface", () => {
    const expected: ViewKey[] = [
      "calibration",
      "config",
      "ota",
      "settings",
      "relays",
    ];
    for (const v of expected) {
      expect(OPERATOR_ONLY_VIEWS).toContain(v);
    }
  });

  it("p.485b: 'emergency' IS operator-only (ARM/DISARM/CONFIG controls)", () => {
    expect(OPERATOR_ONLY_VIEWS).toContain("emergency");
    expect(isOperatorOnlyView("emergency")).toBe(true);
  });
});

describe("canOpenView — role gating matrix", () => {
  it("viewer is BLOCKED from every operator-only view", () => {
    for (const v of OPERATOR_ONLY_VIEWS) {
      expect(canOpenView("viewer", v)).toBe(false);
    }
  });

  it("operator can open every view", () => {
    const views: ViewKey[] = [
      "dashboard",
      "fleet",
      "battery",
      "ac",
      "environment",
      "energy",
      "calibration",
      "config",
      "alarms",
      "diagnostics",
      "sensors",
      "events",
      "reports",
      "ai",
      "settings",
      "ota",
      "emergency",
      "relays",
    ];
    for (const v of views) {
      expect(canOpenView("operator", v)).toBe(true);
    }
  });

  it("viewer can open read-only views (telemetry, alarms, reports)", () => {
    const readOnly: ViewKey[] = [
      "dashboard",
      "battery",
      "ac",
      "environment",
      "energy",
      "alarms",
      "diagnostics",
      "sensors",
      "events",
      "reports",
      "ai",
      "fleet",
    ];
    for (const v of readOnly) {
      expect(canOpenView("viewer", v)).toBe(true);
    }
  });
});
