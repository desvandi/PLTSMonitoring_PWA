import { NextRequest } from 'next/server';
import { requireAuth, verifyCsrfToken } from '@/lib/auth';
import { getStore, updateDeviceConfig } from '@/lib/mockStore';
import { ok, fail, unauthorized } from '@/lib/apiResponse';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (!auth.ok) return unauthorized(auth.message);
  if (!(await verifyCsrfToken(req))) return fail('Invalid CSRF token', 403);

  let body: { deviceName?: string; siteName?: string; timezone?: string };
  try {
    body = await req.json();
  } catch {
    return fail('Invalid JSON body');
  }
  if (body.deviceName !== undefined && (body.deviceName.length < 1 || body.deviceName.length > 64)) {
    return fail('Device name must be 1-64 characters');
  }
  if (body.siteName !== undefined && (body.siteName.length < 1 || body.siteName.length > 64)) {
    return fail('Site name must be 1-64 characters');
  }
  if (body.timezone !== undefined) {
    try {
      Intl.DateTimeFormat('en-US', { timeZone: body.timezone });
    } catch {
      return fail('Invalid timezone (must be IANA, e.g., Asia/Jakarta)');
    }
  }

  const success = updateDeviceConfig({
    deviceName: body.deviceName,
    siteName: body.siteName,
    timezone: body.timezone,
  });
  if (!success) return fail('Failed to update device config');
  const store = await getStore();
  return ok(
    { updated: true, deviceName: store.deviceName, siteName: store.siteName, timezone: store.timezone },
    'Device config updated',
  );
}
