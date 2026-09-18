// =============================================================================
// gate2-auth-hardening.test.ts — [GATE-2 REMEDIATION CONTRACT]
// -----------------------------------------------------------------------------
// AUDIT FINDINGS under test:
//
//  F6 (Phase 2 / Phase 1): getSession() defaulted a missing/unknown JWT role
//     to "operator" — a fail-open privilege escalation. A valid token with
//     no role claim received the HIGHEST privilege.
//     RULE: only an explicit known role ("operator" | "viewer") authenticates;
//     missing/unknown/null roles → UNAUTHENTICATED (fail-closed).
//
//  F2-AUTH-007 (Phase 2): createSession() returned the raw JWT bearer in the
//     JSON body ("token"), defeating the HttpOnly cookie.
//     RULE: the createSession() result contains ONLY { csrfToken, expiresAt,
//     username } — no bearer token field exists for JS/XSS/log capture.
//
//  F2-AUTH-008 (Phase 2): auth responses must be Cache-Control: no-store.
//     (Route-level headers are covered by source-shape assertions; the
//     session-object contract is behavioral here.)
// =============================================================================
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- mock next/headers cookies (in-memory cookie jar) ------------------------
type CookieJar = Map<string, string>;
let jar: CookieJar = new Map();

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => {
      jar.set(name, value);
    },
    delete: (name: string) => {
      jar.delete(name);
    },
  })),
}));

// --- revocation store: always verified clean ---------------------------------
vi.mock("@/lib/revocation-store", () => ({
  revokeJti: vi.fn(async () => true),
  verifyRevocation: vi.fn(async () => ({ revoked: false, verified: true })),
}));

// --- mockStore: authenticated mode --------------------------------------------
vi.mock("@/lib/mockStore", () => ({
  getJwtSecret: () => "test-secret-0123456789abcdef0123456789abcdef",
  isMockAuthEnabled: () => true,
}));

let signJwt: (payload: Record<string, unknown>, secret: string, ttl: number) => string;

beforeEach(async () => {
  jar = new Map();
  vi.resetModules();
  // [F6] import AFTER resetModules so every test gets a fresh module graph
  // (the auth module caches the secret provider binding at import time).
  const jwtMod = await import("@/lib/jwt");
  signJwt = jwtMod.signJwt as typeof signJwt;
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function importAuth() {
  const mod = await import("@/lib/auth");
  return mod;
}

async function bootstrap() {
  const mod = await importAuth();
  return mod;
}

describe("F6 — JWT role fail-closed (no operator default)", () => {
  const secret = "test-secret-0123456789abcdef0123456789abcdef";

  async function sessionWithToken(token: string) {
    const mod = await bootstrap();
    jar.set("plts_jwt", token);
    return mod.getSession();
  }

  it("F6-1: role=operator → authenticated as operator", async () => {
    const s = await sessionWithToken(
      signJwt({ sub: "op", jti: "j1", role: "operator" }, secret, 60),
    );
    expect(s.authenticated).toBe(true);
    expect(s.role).toBe("operator");
  });

  it("F6-2: role=viewer → authenticated as viewer (viewer policy applies)", async () => {
    const s = await sessionWithToken(
      signJwt({ sub: "vw", jti: "j2", role: "viewer" }, secret, 60),
    );
    expect(s.authenticated).toBe(true);
    expect(s.role).toBe("viewer");
  });

  it("F6-3: role MISSING → UNAUTHENTICATED (was: operator!)", async () => {
    const s = await sessionWithToken(
      signJwt({ sub: "anon", jti: "j3" }, secret, 60),
    );
    expect(s.authenticated).toBe(false);
    expect(s.role).toBeNull();
  });

  it("F6-4: role=unknown string → UNAUTHENTICATED", async () => {
    const s = await sessionWithToken(
      signJwt({ sub: "x", jti: "j4", role: "admin" }, secret, 60),
    );
    expect(s.authenticated).toBe(false);
  });

  it("F6-5: role=null → UNAUTHENTICATED", async () => {
    const s = await sessionWithToken(
      signJwt({ sub: "x", jti: "j5", role: null }, secret, 60),
    );
    expect(s.authenticated).toBe(false);
  });

  it("F6-6: requireAuth — a viewer token is FORBIDDEN (403), a roleless token is UNAUTHORIZED (401)", async () => {
    const mod = await bootstrap();
    // Viewer → 403
    jar.set("plts_jwt", signJwt({ sub: "vw", jti: "j6", role: "viewer" }, secret, 60));
    const viewerAuth = await mod.requireAuth();
    expect(viewerAuth.ok).toBe(false);
    if (!viewerAuth.ok) expect(viewerAuth.status).toBe(403);
    // Roleless → 401 (never operator!)
    jar.set("plts_jwt", signJwt({ sub: "anon", jti: "j7" }, secret, 60));
    const rolelessAuth = await mod.requireAuth();
    expect(rolelessAuth.ok).toBe(false);
    if (!rolelessAuth.ok) expect(rolelessAuth.status).toBe(401);
  });
});

describe("F2-AUTH-007 — no bearer token in the login/session response", () => {
  it("T1: createSession() result has NO token field (HttpOnly cookie only)", async () => {
    const mod = await bootstrap();
    const session = await mod.createSession("operator-user");
    expect(Object.keys(session).sort()).toEqual(["csrfToken", "expiresAt", "username"]);
    expect((session as Record<string, unknown>).token).toBeUndefined();
    expect((session as Record<string, unknown>).jwt).toBeUndefined();
  });

  it("T2: the JWT lands in the HttpOnly cookie, NOT in the result object", async () => {
    const mod = await bootstrap();
    const session = await mod.createSession("operator-user");
    const cookieToken = jar.get("plts_jwt");
    expect(typeof cookieToken).toBe("string");
    expect(cookieToken!.split(".")).toHaveLength(3);   // JWT shape
    // The cookie value must never equal anything in the result object.
    const values = Object.values(session as unknown as Record<string, unknown>);
    expect(values).not.toContain(cookieToken);
  });

  it("T3: the CSRF token is returned (the only credential the JS needs)", async () => {
    const mod = await bootstrap();
    const session = await mod.createSession("operator-user");
    expect(typeof session.csrfToken).toBe("string");
    expect(session.csrfToken.length).toBeGreaterThanOrEqual(32);
    expect(session.username).toBe("operator-user");
    expect(session.expiresAt).toBeGreaterThan(Date.now());
  });
});

describe("F2-AUTH-008 — source-shape: auth endpoints are no-store", () => {
  // Route handlers depend on the Next.js runtime; the CONTRACT here is the
  // committed source shape (the audit's regression-test discipline for
  // header policy).
  const read = async (p: string) => {
    const fs = await import("node:fs");
    return fs.readFileSync(p, "utf-8");
  };

  it("H1: /api/login sets private, no-store", async () => {
    const src = await read("src/app/api/login/route.ts");
    expect(src).toContain("private, no-store");
    expect(src).toMatch(/authJson\(session/);
  });

  it("H2: /api/logout sets private, no-store", async () => {
    const src = await read("src/app/api/logout/route.ts");
    expect(src).toContain("private, no-store");
  });

  it("H3: /api/session sets private, no-store", async () => {
    const src = await read("src/app/api/session/route.ts");
    expect(src).toContain("private, no-store");
  });

  it("H4: /api/mqtt/credentials sets private, no-store (PH6-S1-04)", async () => {
    const src = await read("src/app/api/mqtt/credentials/route.ts");
    expect(src).toContain("private, no-store");
  });
});
