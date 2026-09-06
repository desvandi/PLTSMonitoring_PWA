import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getLogsSnapshot, isMockAuthEnabled } from '@/lib/mockStore';
import { ok, unauthorized, serviceUnavailable } from '@/lib/apiResponse';
import type { LogType } from '@/lib/types';

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
  const type = url.searchParams.get('type') as LogType | 'all' | null;
  const limitParam = url.searchParams.get('limit');
  const sinceParam = url.searchParams.get('since');

  let logs = getLogsSnapshot();
  if (type && type !== 'all') {
    logs = logs.filter((l) => l.type === type);
  }
  if (sinceParam) {
    const since = Number(sinceParam);
    if (!isNaN(since)) logs = logs.filter((l) => l.timestamp >= since);
  }
  const limit = limitParam ? Number(limitParam) : 200;
  if (!isNaN(limit) && limit > 0) {
    logs = logs.slice(0, limit);
  }
  return ok({ logs, total: logs.length });
}
