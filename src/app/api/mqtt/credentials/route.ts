// =============================================================================
// /api/mqtt/credentials — server-held MQTT viewer credentials (p.486-old).
// -----------------------------------------------------------------------------
// [AUDIT p.486-old REMEDIATION 2026-09] The MQTT username/password previously
// existed ONLY as NEXT_PUBLIC_* values — inlined into the public browser
// bundle at build time. This route serves the SAME viewer credentials from
// SERVER-side env vars (MQTT_USERNAME / MQTT_PASSWORD) to AUTHENTICATED
// sessions only — they never appear in the bundle.
//
// [GATE-3 / S1-01 REMEDIATION 2026-09] The NEXT_PUBLIC_* compatibility
// fallback in the client is DELETED — this route is now the ONLY credential
// source; the client fails closed when it cannot obtain a credential here.
//
// [PH6-S1-04 REMEDIATION 2026-09] Credential-bearing responses are explicitly
// Cache-Control: private, no-store + Pragma: no-cache — never the framework's
// default public/max-age=0 semantics. No intermediary or browser cache may
// ever hold a reusable credential.
//
// Broker ACL contract (documented in SECURITY.md): this credential MUST be a
// dedicated viewer account restricted to READ on plts/<deviceId>/# — never a
// fleet-wide or write-enabled credential.
// =============================================================================

import { requireAuth } from "@/lib/auth";
import { ok, fail } from "@/lib/apiResponse";
import { NextResponse } from "next/server";

/** [PH6-S1-04] Secret-bearing responses are never cacheable. */
function securityJson<T>(data: T, message = ""): NextResponse {
  const res = ok(data, message);
  res.headers.set("Cache-Control", "private, no-store");
  res.headers.set("Pragma", "no-cache");
  return res;
}

export async function GET() {
  const auth = await requireAuth();
  if (!auth.ok) {
    const res = fail(auth.message, auth.status);
    res.headers.set("Cache-Control", "private, no-store");
    res.headers.set("Pragma", "no-cache");
    return res;
  }

  const username = process.env.MQTT_USERNAME?.trim() || "";
  const password = process.env.MQTT_PASSWORD?.trim() || "";

  if (!username || !password) {
    // Honest 503: the capability is simply not configured in this deployment.
    // [S1-01] The client has NO fallback — this refusal fails the connection
    // closed (never silently connects with a public/leaked credential).
    const res = fail(
      "MQTT viewer credentials are not configured on the server " +
        "(set MQTT_USERNAME / MQTT_PASSWORD env vars).",
      503,
    );
    res.headers.set("Cache-Control", "private, no-store");
    res.headers.set("Pragma", "no-cache");
    return res;
  }

  return securityJson({
    username,
    password,
    // Scope marker surfaced to the client for diagnostics — the credential
    // is expected to be read-only on plts/<deviceId>/# by broker ACL.
    scope: "viewer:read:plts/#",
  });
}
