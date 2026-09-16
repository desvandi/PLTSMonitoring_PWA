import { NextRequest } from 'next/server';
import { requireAuth, verifyCsrfToken } from '@/lib/auth';
import { getDailyEnergy, isMockAuthEnabled } from '@/lib/mockStore';
import { authFailure, fail, ok, serviceUnavailable } from '@/lib/apiResponse';
import { aggregateDaily } from '@/lib/reports';

export const runtime = 'nodejs';

// POST /api/reports — fetch aggregated daily energy records.
// Body: { range: 'daily'|'weekly'|'monthly'|'custom', from: ms, to: ms, format: 'csv'|'pdf'|'json' }
// [P0-006 REMEDIATION 2026-08] Non-demo mode returns an honest 503: daily
// energy history belongs to the GAS backend (DAILY action) — this route has
// NO real data source and must not serve 7 days of Math.random() fabrication.
export async function POST(req: NextRequest) {
  const auth = await requireAuth({ mutation: true });
  if (!auth.ok) return authFailure(auth);
  // [WAVE-7 / PW7-1] CSRF double-submit — POST /api/reports adalah satu-satunya
  // route mutasi yang TIDAK memverifikasi CSRF (semua route POST lain sudah).
  // Konsistensi defense-in-depth: same-site strict cookie sudah melindungi,
  // header X-CSRF-Token kini ikut diverifikasi.
  if (!(await verifyCsrfToken(req))) return fail('Invalid CSRF token', 403);
  let body: { range?: string; from?: number; to?: number; format?: string; requestId?: string };
  try {
    body = await req.json();
  } catch {
    return fail('Invalid JSON body');
  }
  const { requestId: _requestId, range, from, to, format } = body;
  void _requestId;
  if (!range || !from || !to) return fail('range, from, to are required');
  if (!['daily', 'weekly', 'monthly', 'custom'].includes(range)) return fail('Invalid range');
  if (!['csv', 'pdf', 'json'].includes(format ?? 'json')) return fail('Invalid format');

  if (!isMockAuthEnabled()) {
    return serviceUnavailable(
      'Daily reports are served by the GAS backend (DAILY action) — configure the device/GAS source, or enable demo mode.',
    );
  }

  const allRecords = getDailyEnergy();
  const filtered = allRecords.filter((r) => {
    const rTs = new Date(r.date + 'T00:00:00Z').getTime();
    return rTs >= from && rTs <= to;
  });
  // Aggregate per day (if range is weekly/monthly, multiple records per day may exist).
  const records = aggregateDaily(filtered);
  return ok({ records, generatedAt: Date.now() }, `Report generated (${range}, ${records.length} records)`);
}
