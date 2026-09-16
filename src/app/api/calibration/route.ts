import { NextRequest } from 'next/server';
import { requireAuth, verifyCsrfToken } from '@/lib/auth';
import { getCalibration, updateCalibration, isMockAuthEnabled } from '@/lib/mockStore';
import { authFailure, fail, ok, serviceUnavailable, unauthorized } from '@/lib/apiResponse';
import type { Calibration } from '@/lib/types';

export const runtime = 'nodejs';

export async function GET() {
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
  return ok(getCalibration());
}

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

  let body: Partial<Calibration> & { requestId?: string };
  try {
    body = await req.json();
  } catch {
    return fail('Invalid JSON body');
  }
  const { requestId: _requestId, ...patch } = body;
  void _requestId;

  // Validate offsets if provided
  if (patch.acs712Sensitivity !== undefined && (patch.acs712Sensitivity <= 0 || patch.acs712Sensitivity > 1)) {
    return fail('ACS712 sensitivity must be in (0, 1] V/A');
  }
  if (patch.sht31TempOffset !== undefined && Math.abs(patch.sht31TempOffset) > 10) {
    return fail('SHT31 temp offset must be within ±10 °C');
  }

  const success = updateCalibration(patch);
  if (!success) return fail('Failed to update calibration');
  return ok({ updated: true }, 'Calibration updated');
}
