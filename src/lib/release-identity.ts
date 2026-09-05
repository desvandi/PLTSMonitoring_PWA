/**
 * release-identity.ts — [Audit 2026-09-05 · P0 PWA-01] Authorized release identity.
 *
 * POLICY (fail-closed):
 *   1. The PWA resolves firmware identity from an EXPECTED, AUTHORIZED release
 *      TAG (`releases/tags/v1.9.3`). Tags are immutable for this repo (the
 *      `release-tag-protection` ruleset is ACTIVE), so identity resolved by
 *      tag cannot silently drift.
 *   2. `releases/latest` is a MUTABLE deployment state and is NEVER used as
 *      OTA authority. It is fetched ONLY to detect a mismatch between
 *      "latest" and the authorized release so the PWA can warn operators:
 *        latest != authorized  →  the PWA MUST NOT silently flash latest.
 *   3. The release manifest (`modular-release.json`) is validated against a
 *      strict policy before it is trusted: SemVer equal to the expected
 *      version, 64-hex SHA-256, 40-hex git commit, non-empty build id, and
 *      the firmware + signature assets must exist on the release.
 *
 * If the authorized release is not published yet, resolution FAILS CLOSED
 * (ok: false) — the PWA then reports "authorized release v1.9.3 not yet
 * published" instead of falling back to whatever GitHub currently marks as
 * "latest".
 *
 * Usage:
 *   import { resolveAuthorizedRelease } from "@/lib/release-identity";
 *   const res = await resolveAuthorizedRelease();
 *   if (res.ok) — res.release is the authorized identity.
 *   else        — res.code / res.message explain the fail-closed reason.
 */

export interface CanonicalRelease {
  /** Authorized firmware version (SemVer, no leading "v"). */
  version: string;
  /** Build id from modular-release.json. */
  releaseId: string;
  /** Full 40-hex source commit the release was built from. */
  gitCommit: string;
  /** 64-hex SHA-256 of modular-firmware.bin. */
  firmwareSha256: string;
  /** GitHub Release page (immutable tag URL). */
  releaseUrl: string;
  /** Canonical manifest asset URL (modular-manifest-canonical.json). */
  manifestUrl: string;
  /** Direct download URL for modular-firmware.bin (validated present). */
  firmwareUrl: string;
  /** Direct download URL for modular-firmware.bin.sig (validated present). */
  signatureUrl: string;
  /** Tag the PWA is authorized to deploy. */
  expectedTag: string;
  /** Tag currently marked /releases/latest — observability ONLY. */
  latestTag: string | null;
  /** true when latest != authorized (PWA must warn, never flash latest). */
  latestMismatch: boolean;
  fetchedAt: number;
}

export type ReleasePolicyErrorCode =
  | "EXPECTED_RELEASE_NOT_PUBLISHED"
  | "MANIFEST_ASSET_MISSING"
  | "FIRMWARE_ASSET_MISSING"
  | "SIGNATURE_ASSET_MISSING"
  | "VERSION_POLICY_VIOLATION"
  | "INVALID_MANIFEST_FIELD"
  | "GITHUB_API_UNREACHABLE";

export type ReleaseResolution =
  | {
      ok: true;
      release: CanonicalRelease;
    }
  | {
      ok: false;
      code: ReleasePolicyErrorCode;
      message: string;
      expectedTag: string;
      latestTag: string | null;
    };

const FIRMWARE_REPO = "desvandi/PLTSMonitoring_Firmware-Backend";
const GITHUB_TAGS_API = `https://api.github.com/repos/${FIRMWARE_REPO}/releases/tags`;
const GITHUB_LATEST_API = `https://api.github.com/repos/${FIRMWARE_REPO}/releases/latest`;
const GH_HEADERS = { Accept: "application/vnd.github+json" };

/**
 * The authorized production release tag for THIS PWA build.
 * Pinned by default to the current release candidate; overridable via
 * NEXT_PUBLIC_EXPECTED_FIRMWARE_TAG for staging/pre-release channels.
 */
export const EXPECTED_FIRMWARE_TAG = (
  process.env.NEXT_PUBLIC_EXPECTED_FIRMWARE_TAG ?? "v1.9.3"
).trim();

const EXPECTED_FIRMWARE_VERSION = EXPECTED_FIRMWARE_TAG.replace(/^v/, "");

const SEMVER_RE = /^\d+\.\d+\.\d+$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const COMMIT_RE = /^[0-9a-f]{40}$/;

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

let cachedRelease: CanonicalRelease | null = null;
let cacheTime = 0;

interface GhAsset {
  name: string;
  browser_download_url: string;
}

interface TagReleasePayload {
  html_url?: string;
  assets?: GhAsset[];
}

interface ModularReleaseManifest {
  version?: unknown;
  buildId?: unknown;
  gitCommit?: unknown;
  firmwareSha256?: unknown;
}

/** Reset the identity cache (used by tests and manual refresh). */
export function clearReleaseIdentityCache(): void {
  cachedRelease = null;
  cacheTime = 0;
}

function fail(
  code: ReleasePolicyErrorCode,
  message: string,
  latestTag: string | null,
): ReleaseResolution {
  return { ok: false, code, message, expectedTag: EXPECTED_FIRMWARE_TAG, latestTag };
}

/**
 * Resolve the AUTHORIZED release identity (by immutable tag).
 *
 * `releases/latest` is consulted only for mismatch detection — it is never
 * a source of OTA identity.
 */
export async function resolveAuthorizedRelease(): Promise<ReleaseResolution> {
  const now = Date.now();
  if (cachedRelease && now - cacheTime < CACHE_TTL_MS) {
    return { ok: true, release: cachedRelease };
  }

  // ---- Observability only: what does GitHub currently call "latest"? ----
  let latestTag: string | null = null;
  try {
    const r = await fetch(GITHUB_LATEST_API, {
      headers: GH_HEADERS,
      cache: "no-store",
    });
    if (r.ok) {
      const d = (await r.json()) as { tag_name?: unknown };
      latestTag = typeof d.tag_name === "string" && d.tag_name ? d.tag_name : null;
    }
  } catch {
    // Observability only — a failure here must not change authorization.
  }

  // ---- Canonical: the authorized release BY TAG (immutable) ----
  let tagResp: Response;
  try {
    tagResp = await fetch(
      `${GITHUB_TAGS_API}/${encodeURIComponent(EXPECTED_FIRMWARE_TAG)}`,
      { headers: GH_HEADERS, cache: "no-store" },
    );
  } catch {
    return fail(
      "GITHUB_API_UNREACHABLE",
      "GitHub Releases API unreachable — cannot verify the authorized release. OTA blocked (fail-closed).",
      latestTag,
    );
  }

  if (tagResp.status === 404) {
    return fail(
      "EXPECTED_RELEASE_NOT_PUBLISHED",
      `Authorized release ${EXPECTED_FIRMWARE_TAG} is not published yet. The PWA refuses to fall back to GitHub "latest" (${latestTag ?? "unknown"}) — production OTA stays blocked until the authorized release exists.`,
      latestTag,
    );
  }
  if (!tagResp.ok) {
    return fail(
      "GITHUB_API_UNREACHABLE",
      `GitHub Releases API error (HTTP ${tagResp.status}) while resolving ${EXPECTED_FIRMWARE_TAG}. OTA blocked (fail-closed).`,
      latestTag,
    );
  }

  const tagData = (await tagResp.json().catch(() => null)) as TagReleasePayload | null;
  if (!tagData) {
    return fail(
      "INVALID_MANIFEST_FIELD",
      `Release payload for ${EXPECTED_FIRMWARE_TAG} is not valid JSON. OTA blocked (fail-closed).`,
      latestTag,
    );
  }

  const assets = Array.isArray(tagData.assets) ? tagData.assets : [];
  const findAsset = (name: string): GhAsset | undefined =>
    assets.find((a) => a?.name === name && typeof a.browser_download_url === "string");

  const releaseJsonAsset = findAsset("modular-release.json");
  if (!releaseJsonAsset) {
    return fail(
      "MANIFEST_ASSET_MISSING",
      `Release ${EXPECTED_FIRMWARE_TAG} has no modular-release.json asset — cannot establish canonical identity. OTA blocked (fail-closed).`,
      latestTag,
    );
  }
  const firmwareAsset = findAsset("modular-firmware.bin");
  if (!firmwareAsset) {
    return fail(
      "FIRMWARE_ASSET_MISSING",
      `Release ${EXPECTED_FIRMWARE_TAG} has no modular-firmware.bin asset. OTA blocked (fail-closed).`,
      latestTag,
    );
  }
  const signatureAsset = findAsset("modular-firmware.bin.sig");
  if (!signatureAsset) {
    return fail(
      "SIGNATURE_ASSET_MISSING",
      `Release ${EXPECTED_FIRMWARE_TAG} has no modular-firmware.bin.sig asset — Ed25519 signature cannot be delivered. OTA blocked (fail-closed).`,
      latestTag,
    );
  }

  // ---- Fetch and POLICY-VALIDATE the canonical manifest ----
  let manifest: ModularReleaseManifest | null = null;
  try {
    const mResp = await fetch(releaseJsonAsset.browser_download_url, { cache: "no-store" });
    if (mResp.ok) manifest = (await mResp.json()) as ModularReleaseManifest;
  } catch {
    manifest = null;
  }
  if (!manifest) {
    return fail(
      "GITHUB_API_UNREACHABLE",
      `Cannot download modular-release.json from ${EXPECTED_FIRMWARE_TAG}. OTA blocked (fail-closed).`,
      latestTag,
    );
  }

  const mVersion = typeof manifest.version === "string" ? manifest.version : "";
  const mBuildId = typeof manifest.buildId === "string" ? manifest.buildId.trim() : "";
  const mCommit = typeof manifest.gitCommit === "string" ? manifest.gitCommit.trim().toLowerCase() : "";
  const mSha = typeof manifest.firmwareSha256 === "string" ? manifest.firmwareSha256.trim().toLowerCase() : "";

  if (!SEMVER_RE.test(mVersion)) {
    return fail(
      "INVALID_MANIFEST_FIELD",
      `modular-release.json version "${mVersion}" is not valid SemVer. OTA blocked (fail-closed).`,
      latestTag,
    );
  }
  if (mVersion !== EXPECTED_FIRMWARE_VERSION) {
    return fail(
      "VERSION_POLICY_VIOLATION",
      `modular-release.json reports version ${mVersion} but the authorized release tag is ${EXPECTED_FIRMWARE_TAG}. OTA blocked (fail-closed).`,
      latestTag,
    );
  }
  if (!mBuildId) {
    return fail(
      "INVALID_MANIFEST_FIELD",
      "modular-release.json buildId is empty. OTA blocked (fail-closed).",
      latestTag,
    );
  }
  if (!COMMIT_RE.test(mCommit)) {
    return fail(
      "INVALID_MANIFEST_FIELD",
      `modular-release.json gitCommit "${mCommit.slice(0, 16)}…" is not a 40-hex commit. OTA blocked (fail-closed).`,
      latestTag,
    );
  }
  if (!SHA256_RE.test(mSha)) {
    return fail(
      "INVALID_MANIFEST_FIELD",
      `modular-release.json firmwareSha256 "${mSha.slice(0, 16)}…" is not a 64-hex SHA-256. OTA blocked (fail-closed).`,
      latestTag,
    );
  }

  const manifestAsset = findAsset("modular-manifest-canonical.json");

  cachedRelease = {
    version: mVersion,
    releaseId: mBuildId,
    gitCommit: mCommit,
    firmwareSha256: mSha,
    releaseUrl: tagData.html_url ?? "",
    manifestUrl: manifestAsset?.browser_download_url ?? "",
    firmwareUrl: firmwareAsset.browser_download_url,
    signatureUrl: signatureAsset.browser_download_url,
    expectedTag: EXPECTED_FIRMWARE_TAG,
    latestTag,
    latestMismatch: latestTag !== null && latestTag !== EXPECTED_FIRMWARE_TAG,
    fetchedAt: now,
  };
  cacheTime = now;
  return { ok: true, release: cachedRelease };
}

/**
 * Backward-compatible accessor: returns the AUTHORIZED release identity or
 * null when the authorized release cannot be established (fail-closed).
 * Note: this NEVER resolves from `releases/latest`.
 */
export async function getCanonicalRelease(): Promise<CanonicalRelease | null> {
  const res = await resolveAuthorizedRelease();
  return res.ok ? res.release : null;
}

/**
 * Verify that a given firmware SHA-256 matches the AUTHORIZED release.
 * (Authority = expected tag, never `releases/latest`.)
 */
export async function verifyFirmwareSha256(sha256: string): Promise<boolean> {
  const release = await getCanonicalRelease();
  if (!release) return false;
  return release.firmwareSha256.toLowerCase() === sha256.toLowerCase();
}
