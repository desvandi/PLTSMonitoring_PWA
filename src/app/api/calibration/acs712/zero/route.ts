import { NextRequest } from 'next/server';
import { requireAuth, verifyCsrfToken } from '@/lib/auth';
import { acs712ZeroCalibrate } from '@/lib/mockStore';
import { ok, fail, unauthorized } from '@/lib/apiResponse';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (!auth.ok) return unauthorized(auth.message);
  if (!(await verifyCsrfToken(req))) return fail('Invalid CSRF token', 403);
  // Body may contain requestId for transaction journal dedup — not used here.
  try {
    await req.json();
  } catch {
    // ignore — body is optional
  }
  const result = acs712ZeroCalibrate();
  if (!result.updated) return fail('Failed to perform ACS712 zero-calibration');
  return ok(result, `ACS712 zero-calibration complete (offset=${result.newOffset})`);
}
