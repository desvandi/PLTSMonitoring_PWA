import { NextRequest } from 'next/server';
import { getStore, verifyCredentials, isMockAuthEnabled } from '@/lib/mockStore';
import { createSession } from '@/lib/auth';
import { ok, fail, unauthorized } from '@/lib/apiResponse';

export const runtime = 'nodejs';

// Simple in-memory rate limiter
const rateMap = new Map<string, { count: number; firstAt: number; blockedUntil: number }>();
// [audit-2 S-16 FIX] Progressive backoff: was fixed 5 attempts → 60s lock.
// Sustained brute force could do 5 attempts/min = 7200/hour. Now escalating:
//   5 fails  → 60s lock
//   10 fails → 5min lock
//   20 fails → 30min lock
//   40 fails → 2h lock (cap)
function getLockDurationMs(consecutiveFailures: number): number {
  if (consecutiveFailures >= 40) return 2 * 60 * 60_000;   // 2 hours
  if (consecutiveFailures >= 20) return 30 * 60_000;        // 30 minutes
  if (consecutiveFailures >= 10) return 5 * 60_000;         // 5 minutes
  if (consecutiveFailures >= 5)  return 60_000;             // 60 seconds
  return 0;
}
const RATE_ENTRY_TTL_MS = 2 * 60 * 60_000;  // 2 hours (matches max lock)

function pruneStaleRateEntries(now: number): void {
  for (const [ip, e] of rateMap) {
    if (e.blockedUntil < now && now - e.firstAt > RATE_ENTRY_TTL_MS) {
      rateMap.delete(ip);
    }
  }
}

export async function POST(req: NextRequest) {
  // Fail-closed: if mock auth is disabled (production MQTT-only), return graceful 403.
  if (!isMockAuthEnabled()) {
    return fail(
      'LAN mode (mock API) is disabled in production. Use MQTT mode below to connect to your ESP32, or set DEMO_MODE=true in your env vars to enable the demo.',
      403,
    );
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const now = Date.now();
  pruneStaleRateEntries(now);
  const entry = rateMap.get(ip);
  if (entry && entry.blockedUntil > now) {
    return fail('Too many attempts. Try again later.', 429);
  }

  let body: { username?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return fail('Invalid JSON body');
  }
  const username = (body.username ?? '').trim();
  const password = body.password ?? '';

  if (!username || !password) {
    return fail('Username and password required');
  }

  await getStore(); // ensure initialized
  const valid = verifyCredentials(username, password);
  if (!valid) {
    let e = rateMap.get(ip);
    if (!e) {
      e = { count: 0, firstAt: now, blockedUntil: 0 };
      rateMap.set(ip, e);
    }
    e.count++;
    const lockMs = getLockDurationMs(e.count);
    if (lockMs > 0) {
      e.blockedUntil = now + lockMs;
      // Don't reset count — keep escalating across lock windows.
      // Count is only reset on successful login (rateMap.delete below).
    }
    return unauthorized('Invalid username or password');
  }

  rateMap.delete(ip);
  const session = await createSession(username);
  await getStore();
  return ok(session, 'Login successful');
}
