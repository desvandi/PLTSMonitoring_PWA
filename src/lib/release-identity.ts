/**
 * release-identity.ts — [Audit 9 P1] Canonical release identity for PWA.
 *
 * The PWA must NOT be a source of truth for firmware binaries. The canonical
 * source is the GitHub Release in the firmware repo. This module fetches the
 * canonical release identity (version, SHA-256, release URL) from the GitHub
 * Releases API and caches it.
 *
 * Usage:
 *   import { getCanonicalRelease } from "@/lib/release-identity";
 *   const release = await getCanonicalRelease();
 *   if (release) {
 *     console.log(release.version, release.firmwareSha256, release.releaseUrl);
 *   }
 */

export interface CanonicalRelease {
  version: string;
  releaseId: string;
  gitCommit: string;
  firmwareSha256: string;
  releaseUrl: string;
  manifestUrl: string;
  fetchedAt: number;
}

const FIRMWARE_REPO = "desvandi/PLTSMonitoring_Firmware-Backend";
const GITHUB_API = `https://api.github.com/repos/${FIRMWARE_REPO}/releases/latest`;

let cachedRelease: CanonicalRelease | null = null;
let cacheTime = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch the canonical release identity from GitHub Releases API.
 * Returns null if the fetch fails or no release exists.
 * Cached for 5 minutes to avoid rate-limiting.
 */
export async function getCanonicalRelease(): Promise<CanonicalRelease | null> {
  const now = Date.now();
  if (cachedRelease && now - cacheTime < CACHE_TTL_MS) {
    return cachedRelease;
  }

  try {
    const resp = await fetch(GITHUB_API, {
      headers: { Accept: "application/vnd.github+json" },
      cache: "no-store",
    });
    if (!resp.ok) return null;
    const data = await resp.json();

    // Find the release.json asset (modular-release.json)
    const releaseJsonAsset = (data.assets as Array<{ name: string; browser_download_url: string }>)
      ?.find((a) => a.name === "modular-release.json");
    if (!releaseJsonAsset) return null;

    // Fetch the release.json content
    const relResp = await fetch(releaseJsonAsset.browser_download_url, { cache: "no-store" });
    if (!relResp.ok) return null;
    const rel = await relResp.json();

    const manifestAsset = (data.assets as Array<{ name: string; browser_download_url: string }>)
      ?.find((a) => a.name === "modular-manifest-canonical.json");

    cachedRelease = {
      version: rel.version,
      releaseId: rel.buildId,
      gitCommit: rel.gitCommit,
      firmwareSha256: rel.firmwareSha256,
      releaseUrl: data.html_url,
      manifestUrl: manifestAsset?.browser_download_url ?? "",
      fetchedAt: now,
    };
    cacheTime = now;
    return cachedRelease;
  } catch {
    return null;
  }
}

/**
 * Verify that a given firmware SHA-256 matches the canonical release.
 * Returns true if the SHA matches the latest GitHub Release.
 */
export async function verifyFirmwareSha256(sha256: string): Promise<boolean> {
  const release = await getCanonicalRelease();
  if (!release) return false;
  return release.firmwareSha256.toLowerCase() === sha256.toLowerCase();
}
