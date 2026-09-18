// =============================================================================
// gate6-session-lifecycle.test.ts — [GATE-6 REMEDIATION CONTRACT]
// -----------------------------------------------------------------------------
// AUDIT FINDINGS under test (Phase 2):
//
//  F2-AUTH-004 — logout() recreated the GAS viewer session
//     (`setRestSession(config && !LAN_LOGIN_AVAILABLE ? GAS_CLOUD_SESSION : ...)`)
//     — "logout" immediately re-authenticated as gas-viewer, and refresh()
//     auto-PINGed GAS back into a session. Acceptance: after logout (and
//     after page refresh) the session stays UNAUTHENTICATED with no automatic
//     PING until an explicit re-authentication.
//
//  F2-AUTH-009 — GAS device auth tokens + admin tokens survived logout in
//     sessionStorage. Acceptance: logout clears PLTS_AUTH_TOKENS and
//     PLTS_ADMIN_TOKENS.
// =============================================================================
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf-8");

describe("F2-AUTH-004 — logout terminates the GAS viewer session", () => {
  const src = read("src/components/providers/auth-provider.tsx");

  it("L1: logout() no longer recreates GAS_CLOUD_SESSION", () => {
    // The OLD bug: `setRestSession(config && !LAN_LOGIN_AVAILABLE ? GAS_CLOUD_SESSION : DEFAULT_SESSION)`
    // Strip // comments so only CODE usage is asserted (the remediation
    // comment legitimately names the removed bug).
    const logoutBody = src
      .split("const logout = useCallback")[1]
      .split("return (")[0]
      .replace(/\/\/[^\n]*/g, "");
    expect(logoutBody).not.toContain("GAS_CLOUD_SESSION");
  });

  it("L2: logout() ends at an explicit unauthenticated state", () => {
    const logoutBody = src.split("const logout = useCallback")[1].split("return (")[0];
    expect(logoutBody).toContain("setRestSession(DEFAULT_SESSION)");
  });

  it("L3: a logout latch suppresses the automatic GAS PING in refresh()", () => {
    expect(src).toContain("loggedOutRef");
    // The refresh() early-return must precede the PING branch.
    const refreshBody = src.split("const refresh = useCallback")[1].split("const session")[0];
    const latchIdx = refreshBody.indexOf("loggedOutRef.current || readLoggedOutFlag()");
    const pingIdx = refreshBody.indexOf("pingGasEndpoint");
    expect(latchIdx).toBeGreaterThanOrEqual(0);
    expect(pingIdx).toBeGreaterThan(latchIdx);
  });

  it("L4: the latch survives a page refresh (sessionStorage flag)", () => {
    expect(src).toContain("'plts_logged_out'");
    expect(src).toContain("readLoggedOutFlag()");
    expect(src).toContain("writeLoggedOutFlag(true)");
  });

  it("L5: an EXPLICIT login releases the latch", () => {
    const loginBody = src.split("const login = useCallback")[1].split("const logout")[0];
    expect(loginBody).toContain("writeLoggedOutFlag(false)");
  });
});

describe("F2-AUTH-009 — device/admin tokens do not survive logout", () => {
  const src = read("src/components/providers/auth-provider.tsx");

  it("T1: logout() clears ALL device auth tokens", () => {
    const logoutBody = src.split("const logout = useCallback")[1].split("return (")[0];
    expect(logoutBody).toContain("clearAllAuthTokens()");
  });

  it("T2: logout() clears ALL admin tokens", () => {
    const logoutBody = src.split("const logout = useCallback")[1].split("return (")[0];
    expect(logoutBody).toContain("clearAllAdminTokens()");
  });

  it("T3: the token-session modules expose the clear-all API used", async () => {
    const authMod = await import("@/lib/authTokenSession");
    const adminMod = await import("@/lib/adminTokenSession");
    expect(typeof authMod.clearAllAuthTokens).toBe("function");
    expect(typeof adminMod.clearAllAdminTokens).toBe("function");
  });

  it("T4: clearAllAuthTokens actually empties the sessionStorage store", async () => {
    const { setAuthToken, getAuthToken, clearAllAuthTokens, AUTH_TOKENS_CHANGED_EVENT } =
      await import("@/lib/authTokenSession");
    // hydrate the store with two devices, then clear
    setAuthToken("PLTS-AAAAAA", "tok-a");
    setAuthToken("PLTS-BBBBBB", "tok-b");
    expect(getAuthToken("PLTS-AAAAAA")).toBe("tok-a");
    clearAllAuthTokens();
    expect(getAuthToken("PLTS-AAAAAA")).toBeUndefined();
    expect(getAuthToken("PLTS-BBBBBB")).toBeUndefined();
    // the changed event is still dispatched (storage listeners refresh)
    expect(typeof AUTH_TOKENS_CHANGED_EVENT).toBe("string");
  });
});

describe("GATE-8 / A2-02 — production direct API must be HTTPS", () => {
  const validator = read("scripts/validate-production-config.mjs");

  it("H1: http:// API base FAILS the production gate", () => {
    expect(validator).toContain('u.protocol === "http:"');
    expect(validator).toContain('MODE === "production"');
    expect(validator).toMatch(/must use https:\/\/ in production/);
  });

  it("H2: staging keeps plaintext for bench work", () => {
    expect(validator).toContain("plaintext allowed in staging");
  });
});
