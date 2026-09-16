// =============================================================================
// /api/mqtt/credentials — server-held MQTT viewer credentials (p.486-old).
// -----------------------------------------------------------------------------
// [AUDIT p.486-old REMEDIATION 2026-09] The MQTT username/password previously
// existed ONLY as NEXT_PUBLIC_* values — inlined into the public browser
// bundle at build time. Any visitor could extract them from the JS assets.
// This route serves the SAME viewer credentials from SERVER-side env vars
// (MQTT_USERNAME / MQTT_PASSWORD) to AUTHENTICATED sessions only — they never
// appear in the bundle. The client (src/lib/mqtt.ts) prefers this route and
// falls back to the documented NEXT_PUBLIC pair for backwards compatibility
// (pure-MQTT viewer deployments without a PWA login).
//
// Broker ACL contract (documented in SECURITY.md): this credential MUST be a
// dedicated viewer account restricted to READ on plts/<deviceId>/# — never a
// fleet-wide or write-enabled credential.
// =============================================================================

import { requireAuth } from "@/lib/auth";
import { ok, fail } from "@/lib/apiResponse";

export async function GET() {
  const auth = await requireAuth();
  if (!auth.ok) {
    return fail(auth.message, auth.status);
  }

  const username = process.env.MQTT_USERNAME?.trim() || "";
  const password = process.env.MQTT_PASSWORD?.trim() || "";

  if (!username || !password) {
    // Honest 503: the capability is simply not configured in this deployment
    // (the client will fall back to the compatibility path).
    return fail(
      "MQTT viewer credentials are not configured on the server " +
        "(set MQTT_USERNAME / MQTT_PASSWORD env vars).",
      503,
    );
  }

  return ok({
    username,
    password,
    // Scope marker surfaced to the client for diagnostics — the credential
    // is expected to be read-only on plts/<deviceId>/# by broker ACL.
    scope: "viewer:read:plts/#",
  });
}
