// =============================================================================
// JWT Helper (mock) — for demo only.
// -----------------------------------------------------------------------------
// In real firmware v1.0, JWT is generated/verified on the ESP32 with a device
// secret burned into NVS. This mock uses HS256 with a static secret.
// =============================================================================

import { createHmac, timingSafeEqual, randomBytes } from "crypto";

const ALG = "HS256";

function base64urlEncode(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  return buf.toString("base64url");
}

function base64urlDecode(input: string): Buffer {
  return Buffer.from(input, "base64url");
}

type JwtPayload = {
  sub?: string;       // username (optional for mock)
  iat: number;       // issued at (ms epoch)
  exp: number;       // expiry (ms epoch)
  [key: string]: unknown;
};

export function signJwt(
  payload: Omit<JwtPayload, "iat" | "exp">,
  secret: string,
  ttlSeconds = 3600,
): string {
  const header = { alg: ALG, typ: "JWT" };
  const now = Date.now();
  const fullPayload: JwtPayload = {
    ...payload,
    iat: now,
    exp: now + ttlSeconds * 1000,
  };
  const encHeader = base64urlEncode(JSON.stringify(header));
  const encPayload = base64urlEncode(JSON.stringify(fullPayload));
  const signingInput = `${encHeader}.${encPayload}`;
  const signature = createHmac("sha256", secret).update(signingInput).digest();
  const encSignature = base64urlEncode(signature);
  return `${signingInput}.${encSignature}`;
}

export function verifyJwt(token: string, secret: string): JwtPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [encHeader, encPayload, encSignature] = parts;

  // [audit-2 K-3 FIX] Validate header BEFORE signature verification.
  // Defense-in-depth against alg-confusion attacks: if the verifier ever
  // dispatches by `alg` (e.g., to support RS256 in firmware v2), an attacker
  // who crafts `{"alg":"none"}` would bypass signature check. We refuse any
  // alg != HS256 and any typ != JWT explicitly, regardless of dispatch logic.
  let header: { alg?: unknown; typ?: unknown };
  try {
    header = JSON.parse(base64urlDecode(encHeader).toString("utf-8"));
  } catch {
    return null;
  }
  if (header.alg !== ALG) return null;       // refuse alg=none, RS256, etc.
  if (header.typ !== "JWT") return null;    // refuse non-JWT tokens

  const signingInput = `${encHeader}.${encPayload}`;
  const expectedSig = createHmac("sha256", secret).update(signingInput).digest();
  const actualSig = base64urlDecode(encSignature);
  if (expectedSig.length !== actualSig.length) return null;
  if (!timingSafeEqual(expectedSig, actualSig)) return null;

  let payload: JwtPayload;
  try {
    payload = JSON.parse(base64urlDecode(encPayload).toString("utf-8"));
  } catch {
    return null;
  }
  if (payload.exp && Date.now() > payload.exp) return null;
  return payload;
}

// CSPRNG-based token generator — used for CSRF tokens and factory-reset tokens.
// NEVER use Math.random() for security tokens (its output is predictable from
// a small sample).
export function generateRandomToken(length = 32): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += chars[bytes[i]! % chars.length];
  }
  return out;
}
