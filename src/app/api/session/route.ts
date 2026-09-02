import { isMockAuthEnabled } from '@/lib/mockStore';
import { ok } from '@/lib/apiResponse';

export const runtime = 'nodejs';

export async function GET() {
  // Fail-closed: when mock auth disabled (production), return unauthenticated
  // session without calling getSession() (which would attempt JWT verify with
  // empty secret and log noise).
  if (!isMockAuthEnabled()) {
    return ok({ isAuthenticated: false, username: null, expiresAt: null });
  }
  const { getSession } = await import('@/lib/auth');
  const session = await getSession();
  return ok(session);
}
