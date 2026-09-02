import { NextRequest } from 'next/server';
import { requireAuth, verifyCsrfToken } from '@/lib/auth';
import { getFirmwareInfo } from '@/lib/mockStore';
import { ok, fail, unauthorized } from '@/lib/apiResponse';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (!auth.ok) return unauthorized(auth.message);
  if (!(await verifyCsrfToken(req))) return fail('Invalid CSRF token', 403);

  const info = getFirmwareInfo();
  return ok(
    {
      available: info.updateAvailable,
      latestVersion: info.latestAvailable,
      currentVersion: info.currentVersion,
    },
    info.updateAvailable ? 'Update available' : 'Firmware is up to date',
  );
}
