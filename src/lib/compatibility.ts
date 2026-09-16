// =============================================================================
// Compatibility — PWA ↔ Firmware version + protocol gating (brief §51)
// -----------------------------------------------------------------------------
// [AUDIT p.477 / p.478 REMEDIATION 2026-09] The compatibility gate is now
// FAIL-CLOSED at every input:
//   - Malformed / unparsable firmware version  → status "unknown", BOTH gates
//     BLOCKED. The old compareVersions() mapped "unparsable" to 0 ("equal"),
//     letting garbage versions pass the min/max range check — fixed: version
//     comparisons only ever run on already-parsed tuples.
//   - protocolVersion / configSchemaVersion === null (or unparsable) → NOT
//     compatible. null means "contract NOT verified", never "compatible".
//     The firmware has reported both fields in /api/version since its first
//     release (VersionHandlers.cpp, commit 76b6f7f), so a missing field is a
//     contract violation, not a legacy device — no implicit legacy path.
//   - Cross-layer normalization: the ESP32 (ArduinoJson) serializes protocol
//     and config-schema versions as STRINGS ("1") under the keys
//     `firmwareVersion` / `configVersion`; the PWA mock uses `currentVersion` /
//     `configSchemaVersion` with numbers. normalizeFirmwareInfo() accepts both
//     shapes so the gate evaluates the REAL device contract (firmware HEAD).
// =============================================================================

import { useQuery } from "@tanstack/react-query";
import type { FirmwareInfo } from "@/lib/types";
// NOTE: `./api` is imported DYNAMICALLY inside the queryFn to break the
// static import cycle  api.ts → deviceApi.ts → compatibility.ts → api.ts.
// When a consumer imports deviceApi (or this module) directly, the cycle
// would otherwise evaluate api.ts while deviceApi is still uninitialized
// (api.ts reads `deviceApi.voltageCalibrationPoint` at module-init time).

export const PWA_EXPECTED = {
  pwaVersion: "1.0.0",
  firmwareMin: "1.0.0",
  firmwareMax: null as string | null,
  protocolVersion: 1,
  configSchemaVersion: 1,
} as const;

export type CompatibilityStatus = {
  status:
    | "compatible"
    | "pwa_too_old"
    | "firmware_too_old"
    | "protocol_mismatch"
    | "config_schema_mismatch"
    | "unknown";
  pwaVersion: string;
  firmwareVersion: string | null;
  protocolVersion: number | null;
  configSchemaVersion: number | null;
  message: string;
  canViewTelemetry: boolean;
  canControlRelays: boolean;   // [v1.8.0] firmware ≥ 1.8.0 has 8-channel relay
};

type SemVer = [number, number, number];

function parseVersion(v: string): SemVer | null {
  const m = v.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [parseInt(m[1]!, 10), parseInt(m[2]!, 10), parseInt(m[3]!, 10)];
}

/**
 * Compare two ALREADY-PARSED version tuples. Callers must parse first and
 * treat a null parse as fail-closed — an unparsable version can never reach
 * this function, so it can never be compared "equal" to a boundary.
 * [p.477 fix] The old string-based compareVersions() returned 0 when either
 * side failed to parse, silently treating garbage as "equal/compatible".
 */
function compareSemVer(a: SemVer, b: SemVer): number {
  for (let i = 0; i < 3; i++) {
    if (a[i]! < b[i]!) return -1;
    if (a[i]! > b[i]!) return 1;
  }
  return 0;
}

/**
 * [p.478 fix + cross-layer] Coerce a protocol/config-schema field to a finite
 * number, or null. Accepts:
 *   - number 1            (PWA mock / typed contract)
 *   - string "1"          (firmware ArduinoJson serialization)
 *   - null / undefined    (field absent — "contract unverified")
 *   - garbage             (unparseable — also "contract unverified")
 * Every non-finite result becomes null so evaluateCompatibility() can only
 * reach the "compatible" branch on a VERIFIED numeric match.
 */
function coerceVersionField(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

/**
 * [p.477 / p.478 REMEDIATION] Evaluate firmware compatibility. FAIL-CLOSED:
 *   1. firmwareVersion missing / unparsable          → unknown, both blocked
 *   2. version outside [firmwareMin, firmwareMax]    → too old / too new
 *   3. protocolVersion null / unparsable             → protocol_mismatch
 *   4. protocolVersion ≠ expected                     → protocol_mismatch
 *   5. configSchemaVersion null / unparsable         → config_schema_mismatch
 *   6. configSchemaVersion ≠ expected                 → config_schema_mismatch
 *   7. otherwise                                      → compatible
 */
export function evaluateCompatibility(
  firmwareVersion: string | null | undefined,
  protocolVersion: number | string | null | undefined,
  configSchemaVersion: number | string | null | undefined,
): CompatibilityStatus {
  const pwaVersion = PWA_EXPECTED.pwaVersion;
  const proto = coerceVersionField(protocolVersion);
  const schema = coerceVersionField(configSchemaVersion);

  // ---- [p.477] Malformed / missing firmware version → UNKNOWN, fail-closed.
  const rawVersion =
    typeof firmwareVersion === "string" ? firmwareVersion.trim() : "";
  const parsedFw = rawVersion ? parseVersion(rawVersion) : null;
  if (!parsedFw) {
    return {
      status: "unknown",
      pwaVersion,
      firmwareVersion: rawVersion || null,
      protocolVersion: proto,
      configSchemaVersion: schema,
      message:
        `Firmware version missing or malformed${rawVersion ? ` ("${rawVersion}")` : ""} — ` +
        "compatibility UNVERIFIED. Telemetry display and relay control BLOCKED (fail-closed).",
      canViewTelemetry: false,
      canControlRelays: false,
    };
  }

  // Range checks — both boundaries are static constants that always parse.
  const minParsed = parseVersion(PWA_EXPECTED.firmwareMin)!;
  if (compareSemVer(parsedFw, minParsed) < 0) {
    return {
      status: "firmware_too_old",
      pwaVersion,
      firmwareVersion: rawVersion,
      protocolVersion: proto,
      configSchemaVersion: schema,
      message: `Firmware ${rawVersion} is too old. PWA requires ≥ ${PWA_EXPECTED.firmwareMin}.`,
      canViewTelemetry: false,
      canControlRelays: false,
    };
  }
  if (PWA_EXPECTED.firmwareMax) {
    const maxParsed = parseVersion(PWA_EXPECTED.firmwareMax);
    if (maxParsed && compareSemVer(parsedFw, maxParsed) > 0) {
      return {
        status: "pwa_too_old",
        pwaVersion,
        firmwareVersion: rawVersion,
        protocolVersion: proto,
        configSchemaVersion: schema,
        message: `Firmware ${rawVersion} is newer than this PWA supports.`,
        canViewTelemetry: false,
        canControlRelays: false,
      };
    }
  }

  // ---- [p.478] A null/unreported protocol version is NOT compatible.
  // "Contract not verified" must never be promoted to "compatible".
  if (proto === null) {
    return {
      status: "protocol_mismatch",
      pwaVersion,
      firmwareVersion: rawVersion,
      protocolVersion: null,
      configSchemaVersion: schema,
      message:
        `Protocol version not reported (null / missing / unparseable) — an unverified ` +
        `contract is treated as INCOMPATIBLE, not compatible. PWA expects protocol ` +
        `${PWA_EXPECTED.protocolVersion}. Firmware /api/version has reported this field ` +
        `since v1.0.0; its absence indicates a broken or tampered contract.`,
      canViewTelemetry: false,
      canControlRelays: false,
    };
  }
  if (proto !== PWA_EXPECTED.protocolVersion) {
    return {
      status: "protocol_mismatch",
      pwaVersion,
      firmwareVersion: rawVersion,
      protocolVersion: proto,
      configSchemaVersion: schema,
      message: `Protocol mismatch: PWA expects ${PWA_EXPECTED.protocolVersion}, firmware reports ${proto}.`,
      canViewTelemetry: false,
      canControlRelays: false,
    };
  }

  // ---- [p.478] Same rule for the config schema contract.
  if (schema === null) {
    return {
      status: "config_schema_mismatch",
      pwaVersion,
      firmwareVersion: rawVersion,
      protocolVersion: proto,
      configSchemaVersion: null,
      message:
        `Config schema version not reported (null / missing / unparseable) — an unverified ` +
        `contract is treated as INCOMPATIBLE, not compatible. PWA expects config schema ` +
        `${PWA_EXPECTED.configSchemaVersion}. Firmware /api/version has reported this field ` +
        `since v1.0.0; its absence indicates a broken or tampered contract.`,
      canViewTelemetry: false,
      canControlRelays: false,
    };
  }
  if (schema !== PWA_EXPECTED.configSchemaVersion) {
    return {
      status: "config_schema_mismatch",
      pwaVersion,
      firmwareVersion: rawVersion,
      protocolVersion: proto,
      configSchemaVersion: schema,
      message: `Config schema mismatch: PWA expects ${PWA_EXPECTED.configSchemaVersion}, firmware reports ${schema}.`,
      canViewTelemetry: false,
      canControlRelays: false,
    };
  }

  return {
    status: "compatible",
    pwaVersion,
    firmwareVersion: rawVersion,
    protocolVersion: proto,
    configSchemaVersion: schema,
    message: "Firmware compatible — telemetry display enabled.",
    canViewTelemetry: true,
    // [self-review fix] canControlRelays = true ONLY if firmware ≥ 1.8.0
    // (8-channel relay support was added in v1.8.0). Older firmware does
    // not have /api/relays endpoint — the relay view must be hidden.
    canControlRelays: _firmwareSupportsRelays(parsedFw),
  };
}

/**
 * [CROSS-LAYER CONTRACT — firmware HEAD 28bf0a9 ↔ PWA]
 * Normalize a raw /api/version response into FirmwareInfo. The ESP32 sends:
 *   { firmwareVersion: "1.9.3", protocolVersion: "1", configVersion: "1",
 *     calibrationVersion: "1", buildDate, deviceModel, buildProfile }
 * (ArduinoJson serializes the version constants — const char* — as STRINGS,
 * and the schema key is `configVersion`). The PWA mock / legacy contract
 * uses `currentVersion` / `configSchemaVersion` with numbers. Both shapes
 * are accepted; anything absent or unparsable becomes null / "" so the
 * compatibility gate fails closed instead of trusting `undefined`.
 */
export function normalizeFirmwareInfo(
  raw: Record<string, unknown> | null | undefined,
): FirmwareInfo {
  const obj = (raw ?? {}) as Record<string, unknown>;

  const versionFrom =
    typeof obj.currentVersion === "string" && obj.currentVersion.trim()
      ? obj.currentVersion
      : typeof obj.firmwareVersion === "string" && obj.firmwareVersion.trim()
        ? obj.firmwareVersion
        : "";

  const protocol =
    coerceVersionField(
      (obj.protocolVersion ?? null) as number | string | null | undefined,
    ) ?? null;
  const schema =
    coerceVersionField(
      (obj.configSchemaVersion ?? obj.configVersion ?? null) as
        | number
        | string
        | null
        | undefined,
    ) ?? null;

  return {
    currentVersion: versionFrom,
    buildDate: typeof obj.buildDate === "string" ? obj.buildDate : "",
    protocolVersion: protocol,
    configSchemaVersion: schema,
    // Optional OTA-bookkeeping fields — absent on the real device response;
    // explicit defaults keep the type honest (previously `undefined` leaked
    // through the `as FirmwareInfo` cast).
    latestAvailable: null,
    updateAvailable: null,
    signatureVerified: null,
    otaStatus: "unknown",
    lastUpdateAt: null,
    lastUpdateStatus: null,
  };
}

/** [self-review fix] Check if firmware version supports 8-channel relay. */
function _firmwareSupportsRelays(fwVer: SemVer | null): boolean {
  if (!fwVer) return false;
  const [major, minor] = fwVer;
  // v1.8.0+ has relay support (PCF8574 I²C expander, /api/relays endpoint)
  if (major > 1) return true;
  if (major === 1 && minor >= 8) return true;
  return false;
}

export class IncompatibleFirmwareError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IncompatibleFirmwareError";
  }
}

let _compatibilitySnapshot: CompatibilityStatus | null = null;

export function setCompatibilitySnapshot(status: CompatibilityStatus | null): void {
  _compatibilitySnapshot = status;
}

export function getCompatibilitySnapshot(): CompatibilityStatus | null {
  return _compatibilitySnapshot;
}

/**
 * [Audit 2026-09-05 · P0 PWA-02] Status returned when the device cannot be
 * reached — compatibility is UNVERIFIED, which MUST be represented as a
 * fail-closed state: telemetry display and relay control are both BLOCKED
 * until `/api/version` succeeds. "UNKNOWN" must never be reported as a
 * verified/compatible state.
 */
export function unreachableCompatibilityStatus(): CompatibilityStatus {
  return {
    status: "unknown",
    pwaVersion: PWA_EXPECTED.pwaVersion,
    firmwareVersion: null,
    protocolVersion: null,
    configSchemaVersion: null,
    message:
      "Device unreachable — cannot verify firmware compatibility. " +
      "Compatibility: UNKNOWN · Firmware: UNVERIFIED · Telemetry: BLOCKED · " +
      "Relay control: BLOCKED (until /api/version is verified).",
    // [P0 PWA-02 FIX] was `canViewTelemetry: true` — an unverifiable device
    // must NOT be treated as telemetry-compatible. Fail closed on BOTH gates.
    canViewTelemetry: false,
    canControlRelays: false,
  };
}

export function useCompatibility() {
  const query = useQuery({
    queryKey: ["compatibility"],
    queryFn: async (): Promise<CompatibilityStatus> => {
      try {
        // Dynamic import — see NOTE above (static-import cycle breaker).
        const { api } = await import("./api");
        const info = await api.version();
        return evaluateCompatibility(
          info.currentVersion || null,
          info.protocolVersion,
          info.configSchemaVersion,
        );
      } catch {
        // [P0 PWA-02 FIX] Device unreachable → fail-closed (see helper above).
        return unreachableCompatibilityStatus();
      }
    },
    refetchInterval: 60 * 1000,
    staleTime: 30 * 1000,
  });
  if (query.data) {
    setCompatibilitySnapshot(query.data);
  }
  return query;
}
