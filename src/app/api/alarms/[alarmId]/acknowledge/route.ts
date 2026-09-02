import { NextRequest } from 'next/server';
import { requireAuth, verifyCsrfToken } from '@/lib/auth';
import { acknowledgeAlarm } from '@/lib/mockStore';
import { ok, fail, unauthorized, notFound } from '@/lib/apiResponse';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: Promise<{ alarmId: string }> }) {
  const auth = await requireAuth();
  if (!auth.ok) return unauthorized(auth.message);
  if (!(await verifyCsrfToken(req))) return fail('Invalid CSRF token', 403);
  const { alarmId } = await params;
  if (!alarmId) return fail('Missing alarmId');
  const success = acknowledgeAlarm(alarmId);
  if (!success) return notFound('Alarm not found or already cleared');
  return ok({ acknowledged: true }, 'Alarm acknowledged');
}
