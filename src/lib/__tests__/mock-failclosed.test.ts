// =============================================================================
// mock-failclosed.test.ts — [PARITY-4 2026-09-06] demo-namespace contract test.
// -----------------------------------------------------------------------------
// Audit P1 (parallel mock world): every Next.js /api/* route backed by
// mockStore must be fail-closed outside demo mode — it must reference
// isMockAuthEnabled() so a production build can NEVER serve fabricated data
// from the PWA origin. This scan fails the moment someone adds a new
// mockStore-backed route without the guard, or strips it from an existing
// one (the demo/ routes are exempt only when they already self-gate).
// =============================================================================

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const PWA_ROOT = join(__dirname, "..", "..", "..");
const API_ROOT = join(PWA_ROOT, "src", "app", "api");

/** Recursively collect route.ts files under src/app/api. */
function collectRoutes(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectRoutes(full));
    } else if (entry === "route.ts") {
      out.push(full);
    }
  }
  return out;
}

describe("[PARITY-4] mockStore-backed routes are demo-fail-closed", () => {
  it("every route importing mockStore references isMockAuthEnabled", () => {
    const routes = collectRoutes(API_ROOT);
    expect(routes.length).toBeGreaterThan(15); // sanity: we actually scanned

    const offenders: string[] = [];
    let mockRoutes = 0;
    for (const route of routes) {
      const src = readFileSync(route, "utf-8");
      if (!src.includes("mockStore")) continue;
      mockRoutes += 1;
      if (!src.includes("isMockAuthEnabled")) {
        offenders.push(relative(PWA_ROOT, route));
      }
    }
    expect(mockRoutes).toBeGreaterThan(15); // sanity: the mock surface exists
    if (offenders.length > 0) {
      throw new Error(
        "Mock-backed routes WITHOUT the demo fail-closed guard (audit P1 — " +
          "production must never be able to serve mock data):\n  " +
          offenders.join("\n  "),
      );
    }
  });

  it("every mockStore-backed route returns 503 via serviceUnavailable when not demo", () => {
    // Belt + braces: the guard must actually USE serviceUnavailable (503),
    // not silently return ok() or a fabricated payload.
    //
    // DUAL-MODE routes are exempt by design (their non-demo branch is honest,
    // just not a 503):
    //   - login          → 403 fail("LAN mode (mock API) is disabled in production…")
    //   - session        → ok({ isAuthenticated: false, … }) — the production
    //                      session lives on the DEVICE origin, not here
    //   - ota/check      → non-demo branch serves the REAL release-policy
    //                      state (P0 PWA-01: authorized tag, mismatch, blocked)
    const DUAL_MODE = new Set([
      "src/app/api/login/route.ts",
      "src/app/api/session/route.ts",
      "src/app/api/ota/check/route.ts",
    ]);
    const routes = collectRoutes(API_ROOT);
    const offenders: string[] = [];
    for (const route of routes) {
      const src = readFileSync(route, "utf-8");
      if (!src.includes("mockStore")) continue;
      if (!src.includes("isMockAuthEnabled")) continue; // covered by test 1
      if (DUAL_MODE.has(relative(PWA_ROOT, route))) continue;
      if (!src.includes("serviceUnavailable")) {
        offenders.push(relative(PWA_ROOT, route));
      }
    }
    if (offenders.length > 0) {
      throw new Error(
        "Guarded mock routes missing serviceUnavailable (503) semantics:\n  " +
          offenders.join("\n  "),
      );
    }
  });
});
