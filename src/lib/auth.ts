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
// `jti` (JWT ID), and `destroySession` adds the jti to a blacklist
// that `getSession` consults. Blacklist entries auto-expire when their JWT
// would have expired anyway (no unbounded growth).
//
// [AUDIT p.479 REMEDIATION 2026-09] The blacklist moved from a process-local
// Map to a SHARED store (Upstash Redis REST when configured; in-memory
// fallback otherwise) — logout revocation is now GLOBAL across Vercel
// serverless instances, not per-instance. See lib/revocation-store.ts.
//
// [AUDIT p.484 follow-up] The PWA session JWT now carries an explicit
// `role: "operator"` claim, and requireAuth() enforces it: viewer-scoped
// tokens (should they ever exist server-side) are rejected with 403 on EVERY
// route that calls requireAuth — role enforcement is not navigation-only.
// =============================================================================

import { cookies } from "next/headers";
import { verifyJwt, generateRandomToken, signJwt } from "@/lib/jwt";
import { getJwtSecret, isMockAuthEnabled } from "@/lib/mockStore";
import { revokeJti, isJtiRevoked } from "@/lib/revocation-store";

export const JWT_COOKIE = "plts_jwt";
export const CSRF_COOKIE = "plts_csrf";
const SESSION_TTL_SECONDS = 3600; // 1 hour

// [audit-2 K-4 → p.479] The revoked-jti list now lives in the SHARED store
// (Upstash Redis REST when configured; process-local fallback otherwise).
// See lib/revocation-store.ts for the availability policy.

export type AuthResult = {
  authenticated: boolean;
  username: string | null;
  expiresAt: number | null;
  role: "operator" | "viewer" | null;
};

export async function getSession(): Promise<AuthResult> {
  if (!isMockAuthEnabled()) {
    return { authenticated: false, username: null, expiresAt: null, role: null };
  }
  const cookieStore = await cookies();
  const token = cookieStore.get(JWT_COOKIE)?.value;
  if (!token) return { authenticated: false, username: null, expiresAt: null, role: null };
  const secret = getJwtSecret();
  if (!secret) return { authenticated: false, username: null, expiresAt: null, role: null };
  const payload = verifyJwt(token, secret);
  if (!payload) return { authenticated: false, username: null, expiresAt: null, role: null };
  // [audit-2 K-4 / p.479] Shared revocation check — consults the shared store
  // (Redis) so an instance that never saw the logout still rejects the JWT.
  if (typeof payload.jti === "string" && (await isJtiRevoked(payload.jti))) {
    return { authenticated: false, username: null, expiresAt: null, role: null };
  }
  return {
    authenticated: true,
    username: payload.sub ?? null,
    expiresAt: payload.exp,
    role: (payload.role as "operator" | "viewer" | undefined) ?? "operator",
  };
}

export async function requireAuth(): Promise<
  { ok: true; username: string } | { ok: false; status: 401 | 403; message: string }
> {
  const session = await getSession();
  if (!session.authenticated) {
    return { ok: false, status: 401, message: "Unauthorized" };
  }
  // [p.484 follow-up] Role enforcement at the API boundary — a viewer-scoped
  // token can never pass requireAuth, so EVERY mutation route (and read
  // route) that uses this gate is operator-gated by construction.
  if (session.role === "viewer") {
    return { ok: false, status: 403, message: "Forbidden — viewer scope cannot use this endpoint" };
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
  // [audit-2 K-4 / p.479] Revoke the JWT in the SHARED store before clearing
  // the cookie. Extract jti from the cookie and publish it globally (Redis)
  // so EVERY serverless instance rejects the token from now on — not just
  // the instance that happened to serve the logout request.
  const cookieStore = await cookies();
  const token = cookieStore.get(JWT_COOKIE)?.value;
  if (token) {
    const secret = getJwtSecret();
    if (secret) {
      const payload = verifyJwt(token, secret);
      if (payload && typeof payload.jti === "string" && payload.exp) {
        await revokeJti(payload.jti, payload.exp);
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
  // [p.484 follow-up] Explicit operator role claim — PWA logins are
  // operator-scope by construction (single-admin device model); viewer
  // sessions (MQTT/GAS) never receive a PWA JWT.
  return signJwt({ sub: username, jti, role: "operator" }, secret, ttlSeconds);
}
