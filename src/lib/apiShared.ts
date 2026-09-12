// =============================================================================
// apiShared — shared utilities for DeviceApiClient and BackendApiClient.
// [P1-2 AUDIT 2026-09] Extracted from src/lib/api.ts to avoid duplication.
// Kept here (not exported from index) so consumers import from deviceApi /
// backendApi explicitly — making the API authority visible at call site.
// =============================================================================

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}

// CSRF token cache (per session)
let csrfTokenCache: string | null = null;

export function setCsrfToken(token: string | null) {
  csrfTokenCache = token;
}

export function getCsrfToken(): string | null {
  return csrfTokenCache;
}

/**
 * Generate a requestId for REST mutations.
 * Uses crypto.randomUUID() — CSPRNG. Firmware validateRequestId() accepts
 * 1-64 chars of [a-zA-Z0-9-_]; UUID v4 (36 chars, hex+hyphens) is valid.
 */
export function generateRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback for older runtimes — still CSPRNG-based.
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  arr[6] = (arr[6]! & 0x0f) | 0x40;
  arr[8] = (arr[8]! & 0x3f) | 0x80;
  const hex = Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * [PRODUCTION-GRADE 2026-09 / audit p.62-65] Canonical mutation envelope.
 * The firmware now REQUIRES (CORE-02) version + transactionId + issuedAt +
 * expiresAt on every mutation — replay protection must never silently
 * degrade to journal-retention-only. Operators get a 60 s TTL: a manual
 * command queued longer than that is stale by definition (audit p.65
 * recommends 30–60 s for manual commands).
 *
 * The SAME transactionId is reused across transport retries (TXN-09):
 * a network timeout + retry hits the firmware journal as DUPLICATE and
 * replays the original ACK instead of executing twice.
 *
 * [audit p.418 / contract v3] requestId is the TRANSPORT identity and MAY
 * differ from transactionId (the logical identity): a retry may present a
 * fresh requestId with the SAME transactionId so attempts stay
 * distinguishable in the firmware audit trail. This client keeps
 * requestId === transactionId (fresh command = fresh logical identity —
 * fully compliant with both v2 and v3).
 */
export const COMMAND_TTL_SEC = 60;

export function buildCommandEnvelope(): {
  requestId: string;
  transactionId: string;
  version: number;
  issuedAt: number;
  expiresAt: number;
} {
  const requestId = generateRequestId();
  const issuedAt = Math.floor(Date.now() / 1000);
  return {
    requestId,
    transactionId: requestId, // v2-compliant single-logical-command semantics
    version: 1,
    issuedAt,
    expiresAt: issuedAt + COMMAND_TTL_SEC,
  };
}
