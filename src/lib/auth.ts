// =============================================================================
// Server-side auth helpers (mock API).
// -----------------------------------------------------------------------------
// All functions gracefully no-op (return unauthenticated / false) when mock
// auth is disabled in production. They never throw — callers receive a clean
// 401 that the frontend can handle as "not logged in".
//
// [audit-2 K-4 FIX] JWT revocation list added. Previously `destroySession`
// only cleared the cookie — the JWT itself remained valid until exp. An
// attacker who stole the JWT (XSS, log leak, shared machine) could keep
// using it after the user clicked "Logout". Now every issued JWT carries a
// `jti` (JWT ID), and `destroySession` adds the jti to an in-memory blacklist
// that `getSession` consults. Blacklist entries auto-expire when their JWT
// would have expired anyway (no unbounded growth).
// =============================================================================

import { cookies } from "next/headers";
import { verifyJwt, generateRandomToken, signJwt } from "@/lib/jwt";
import { getJwtSecret, isMockAuthEnabled } from "@/lib/mockStore";

export const JWT_COOKIE = "plts_jwt";
export const CSRF_COOKIE = "plts_csrf";
const SESSION_TTL_SECONDS = 3600; // 1 hour

// [audit-2 K-4] In-memory JWT revocation list (jti blacklist).
// Entries: jti -> exp (ms epoch). Auto-pruned on every consult.
// Note: This is process-local; in a multi-instance deployment (Vercel with
// multiple serverless instances), the blacklist is per-instance. For full
// coverage, move to a shared store (Upstash Redis, KV). For the demo / small
// deployment target (single instance), this is sufficient.
const revokedJtis = new Map<string, number>();

function pruneRevokedJtis(): void {
  const now = Date.now();
  for (const [jti, exp] of revokedJtis) {
    if (exp <= now) revokedJtis.delete(jti);
  }
}

export type AuthResult = {
  authenticated: boolean;
  username: string | null;
  expiresAt: number | null;
};

export async function getSession(): Promise<AuthResult> {
  if (!isMockAuthEnabled()) {
    return { authenticated: false, username: null, expiresAt: null };
  }
  const cookieStore = await cookies();
  const token = cookieStore.get(JWT_COOKIE)?.value;
  if (!token) return { authenticated: false, username: null, expiresAt: null };
  const secret = getJwtSecret();
  if (!secret) return { authenticated: false, username: null, expiresAt: null };
  const payload = verifyJwt(token, secret);
  if (!payload) return { authenticated: false, username: null, expiresAt: null };
  // [audit-2 K-4] Check revocation list. Auto-prune expired entries on consult.
  pruneRevokedJtis();
  if (typeof payload.jti === "string" && revokedJtis.has(payload.jti)) {
    return { authenticated: false, username: null, expiresAt: null };
  }
  return {
    authenticated: true,
    username: payload.sub ?? null,
    expiresAt: payload.exp,
  };
}

export async function requireAuth(): Promise<
  { ok: true; username: string } | { ok: false; status: 401; message: string }
> {
  const session = await getSession();
  if (!session.authenticated) {
    return { ok: false, status: 401, message: "Unauthorized" };
  }
  return { ok: true, username: session.username! };
}

export async function createSession(username: string) {
  const secret = getJwtSecret();
  if (!secret) {
    throw new Error(
      "Cannot create session: mock auth is disabled (no JWT_SECRET / DEMO_MODE).",
    );
  }
  // [audit-2 K-4] Generate a unique jti for this session so it can be revoked.
  const jti = generateRandomToken(32);
  const token = signSession(username, SESSION_TTL_SECONDS, secret, jti);
  const csrfToken = generateRandomToken(32);
  const cookieStore = await cookies();
  cookieStore.set(JWT_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  cookieStore.set(CSRF_COOKIE, csrfToken, {
    httpOnly: false, // client needs to read and resend in header
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  return {
    token,
    csrfToken,
    expiresAt: Date.now() + SESSION_TTL_SECONDS * 1000,
    username,
  };
}

export async function destroySession() {
  // [audit-2 K-4] Revoke the JWT before clearing the cookie. Extract jti
  // from the cookie, add to blacklist until exp. Without this, a stolen JWT
  // remains valid until its natural expiry.
  const cookieStore = await cookies();
  const token = cookieStore.get(JWT_COOKIE)?.value;
  if (token) {
    const secret = getJwtSecret();
    if (secret) {
      const payload = verifyJwt(token, secret);
      if (payload && typeof payload.jti === "string" && payload.exp) {
        revokedJtis.set(payload.jti, payload.exp);
      }
    }
  }
  cookieStore.delete(JWT_COOKIE);
  cookieStore.delete(CSRF_COOKIE);
}

export async function verifyCsrfToken(req: Request): Promise<boolean> {
  if (!isMockAuthEnabled()) return false;
  const cookieStore = await cookies();
  const cookieToken = cookieStore.get(CSRF_COOKIE)?.value;
  if (!cookieToken) return false;
  const headerToken = req.headers.get("X-CSRF-Token");
  if (!headerToken) return false;
  if (cookieToken.length !== headerToken.length) return false;
  // Constant-time compare — prevents timing attacks on token equality.
  let diff = 0;
  for (let i = 0; i < cookieToken.length; i++) {
    diff |= cookieToken.charCodeAt(i) ^ headerToken.charCodeAt(i);
  }
  return diff === 0;
}

function signSession(username: string, ttlSeconds: number, secret: string, jti: string) {
  return signJwt({ sub: username, jti }, secret, ttlSeconds);
}
