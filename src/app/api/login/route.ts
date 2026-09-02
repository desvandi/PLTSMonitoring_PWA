import { NextRequest } from 'next/server';
import { getStore, verifyCredentials, isMockAuthEnabled } from '@/lib/mockStore';
import { createSession } from '@/lib/auth';
import { ok, fail, unauthorized } from '@/lib/apiResponse';

export const runtime = 'nodejs';

// Simple in-memory rate limiter
const rateMap = new Map<string, { count: number; firstAt: number; blockedUntil: number }>();
const MAX_ATTEMPTS = 5;
const BLOCK_MS = 60_000;
// [AUDIT 2026-08-28 G14] Entri rate-limit kini dipangkas: tanpa ini, entri IP
// yang tak pernah sukses login menumpuk selamanya (kebocoran memori pelan di
// server long-running). Jendela 15 menit >> blokir 60 detik.
const RATE_ENTRY_TTL_MS = 15 * 60_000;

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
    if (e.count >= MAX_ATTEMPTS) {
      e.blockedUntil = now + BLOCK_MS;
      e.count = 0;
    }
    return unauthorized('Invalid username or password');
  }

  rateMap.delete(ip);
  const session = await createSession(username);
  await getStore();
  return ok(session, 'Login successful');
}
