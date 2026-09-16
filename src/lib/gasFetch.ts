/**
 * gasFetch.ts — hardened fetch for GAS (Google Apps Script) requests.
 * -----------------------------------------------------------------------------
 * AUDIT FINDING (p.488): the PWA trusted ANY https:// URL stored in
 * PLTS_SYS_CONFIG as a "GAS endpoint", and every credential-bearing request
 * used `redirect: 'follow'`. A crafted configuration could silently redirect
 * token/admin_token-bearing bodies to an attacker host mid-flight.
 *
 * REMEDIATION (this module) — every GAS call now funnels through gasFetch():
 *   1. STRICT ORIGIN ALLOWLIST: only script.google.com /
 *      script.googleusercontent.com (plus operators-supplied extra hosts via
 *      NEXT_PUBLIC_GAS_ALLOWED_HOSTS, comma-separated, for self-hosted GAS
 *      mirrors). A syntactically valid https URL that is NOT on the list is
 *      rejected BEFORE any credential leaves the browser.
 *   2. `redirect: 'error'` — requests carrying tokens NEVER follow redirects
 *      (cross-origin redirect of a credentialed body is the core leak).
 *   3. Full URL parsing (new URL) — no more prefix string matching that
 *      accepted "https://" + arbitrary garbage.
 *   4. URL sanity: no embedded credentials (user:pass@), no non-standard
 *      ports, length caps.
 *
 * Dev escape hatch: http://localhost / http://127.0.0.1 remain usable
 * outside production for local GAS emulation — still never via redirect.
 */

/** Default GAS origin allowlist — the only hosts a GAS Web App can live on. */
const DEFAULT_GAS_HOSTS = [
  'script.google.com',
  'script.googleusercontent.com',
];

const MAX_URL_LENGTH = 2048;

function configuredExtraHosts(): string[] {
  const raw = process.env.NEXT_PUBLIC_GAS_ALLOWED_HOSTS;
  if (typeof raw !== 'string' || !raw.trim()) return [];
  return raw
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter((h) => h.length > 0 && h.includes('.'));
}

export function gasAllowedHosts(): string[] {
  return [...DEFAULT_GAS_HOSTS, ...configuredExtraHosts()];
}

export type GasUrlCheck =
  | { ok: true; url: URL }
  | { ok: false; message: string };

/**
 * Validate a candidate GAS endpoint URL against the strict allowlist.
 * Returns a parsed URL on success so callers never re-parse a variant.
 */
export function assertGasUrlAllowed(candidate: string): GasUrlCheck {
  if (typeof candidate !== 'string' || !candidate.trim()) {
    return { ok: false, message: 'GAS URL kosong.' };
  }
  if (candidate.length > MAX_URL_LENGTH) {
    return { ok: false, message: 'GAS URL melebihi batas panjang.' };
  }
  let url: URL;
  try {
    url = new URL(candidate.trim());
  } catch {
    return { ok: false, message: 'GAS URL tidak dapat di-parse (format tidak valid).' };
  }

  const isHttps = url.protocol === 'https:';
  const isLocalDev =
    (url.protocol === 'http:') &&
    (url.hostname === 'localhost' || url.hostname === '127.0.0.1') &&
    process.env.NODE_ENV !== 'production';
  if (!isHttps && !isLocalDev) {
    return {
      ok: false,
      message: `GAS URL harus HTTPS di produksi (ditemukan "${url.protocol}").`,
    };
  }

  // No embedded credentials — "https://user:pass@host/..." exfiltrates the
  // token into URLs (logs, referer, history).
  if (url.username || url.password) {
    return { ok: false, message: 'GAS URL tidak boleh mengandung kredensial (user:pass@).' };
  }

  // Local dev emulation bypasses the allowlist AND the standard-port rule
  // (non-production only — local GAS mocks listen on arbitrary ports).
  if (isLocalDev) {
    return { ok: true, url };
  }

  // GAS Web Apps are served on standard ports only.
  if (url.port && url.port !== '443' && url.port !== '80') {
    return { ok: false, message: `Port non-standar (${url.port}) tidak diizinkan untuk endpoint GAS.` };
  }

  const allowed = gasAllowedHosts();
  if (!allowed.includes(url.hostname.toLowerCase())) {
    return {
      ok: false,
      message:
        `Host "${url.hostname}" tidak ada dalam allowlist GAS ` +
        `(${allowed.join(', ')}). Token tidak dikirim ke host yang tidak dikenal.`,
    };
  }
  return { ok: true, url };
}

/**
 * Hardened GAS fetch. Enforces the allowlist + `redirect: 'error'` +
 * text/plain content type (the Apps Script doPost contract) + optional
 * timeout. Throws Error with a redacted, operator-readable message —
 * NEVER echoing the request body (tokens ride the body).
 */
export async function gasFetch(
  candidateUrl: string,
  init: {
    body?: string;
    timeoutMs?: number;
    method?: 'POST' | 'GET';
  } = {},
): Promise<Response> {
  const check = assertGasUrlAllowed(candidateUrl);
  if (!check.ok) {
    throw new Error(check.message);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? 10_000);
  try {
    return await fetch(check.url.toString(), {
      method: init.method ?? 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: init.body,
      signal: controller.signal,
      // [p.488] NEVER follow redirects on a credential-bearing GAS call.
      redirect: 'error',
      cache: 'no-store',
    });
  } finally {
    clearTimeout(timer);
  }
}
