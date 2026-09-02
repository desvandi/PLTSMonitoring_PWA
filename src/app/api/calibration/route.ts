import { NextRequest } from 'next/server';
import { requireAuth, verifyCsrfToken } from '@/lib/auth';
import { getCalibration, updateCalibration } from '@/lib/mockStore';
import { ok, fail, unauthorized } from '@/lib/apiResponse';
import type { Calibration } from '@/lib/types';

export const runtime = 'nodejs';

export async function GET() {
  const auth = await requireAuth();
  if (!auth.ok) return unauthorized(auth.message);
  return ok(getCalibration());
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (!auth.ok) return unauthorized(auth.message);
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
