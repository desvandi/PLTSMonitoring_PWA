import { NextRequest } from 'next/server';
import { requireAuth, verifyCsrfToken } from '@/lib/auth';
import { importConfig, isMockAuthEnabled } from '@/lib/mockStore';
import { ok, fail, unauthorized, serviceUnavailable } from '@/lib/apiResponse';
import type { SystemConfig } from '@/lib/types';

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

  let body: SystemConfig;
  try {
    body = await req.json();
  } catch {
    return fail('Invalid JSON body');
  }
  if (!body.config || !body.calibration) {
    return fail('Missing required config fields (config, calibration)');
  }
  const success = importConfig(body);
  if (!success) return fail('Failed to import config');
  return ok({ imported: true }, 'Configuration imported');
}
