import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getEvents, isMockAuthEnabled } from '@/lib/mockStore';
import { ok, unauthorized, serviceUnavailable } from '@/lib/apiResponse';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
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
  const url = new URL(req.url);
  const from = url.searchParams.get('from') ? Number(url.searchParams.get('from')) : undefined;
  const to = url.searchParams.get('to') ? Number(url.searchParams.get('to')) : undefined;
  const limit = url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : undefined;
  const events = getEvents(from, to, limit);
  return ok({ events, total: events.length });
}
