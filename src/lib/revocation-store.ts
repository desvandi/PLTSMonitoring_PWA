// =============================================================================
// revocation-store — shared JWT revocation list (audit p.479 REMEDIATION).
// -----------------------------------------------------------------------------
// PROBLEM: the revoked-JTI blacklist lived in a process-local Map. On a
// multi-instance deployment (Vercel serverless may run several concurrent
// instances), logout on instance A did not propagate to instance B — a
// stolen JWT stayed accepted on B until its natural expiry (up to 1 h).
//
// REMEDIATION: revocations now go to a SHARED store:
//   - Upstash Redis (REST) when UPSTASH_REDIS_REST_URL + _TOKEN are set —
//     works on Vercel serverless with zero dependencies (plain fetch).
//   - In-memory fallback (single-instance semantics) otherwise, with a
//     one-time warning — honest about the residual limitation.
//
// Availability policy (documented, deliberate): if Redis is unreachable on
// the READ path (isJtiRevoked), the check fails OPEN with an error log —
// bricking authentication for a Redis outage would trade a bounded
// revocation window (≤ SESSION_TTL) for total availability loss. The WRITE
// path (revokeJti) retries not; failures surface in logs, and the JWT still
// expires naturally within the session TTL.
//
// Keys: `plts:revoked:<jti>` with EXPIRE = seconds until the JWT's own exp
// (no unbounded growth, same contract as the old in-memory list).
// =============================================================================

const REVOKED_PREFIX = "plts:revoked:";

const upstashUrl = process.env.UPSTASH_REDIS_REST_URL?.trim() || "";
const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN?.trim() || "";
const UPSTASH_CONFIGURED = upstashUrl.length > 0 && upstashToken.length > 0;

// In-memory fallback — also the effective store when Upstash is not
// configured (single-instance / local dev semantics).
const localRevoked = new Map<string, number>();
let warnedLocalOnly = false;

function warnLocalOnlyOnce(): void {
  if (warnedLocalOnly) return;
  warnedLocalOnly = true;
  console.warn(
    "[revocation-store] UPSTASH_REDIS_REST_URL/TOKEN not configured — " +
      "JWT revocation is PROCESS-LOCAL. On multi-instance deployments " +
      "(Vercel) logout revocation is NOT global; a stolen JWT remains " +
      "valid on other instances until expiry (audit p.479 residual). " +
      "Configure an Upstash Redis REST database for full coverage.",
  );
}

function pruneLocal(): void {
  const now = Date.now();
  for (const [jti, exp] of localRevoked) {
    if (exp <= now) localRevoked.delete(jti);
  }
}

/** Execute a single Upstash REST command (RESP JSON array protocol). */
async function upstashCommand<T>(command: (string | number)[]): Promise<T | null> {
  try {
    const res = await fetch(upstashUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${upstashToken}`,
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
 */
export async function revokeJti(jti: string, expMs: number): Promise<void> {
  if (!jti) return;
  const ttlSec = Math.max(1, Math.floor((expMs - Date.now()) / 1000));
  if (UPSTASH_CONFIGURED) {
    const ok = await upstashCommand<number>(["SET", `${REVOKED_PREFIX}${jti}`, "1", "EX", ttlSec]);
    if (ok === null) {
      // Redis failed — keep the local copy so THIS instance at least
      // revokes, and log loudly (other instances may not).
      console.error(
        "[revocation-store] Shared-store revoke FAILED — falling back to " +
          "process-local entry only. Logout revocation may not be global.",
      );
    }
  } else {
    warnLocalOnlyOnce();
  }
  // Local copy always (fast path + fallback when Redis is down/unset).
  localRevoked.set(jti, expMs);
}

/** Has this jti been revoked? (auto-prunes the local list on consult) */
export async function isJtiRevoked(jti: string): Promise<boolean> {
  if (!jti) return false;
  pruneLocal();
  if (localRevoked.has(jti)) return true;
  if (!UPSTASH_CONFIGURED) {
    warnLocalOnlyOnce();
    return false;
  }
  const exists = await upstashCommand<number>(["EXISTS", `${REVOKED_PREFIX}${jti}`]);
  // exists === null → Redis unreachable: fail-open (documented availability
  // policy above). exists === 1 → revoked (cache it locally to short-circuit
  // future lookups for this request path).
  if (exists === 1) {
    localRevoked.set(jti, Date.now() + 60_000);
    return true;
  }
  return false;
}

/** Test/ops helper — drop everything (local list only; Redis keys expire). */
export function clearLocalRevocationList(): void {
  localRevoked.clear();
}
