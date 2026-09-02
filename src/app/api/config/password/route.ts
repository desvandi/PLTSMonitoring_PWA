import { NextRequest } from 'next/server';
import { requireAuth, verifyCsrfToken } from '@/lib/auth';
import { changePassword } from '@/lib/mockStore';
import { ok, fail, unauthorized } from '@/lib/apiResponse';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (!auth.ok) return unauthorized(auth.message);
  if (!(await verifyCsrfToken(req))) return fail('Invalid CSRF token', 403);

  let body: { current?: string; next?: string };
  try {
    body = await req.json();
  } catch {
    return fail('Invalid JSON body');
  }
  if (!body.current || !body.next) return fail('Current and new password required');
  if (body.next.length < 8) return fail('New password must be at least 8 characters');
  if (body.next.length > 64) return fail('Password too long (max 64)');
  const success = changePassword(body.current, body.next);
  if (!success) return fail('Current password is incorrect', 403);
  return ok({ changed: true }, 'Password changed');
}
