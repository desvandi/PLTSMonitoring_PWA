import { NextRequest } from 'next/server';
import { requireAuth, verifyCsrfToken } from '@/lib/auth';
import { changePassword, isMockAuthEnabled } from '@/lib/mockStore';
import { authFailure, fail, ok, serviceUnavailable } from '@/lib/apiResponse';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const auth = await requireAuth({ mutation: true });
  if (!auth.ok) return authFailure(auth);
  // [PARITY-4] Mock fail-closed: this Next.js route is DEMO NAMESPACE
  // ONLY — in production the authoritative data comes from the device /
  // GAS (NEXT_PUBLIC_API_BASE_URL or the MQTT provider), never from here.
  if (!isMockAuthEnabled()) {
    return serviceUnavailable(
      'Demo-only endpoint — configure the device/GAS source, or enable demo mode.',
    );
  }
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
