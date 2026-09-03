import { NextRequest } from 'next/server';
import { requireAuth, verifyCsrfToken } from '@/lib/auth';
import { getStore, simulateOtaUpdate } from '@/lib/mockStore';
import { ok, fail, unauthorized } from '@/lib/apiResponse';

export const runtime = 'nodejs';

// ============================================================================
// POST /api/demo/ota — DEMO ONLY (P1-5 AUDIT 2026-09).
// This route is the renamed version of the previous /api/ota. It accepts a
// binary file but NEVER flashes anything — it calls simulateOtaUpdate() to
// exercise the UI/UX flow without touching real hardware.
//
// Response ALWAYS contains `simulated: true, flashed: false` so the consumer
// can distinguish a demo response from a real ESP32 OTA response.
//
// GUARDS:
//   - 404 in production build (process.env.NODE_ENV === 'production' AND
//     NEXT_PUBLIC_DEMO_MODE !== 'true'). This prevents the demo endpoint
//     from accidentally being used against real devices in a production
//     deployment.
//   - Auth + CSRF still required (the demo must not bypass session hygiene).
// ============================================================================

const isProduction = process.env.NODE_ENV === 'production';
const demoModeExplicitlyEnabled = process.env.NEXT_PUBLIC_DEMO_MODE === 'true';

export async function POST(req: NextRequest) {
  // Guard: production builds must NOT expose this route unless explicitly opted in.
  if (isProduction && !demoModeExplicitlyEnabled) {
    return fail(
      'Demo OTA endpoint disabled in production. ' +
      'Configure NEXT_PUBLIC_DEMO_MODE=true to enable, or call the ESP32 directly ' +
      'at /api/ota via NEXT_PUBLIC_API_BASE_URL.',
      404,
    );
  }

  const auth = await requireAuth();
  if (!auth.ok) return unauthorized(auth.message);
  if (!(await verifyCsrfToken(req))) return fail('Invalid CSRF token', 403);

  const formData = await req.formData();
  const file = formData.get('file');
  if (!(file instanceof File)) {
    return fail('No file uploaded');
  }
  // ESP32 partition limit (1.5 MB OTA partition + factory).
  if (file.size > 2_000_000) {
    return fail('Binary too large (max 2MB for ESP32 OTA partition)');
  }

  const store = await getStore();
  const targetVersion = store.latestAvailable;
  const success = await simulateOtaUpdate(targetVersion);
  if (success) {
    // P1-5 — explicitly mark the response as simulated so UI/consumers
    // never confuse a demo response for a real flash.
    return ok(
      { success: true, newVersion: targetVersion, simulated: true, flashed: false },
      'Demo OTA update simulated — no hardware was flashed',
    );
  }
  return fail('Demo OTA simulation failed — no hardware was touched', 500);
}

// GET — surface the demo nature so clients can detect before uploading.
export async function GET() {
  if (isProduction && !demoModeExplicitlyEnabled) {
    return fail('Demo OTA endpoint disabled in production.', 404);
  }
  return ok(
    { simulated: true, flashed: false, endpoint: '/api/demo/ota' },
    'Demo OTA endpoint — call POST with a multipart "file" to simulate',
  );
}
