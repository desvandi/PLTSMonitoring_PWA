// =============================================================================
// API Response helpers — consistent {success, message, data} envelope.
// =============================================================================

import { NextResponse } from "next/server";
import type { ApiResponse } from "@/lib/types";

export function ok<T>(data: T, message = ""): NextResponse<ApiResponse<T>> {
  return NextResponse.json<ApiResponse<T>>({ success: true, message, data });
}

export function fail(message: string, status = 400): NextResponse<ApiResponse<null>> {
  return NextResponse.json<ApiResponse<null>>(
    { success: false, message, data: null },
    { status },
  );
}

export function unauthorized(message = "Unauthorized"): NextResponse<ApiResponse<null>> {
  return fail(message, 401);
}

export function forbidden(message = "Forbidden"): NextResponse<ApiResponse<null>> {
  return fail(message, 403);
}

export function notFound(message = "Not Found"): NextResponse<ApiResponse<null>> {
  return fail(message, 404);
}

// [P0-006 REMEDIATION 2026-08] Deterministic unavailable state — used when a
// resource genuinely does not exist in this deployment mode (e.g. no mock
// data source and no device). Distinct from 500: nothing is broken; the
// capability is simply not available here.
export function serviceUnavailable(
  message: string,
): NextResponse<ApiResponse<null>> {
  return fail(message, 503);
}

// [AUDIT p.492] Map a requireAuth() failure to the correct HTTP status.
// requireAuth({ mutation: true }) can now return 503 (revocation verification
// unavailable — fail-closed for mutations); mislabeling it as 401 would hide
// the real cause from operators and monitoring.
export function authFailure(auth: {
  ok: false;
  status: 401 | 403 | 503;
  message: string;
}): NextResponse<ApiResponse<null>> {
  if (auth.status === 403) return forbidden(auth.message);
  if (auth.status === 503) return serviceUnavailable(auth.message);
  return unauthorized(auth.message);
}
