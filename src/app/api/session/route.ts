import { isMockAuthEnabled } from '@/lib/mockStore';
import { ok } from '@/lib/apiResponse';

export const runtime = 'nodejs';

export async function GET() {
  // Fail-closed: when mock auth disabled (production), return unauthenticated
  // session without calling getSession() (which would attempt JWT verify with
  // empty secret and log noise).
  const noStore = (data: unknown) => {
    const res = ok(data);
    // [GATE-2 / F2-AUTH-008 2026-09] session state is auth material — no-store.
    res.headers.set('Cache-Control', 'private, no-store');
    res.headers.set('Pragma', 'no-cache');
    return res;
  };
  if (!isMockAuthEnabled()) {
    return noStore({ isAuthenticated: false, username: null, expiresAt: null });
  }
  const { getSession } = await import('@/lib/auth');
  const session = await getSession();
  return noStore(session);
}
