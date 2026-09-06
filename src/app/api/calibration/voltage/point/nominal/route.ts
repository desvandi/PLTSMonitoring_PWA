import { NextRequest } from 'next/server';
import { requireAuth, verifyCsrfToken } from '@/lib/auth';
import { setVoltageCalibrationPoint, isMockAuthEnabled } from '@/lib/mockStore';
import { ok, fail, unauthorized, serviceUnavailable } from '@/lib/apiResponse';

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

  let body: { reference?: number; raw?: number; requestId?: string };
  try {
    body = await req.json();
  } catch {
    return fail('Invalid JSON body');
  }
  if (typeof body.reference !== 'number' || typeof body.raw !== 'number') {
    return fail('reference and raw are required (numbers)');
  }
  if (body.reference < 0 || body.reference > 100) {
    return fail('Reference voltage out of range (0-100V)');
  }

  const success = setVoltageCalibrationPoint('nominal', body.reference, body.raw);
  if (!success) return fail('Failed to set voltage calibration point');
  return ok({ updated: true }, 'Voltage calibration point saved');
}
