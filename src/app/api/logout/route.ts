import { NextRequest } from 'next/server';
import { destroySession, verifyCsrfToken } from '@/lib/auth';
import { ok, fail } from '@/lib/apiResponse';

export const runtime = 'nodejs';

// POST /api/logout — CSRF-protected (logout CSRF is a real attack vector).
export async function POST(req: NextRequest) {
  if (!(await verifyCsrfToken(req))) return fail('Invalid CSRF token', 403);
  await destroySession();
  return ok({ success: true }, 'Logged out');
}
