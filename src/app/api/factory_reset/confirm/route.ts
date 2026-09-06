import { NextRequest } from 'next/server';
import { requireAuth, verifyCsrfToken } from '@/lib/auth';
import { factoryReset, isMockAuthEnabled } from '@/lib/mockStore';
import { ok, fail, unauthorized, serviceUnavailable } from '@/lib/apiResponse';
import { resetTokens } from '../prepare/route';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (!auth.ok) return unauthorized(auth.message);
  // [PARITY-4] Mock fail-closed: this Next.js route is DEMO NAMESPACE
  // ONLY — in production the authoritative data comes from the device /
  // GAS (NEXT_PUBLIC_API_BASE_URL or the MQTT provider), never from here.
  if (!isMockAuthEnabled()) {
    return serviceUnavailable(
      'Demo-only endpoint — configure the device/GAS source, or enable demo mode.',
    );
  }
  if (!(await verifyCsrfToken(req))) return fail('Invalid CSRF token', 403);

  let body: { token?: string; confirm?: string };
  try {
    body = await req.json();
  } catch {
    return fail('Invalid JSON body');
  }
  if (!body.token) return fail('Missing reset token');
  if (body.confirm !== 'RESET') return fail('Confirmation string must be "RESET"');

  const expiresAt = resetTokens.get(body.token);
  if (!expiresAt) return fail('Invalid reset token', 403);
  if (Date.now() > expiresAt) {
    resetTokens.delete(body.token);
    return fail('Reset token expired', 403);
  }
  resetTokens.delete(body.token);
  const success = factoryReset();
  if (!success) return fail('Factory reset failed');
  return ok({ reset: true }, 'Factory reset complete. System rebooting.');
}
