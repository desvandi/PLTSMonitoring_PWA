import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, verifyCsrfToken } from '@/lib/auth';
import { ok, fail, unauthorized } from '@/lib/apiResponse';

export const runtime = 'nodejs';

// ============================================================================
// POST /api/ota — production OTA proxy (P1-5 AUDIT 2026-09).
//
// PREVIOUSLY: this route was a DEMO that called simulateOtaUpdate() and
// returned success without flashing anything. That was misleading — an
// operator could upload a binary, get "OTA update successful", and the
// device never received it. The demo behavior has moved to
// /api/demo/ota where it is explicitly marked as simulated.
//
// NOW: this route is a PROXY to the ESP32 device's /api/ota endpoint.
// It requires NEXT_PUBLIC_API_BASE_URL (or server-side API_BASE_URL) to be
// set; if not configured, the route returns an honest 503 instead of
// pretending to flash.
//
// Why proxy through Next.js instead of calling the device directly from
// the browser?
//   - The device may be on a LAN not reachable from the browser.
//   - The Next.js server can hold mTLS / VPN credentials the browser can't.
//   - Centralized audit logging of who triggered OTA.
//
// The browser-side client (deviceApi.otaUpload) still calls /api/ota; this
// route then forwards the upload to the device. To bypass the proxy and
// have the browser call the device directly, set NEXT_PUBLIC_API_BASE_URL
// to the device URL — the route will not be hit.
// ============================================================================

const API_BASE_URL =
  process.env.API_BASE_URL ||
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  '';

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (!auth.ok) return unauthorized(auth.message);
  if (!(await verifyCsrfToken(req))) return fail('Invalid CSRF token', 403);

  if (!API_BASE_URL) {
    // P1-5 honest refusal — do NOT simulate. The demo endpoint at
    // /api/demo/ota exists for UI/UX testing without real hardware.
    return fail(
      'Production OTA proxy not configured. Set API_BASE_URL (server-side) ' +
      'or NEXT_PUBLIC_API_BASE_URL to point at the ESP32, or use ' +
      '/api/demo/ota for simulation.',
      503,
    );
  }

  // Forward the multipart body to the device verbatim — no parsing, no
  // modification. The device's own auth + CSRF + size limits apply.
  const contentType = req.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
    return fail('Expected multipart/form-data', 415);
  }

  try {
    const deviceRes = await fetch(`${API_BASE_URL}/api/ota`, {
      method: 'POST',
      headers: {
        // Forward the original Content-Type (includes the multipart boundary).
        'content-type': contentType,
        // Forward the CSRF token so the device's CSRF check passes.
        ...(req.headers.get('x-csrf-token')
          ? { 'x-csrf-token': req.headers.get('x-csrf-token')! }
          : {}),
        // Forward session cookie if present (the device uses the same cookie jar).
        ...(req.headers.get('cookie')
          ? { cookie: req.headers.get('cookie')! }
          : {}),
      },
      body: await req.blob(),
    });

    const text = await deviceRes.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      json = { success: false, message: text };
    }
    return NextResponse.json(json, { status: deviceRes.status });
  } catch (err) {
    return fail(
      `OTA proxy error: ${err instanceof Error ? err.message : 'unknown'}`,
      502,
    );
  }
}
