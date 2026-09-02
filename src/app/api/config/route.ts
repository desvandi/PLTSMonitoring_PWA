import { NextRequest } from 'next/server';
import { requireAuth, verifyCsrfToken } from '@/lib/auth';
import { getConfig, updateConfig } from '@/lib/mockStore';
import { ok, fail, unauthorized } from '@/lib/apiResponse';
import type { DeviceConfig } from '@/lib/types';

export const runtime = 'nodejs';

export async function GET() {
  const auth = await requireAuth();
  if (!auth.ok) return unauthorized(auth.message);
  return ok(getConfig());
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (!auth.ok) return unauthorized(auth.message);
  if (!(await verifyCsrfToken(req))) return fail('Invalid CSRF token', 403);

  let body: Partial<DeviceConfig> & { requestId?: string };
  try {
    body = await req.json();
  } catch {
    return fail('Invalid JSON body');
  }
  const { requestId: _requestId, ...patch } = body;
  void _requestId;

  // Validate battery capacity if provided
  if (patch.batteryCapacityAh !== undefined) {
    if (patch.batteryCapacityAh < 1 || patch.batteryCapacityAh > 10000) {
      return fail('Battery capacity must be 1-10000 Ah');
    }
  }
  if (patch.fullVoltage !== undefined && patch.lowVoltage !== undefined) {
    if (patch.fullVoltage <= patch.lowVoltage) {
      return fail('Full voltage must be greater than low voltage');
    }
  }

  const success = updateConfig(patch);
  if (!success) return fail('Failed to update config');
  return ok({ updated: true }, 'Config updated');
}
