import { NextRequest } from 'next/server';
import { requireAuth, verifyCsrfToken } from '@/lib/auth';
import { acknowledgeAlarm, isMockAuthEnabled } from '@/lib/mockStore';
import { authFailure, fail, notFound, ok, serviceUnavailable } from '@/lib/apiResponse';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: Promise<{ alarmId: string }> }) {
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
  const { alarmId } = await params;
  if (!alarmId) return fail('Missing alarmId');
  const success = acknowledgeAlarm(alarmId);
  if (!success) return notFound('Alarm not found or already cleared');
  return ok({ acknowledged: true }, 'Alarm acknowledged');
}
