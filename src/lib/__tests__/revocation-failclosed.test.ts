// =============================================================================
// revocation-failclosed.test.ts — [AUDIT p.492 REMEDIATION contract]
// -----------------------------------------------------------------------------
// AUDIT FINDING (p.492): JWT revocation failed OPEN when the shared store
// (Upstash Redis) was unreachable, and a process-local fallback silently
// remained when no shared store was configured in production. A stolen JWT
// stayed valid across Vercel instances until its TTL expired.
//
// REMEDIATION TRUTH RULES under test:
//   R1  Redis configured + unreachable → verifyRevocation returns
//       { revoked:false, verified:false } — the READ path may fail open
//       (documented), but the MUTATION path must fail CLOSED (503).
//   R2  The local cache is a POSITIVE-only revocation cache: a revocation
//       recorded before/during an outage still rejects the token.
//   R3  Redis reachable: EXISTS=1 → revoked (and positively cached);
//       EXISTS=0 → verified clean.
//   R4  No shared store configured in PRODUCTION → unverified (no silent
//       process-local fallback; mutations blocked). In non-production the
//       local Map is the documented single-instance authority → verified.
//   R5  requireAuth({ mutation:true }) returns 503 when verification is
//       unverified, and succeeds when the global check completes.
// =============================================================================
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_FETCH = globalThis.fetch;

function resetEnv() {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
}

beforeEach(() => {
  resetEnv();
  vi.resetModules();
});

afterEach(() => {
  resetEnv();
  Object.assign(process.env, { NODE_ENV: ORIGINAL_ENV.NODE_ENV || "test" });
  globalThis.fetch = ORIGINAL_FETCH;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function importStore() {
  return await import("../revocation-store");
}

function stubFetchReturning(result: number | null) {
  globalThis.fetch = (async () => ({
    ok: true,
    json: async () => ({ result }),
  })) as unknown as typeof fetch;
}

function stubFetchFailing() {
  globalThis.fetch = (async () => {
    throw new Error("simulated Upstash outage (connect ECONNREFUSED)");
  }) as unknown as typeof fetch;
}

describe("R1 — Redis unreachable: read fail-open, mutation decision unverified", () => {
  it("verifyRevocation → { revoked:false, verified:false }; isJtiRevoked → false (read)", async () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://example-upstash.internal";
    process.env.UPSTASH_REDIS_REST_TOKEN = "token";
    const store = await importStore();
    stubFetchFailing();

    const decision = await store.verifyRevocation("jti-outage-1");
    expect(decision).toEqual({ revoked: false, verified: false });

    // Read path: documented fail-open (bounded by TTL, mutations still closed)
    await expect(store.isJtiRevoked("jti-outage-1")).resolves.toBe(false);
  });
});

describe("R2 — positive-only local cache survives a store outage", () => {
  it("a revocation recorded while Redis is down still rejects the token", async () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://example-upstash.internal";
    process.env.UPSTASH_REDIS_REST_TOKEN = "token";
    const store = await importStore();
    stubFetchFailing();

    // Logout during the outage: Redis write fails, local positive copy kept.
    await store.revokeJti("jti-outage-2", Date.now() + 60_000);

    await expect(store.verifyRevocation("jti-outage-2")).resolves.toEqual({
      revoked: true,
      verified: true,
    });
    await expect(store.isJtiRevoked("jti-outage-2")).resolves.toBe(true);
  });

  it("a NEGATIVE answer is never cached — recovery re-checks globally", async () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://example-upstash.internal";
    process.env.UPSTASH_REDIS_REST_TOKEN = "token";
    const store = await importStore();
    stubFetchFailing();
    await store.verifyRevocation("jti-outage-3"); // unverified, not cached

    // Store recovers and says the token IS revoked → must be honored.
    stubFetchReturning(1);
    await expect(store.verifyRevocation("jti-outage-3")).resolves.toEqual({
      revoked: true,
      verified: true,
    });
  });
});

describe("R3 — Redis reachable", () => {
  it("EXISTS=1 → revoked (and positively cached for later outage reads)", async () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://example-upstash.internal";
    process.env.UPSTASH_REDIS_REST_TOKEN = "token";
    const store = await importStore();
    stubFetchReturning(1);

    await expect(store.verifyRevocation("jti-live-1")).resolves.toEqual({
      revoked: true,
      verified: true,
    });

    // Cached positively: an immediately following outage still rejects.
    stubFetchFailing();
    await expect(store.isJtiRevoked("jti-live-1")).resolves.toBe(true);
  });

  it("EXISTS=0 → verified clean", async () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://example-upstash.internal";
    process.env.UPSTASH_REDIS_REST_TOKEN = "token";
    const store = await importStore();
    stubFetchReturning(0);

    await expect(store.verifyRevocation("jti-live-2")).resolves.toEqual({
      revoked: false,
      verified: true,
    });
  });
});

describe("R4 — no shared store configured", () => {
  it("PRODUCTION → unverified (no silent process-local fallback)", async () => {
    Object.assign(process.env, { NODE_ENV: "production" });
    const store = await importStore();
    await expect(store.verifyRevocation("jti-nostore-1")).resolves.toEqual({
      revoked: false,
      verified: false,
    });
  });

  it("non-production → verified clean (documented single-instance authority)", async () => {
    Object.assign(process.env, { NODE_ENV: "test" });
    const store = await importStore();
    await expect(store.verifyRevocation("jti-nostore-2")).resolves.toEqual({
      revoked: false,
      verified: true,
    });
  });
});

describe("R5 — requireAuth({ mutation }) gate", () => {
  async function buildAuthMocks(jti: string, role: "operator" | "viewer") {
    // Real JWT signing so verifyJwt() accepts the token — we only stub the
    // transport (cookies) and the mode gate (mockStore).
    process.env.MOCK_USER = "engineer";
    process.env.MOCK_PASSWORD = "correct-horse-battery";
    process.env.JWT_SECRET = "x".repeat(48);

    const jwt = await import("../jwt");
    const SIGNED_TOKEN = jwt.signJwt(
      { sub: "engineer", jti, role },
      process.env.JWT_SECRET as string,
      3600,
    );

    vi.doMock("next/headers", () => ({
      cookies: async () => ({
        get: (name: string) =>
          name === "plts_jwt" ? { value: SIGNED_TOKEN } : undefined,
      }),
    }));
    vi.doMock("../mockStore", async (importOriginal) => {
      const orig = await importOriginal<typeof import("../mockStore")>();
      return {
        ...orig,
        isMockAuthEnabled: () => true,
        getJwtSecret: () => process.env.JWT_SECRET as string,
      };
    });
  }

  it("mutation: unverified revocation ⇒ 503 fail-closed", async () => {
    await buildAuthMocks("jti-gate-1", "operator");
    process.env.UPSTASH_REDIS_REST_URL = "https://example-upstash.internal";
    process.env.UPSTASH_REDIS_REST_TOKEN = "token";
    stubFetchFailing();

    const { requireAuth } = await import("../auth");
    const res = await requireAuth({ mutation: true });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(503);
      expect(res.message).toMatch(/fail-closed/i);
    }
  });

  it("read (default): unverified revocation still allowed (documented policy)", async () => {
    await buildAuthMocks("jti-gate-2", "operator");
    process.env.UPSTASH_REDIS_REST_URL = "https://example-upstash.internal";
    process.env.UPSTASH_REDIS_REST_TOKEN = "token";
    stubFetchFailing();

    const { requireAuth } = await import("../auth");
    const res = await requireAuth();
    expect(res.ok).toBe(true);
  });

  it("mutation: verified clean ⇒ allowed", async () => {
    await buildAuthMocks("jti-gate-3", "operator");
    process.env.UPSTASH_REDIS_REST_URL = "https://example-upstash.internal";
    process.env.UPSTASH_REDIS_REST_TOKEN = "token";
    stubFetchReturning(0);

    const { requireAuth } = await import("../auth");
    const res = await requireAuth({ mutation: true });
    expect(res.ok).toBe(true);
  });
});
