import { requireAuth } from '@/lib/auth';
import { getActiveAlarms, getAlarmHistory, isMockAuthEnabled } from '@/lib/mockStore';
import { ok, unauthorized, serviceUnavailable } from '@/lib/apiResponse';

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
  return ok({ active: getActiveAlarms(), history: getAlarmHistory() });
}
