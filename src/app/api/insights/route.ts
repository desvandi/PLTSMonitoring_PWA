import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getInsights, isMockAuthEnabled } from '@/lib/mockStore';
import { ok, serviceUnavailable, unauthorized } from '@/lib/apiResponse';

export const runtime = 'nodejs';

// GET /api/insights — AI insights.
// [P0-006 REMEDIATION 2026-08] Honest source policy:
//   - Demo mode: mock insights, EXPLICITLY labeled mock:true.
//   - Production: the PWA must fetch insights from the DEVICE
//     (NEXT_PUBLIC_API_BASE_URL set → this route is bypassed entirely) —
//     the device proxies to GAS → Gemini via HMAC. When this route IS hit in
//     non-demo mode it returns a deterministic 503 instead of fabricated
//     "battery looks healthy" advisories (a wrong AI insight is worse than
//     no insight: it fabricates certainty about physical state).
export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (!auth.ok) return unauthorized(auth.message);
  // req is used to satisfy the route signature; no query params consumed.
  void req;

  if (!isMockAuthEnabled()) {
    return serviceUnavailable(
      'AI insights unavailable in this deployment mode — connect the device (NEXT_PUBLIC_API_BASE_URL) or enable demo mode.',
    );
  }

  const result = getInsights();
  return ok(
    {
      success: true,
      insights: result.insights,
      cached: false,
      mock: result.mock,
    },
    result.mock ? 'Mock insights (simulation — not device data)' : 'AI insights fetched',
  );
}
