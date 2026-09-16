// =============================================================================
// revocation-store — shared JWT revocation list (audit p.479 REMEDIATION,
// p.492 RESIDUAL FIX 2026-09-16).
// -----------------------------------------------------------------------------
// PROBLEM (p.479): the revoked-JTI blacklist lived in a process-local Map. On
// a multi-instance deployment (Vercel serverless may run several concurrent
// instances), logout on instance A did not propagate to instance B.
//
// REMEDIATION (p.479): revocations go to a SHARED store — Upstash Redis (REST)
// when UPSTASH_REDIS_REST_URL + _TOKEN are set (zero-dependency fetch).
//
// RESIDUAL (p.492): the read policy used to fail OPEN when Redis was
// unreachable ("Redis down → JWT still valid"), which violated the security
// invariant:
//
//     "Logout/revocation must hold across ALL Vercel instances."
//
// POLICY (p.492 fix — matches the auditor's remediation):
//   - verifyRevocation(jti) returns a TRI-STATE decision:
//       { revoked: true,  verified: true  }  → token is revoked
//       { revoked: false, verified: true  }  → token is clean (globally checked)
//       { revoked: false, verified: false }  → shared store UNREACHABLE /
//                                              not configured in production
//   - READ path (telemetry/status views): fail-open is allowed, but only the
//     POSITIVE local revocation cache is consulted — a cached revocation
//     still rejects during an outage (auditor-sanctioned alternative).
//   - MUTATION path (OTA/config/calibration/reboot/factory-reset/relay/ack):
//     fail-CLOSED. `requireAuth({ mutation: true })` returns 503 when
//     verified === false. A stolen JWT must NOT gain mutation access merely
//     because the revocation database is down (auditor's primary requirement).
//   - Process-local fallback is ONLY authoritative in non-production
//     (dev/demo, single instance, documented). In production, no shared
//     store ⇒ unverified ⇒ mutations blocked.
//
// Keys: `plts:revoked:<jti>` with EXPIRE = seconds until the JWT's own exp
// (no unbounded growth, same contract as the old in-memory list).
// =============================================================================

const REVOKED_PREFIX = "plts:revoked:";

/** How long a POSITIVE revocation hit is cached locally (ms). Positive-only:
 *  a negative answer is never cached, so a later successful global check is
 *  always authoritative. */
const POSITIVE_CACHE_MS = 60_000;

const IS_PRODUCTION = process.env.NODE_ENV === "production";

function upstashUrl(): string {
  return (process.env.UPSTASH_REDIS_REST_URL || "").trim();
}
function upstashToken(): string {
  return (process.env.UPSTASH_REDIS_REST_TOKEN || "").trim();
}
function upstashConfigured(): boolean {
  return upstashUrl().length > 0 && upstashToken().length > 0;
}

// In-memory POSITIVE revocation cache. In non-production this doubles as the
// authoritative single-instance store; in production it is strictly a
// positive-only cache — it can never make a revoked token look clean.
const localRevoked = new Map<string, number>();
let warnedLocalOnly = false;

function warnLocalOnlyOnce(): void {
  if (warnedLocalOnly) return;
  warnedLocalOnly = true;
  if (IS_PRODUCTION) {
    console.error(
      "[revocation-store] UPSTASH_REDIS_REST_URL/TOKEN not configured in " +
        "production — global revocation verification is UNAVAILABLE. Mutations " +
        "will fail closed (503) per audit p.492. Configure an Upstash Redis " +
        "REST database to restore the authorization boundary.",
    );
  } else {
    console.warn(
      "[revocation-store] UPSTASH_REDIS_REST_URL/TOKEN not configured — " +
        "JWT revocation is PROCESS-LOCAL (dev/demo, single-instance semantics; " +
        "audit p.479/p.492). Fine for local development only.",
    );
  }
}

function pruneLocal(): void {
  const now = Date.now();
  for (const [jti, exp] of localRevoked) {
    if (exp <= now) localRevoked.delete(jti);
  }
}

/** Execute a single Upstash REST command (RESP JSON array protocol).
 *  Returns null on ANY failure (network/timeout/HTTP error) — the caller
 *  decides the fail-open/fail-closed consequence. */
async function upstashCommand<T>(command: (string | number)[]): Promise<T | null> {
  try {
    const res = await fetch(upstashUrl(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${upstashToken()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(command),
      cache: "no-store",
      // Keep the auth path fast — revocation lookups must not hang requests.
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) {
      console.error(`[revocation-store] Upstash HTTP ${res.status}`);
      return null;
    }
    const json = (await res.json()) as { result?: T } | null;
    return json?.result ?? null;
  } catch (err) {
    console.error("[revocation-store] Upstash unreachable:", err);
    return null;
  }
}

/**
 * Add a jti to the revocation list. `expMs` is the JWT's own expiry (ms
 * epoch) — the entry self-deletes at that time (Redis EXPIRES / prune).
 *
 * Write-path availability policy (unchanged by p.492): a failed Redis write
 * does NOT abort the logout — the cookie is still cleared and the local
 * positive cache still rejects on THIS instance. The exposure window is
 * bounded by the JWT TTL (≤ 1 h) and is loudly logged; the READ path is
 * where the fail-closed invariant matters.
 */
export async function revokeJti(jti: string, expMs: number): Promise<void> {
  if (!jti) return;
  const ttlSec = Math.max(1, Math.floor((expMs - Date.now()) / 1000));
  if (upstashConfigured()) {
    const ok = await upstashCommand<number>([
      "SET",
      `${REVOKED_PREFIX}${jti}`,
      "1",
      "EX",
      ttlSec,
    ]);
    if (ok === null) {
      console.error(
        "[revocation-store] Shared-store revoke FAILED — logout revocation " +
          "is DEGRADED (process-local only, bounded by JWT TTL). If this " +
          "persists, treat the session as suspect and rotate credentials " +
          "(audit p.492 write-path policy).",
      );
    }
  } else {
    warnLocalOnlyOnce();
  }
  // Local copy always (fast path + positive cache when Redis is down/unset).
  localRevoked.set(jti, expMs);
}

/** Tri-state revocation decision — see the policy block at the top. */
export type RevocationDecision = {
  revoked: boolean;
  /** false ⇒ the GLOBAL check could not be completed (store unreachable, or
   *  no shared store configured in production). Mutations must fail closed. */
  verified: boolean;
};

const CLEAN_VERIFIED: RevocationDecision = { revoked: false, verified: true };
const CLEAN_UNVERIFIED: RevocationDecision = { revoked: false, verified: false };
const REVOKED_VERIFIED: RevocationDecision = { revoked: true, verified: true };

/**
 * The single verification primitive for p.492. Both the read- and
 * mutation-path helpers below are derived from this decision.
 */
export async function verifyRevocation(jti: string): Promise<RevocationDecision> {
  if (!jti) return CLEAN_VERIFIED;
  pruneLocal();

  // 1) Positive local cache — authoritative even during a store outage.
  if (localRevoked.has(jti)) return REVOKED_VERIFIED;

  // 2) No shared store configured:
  //    - production: NO silent process-local fallback (p.492 residual) —
  //      report unverified so mutations fail closed.
  //    - dev/demo: the local Map IS the single-instance authority.
  if (!upstashConfigured()) {
    warnLocalOnlyOnce();
    return IS_PRODUCTION ? CLEAN_UNVERIFIED : CLEAN_VERIFIED;
  }

  // 3) Global check via Redis. A negative answer is NEVER cached.
  const exists = await upstashCommand<number>(["EXISTS", `${REVOKED_PREFIX}${jti}`]);
  if (exists === null) {
    // Store unreachable: only the positive cache above can still save us.
    return CLEAN_UNVERIFIED;
  }
  if (exists === 1) {
    localRevoked.set(jti, Date.now() + POSITIVE_CACHE_MS);
    return REVOKED_VERIFIED;
  }
  return CLEAN_VERIFIED;
}

/**
 * READ path (views/telemetry): boolean-only view of the decision with the
 * documented fail-open policy (positive cache still applies). Fail-open here
 * is bounded: read-only surface, session TTL ≤ 1 h, and mutations remain
 * fail-closed via requireAuth({ mutation: true }).
 */
export async function isJtiRevoked(jti: string): Promise<boolean> {
  return (await verifyRevocation(jti)).revoked;
}

/** Test/ops helper — drop everything (local cache only; Redis keys expire). */
export function clearLocalRevocationList(): void {
  localRevoked.clear();
}
