import { NextRequest } from 'next/server';
import { destroySession, verifyCsrfToken } from '@/lib/auth';
import { ok, fail } from '@/lib/apiResponse';

export const runtime = 'nodejs';

// POST /api/logout — CSRF-protected (logout CSRF is a real attack vector).
export async function POST(req: NextRequest) {
  if (!(await verifyCsrfToken(req))) return fail('Invalid CSRF token', 403);
  await destroySession();
  const res = ok({ success: true }, 'Logged out');
  // [GATE-2 / F2-AUTH-008 2026-09] auth lifecycle responses are never cached.
  res.headers.set('Cache-Control', 'private, no-store');
  res.headers.set('Pragma', 'no-cache');
  return res;
}
