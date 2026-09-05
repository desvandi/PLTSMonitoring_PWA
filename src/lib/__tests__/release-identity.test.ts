// =============================================================================
// release-identity.test.ts — [P0 PWA-01 regression tests]
// Policy under test:
//   1. Canonical identity resolves from the EXPECTED immutable tag — NEVER
//      from the mutable `releases/latest` pointer.
//   2. latest != expected → the PWA must NOT silently flash latest; the
//      mismatch is surfaced (latestMismatch) instead.
//   3. Authorized release missing / invalid manifest → FAIL-CLOSED.
// =============================================================================
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearReleaseIdentityCache,
  EXPECTED_FIRMWARE_TAG,
  getCanonicalRelease,
  resolveAuthorizedRelease,
  verifyFirmwareSha256,
} from "@/lib/release-identity";

const REPO = "desvandi/PLTSMonitoring_Firmware-Backend";
const TAG_URL = `https://api.github.com/repos/${REPO}/releases/tags/${EXPECTED_FIRMWARE_TAG}`;
const LATEST_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const REL_JSON_URL = "https://assets.example.invalid/modular-release.json";
const BIN_URL = "https://assets.example.invalid/modular-firmware.bin";
const SIG_URL = "https://assets.example.invalid/modular-firmware.bin.sig";

const SHA = "a".repeat(64);
const COMMIT = "c".repeat(40);

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface TagReleaseOpts {
  latestTag?: string;
  tagStatus?: number;
  manifest?: Record<string, unknown>;
  omitAsset?: "bin" | "sig" | "manifest";
}

function makeFetch(opts: TagReleaseOpts = {}): ReturnType<typeof vi.fn> {
  const {
    latestTag = EXPECTED_FIRMWARE_TAG,
    tagStatus = 200,
    manifest = { version: "1.9.3", buildId: "build-193", gitCommit: COMMIT, firmwareSha256: SHA },
    omitAsset,
  } = opts;

  const assets = [
    { name: "modular-release.json", browser_download_url: REL_JSON_URL },
    omitAsset !== "bin" && { name: "modular-firmware.bin", browser_download_url: BIN_URL },
    omitAsset !== "sig" && { name: "modular-firmware.bin.sig", browser_download_url: SIG_URL },
    { name: "modular-manifest-canonical.json", browser_download_url: "https://assets.example.invalid/modular-manifest-canonical.json" },
  ].filter(Boolean);

  return vi.fn(async (url: string | URL): Promise<Response> => {
    const u = String(url);
    if (u === LATEST_URL) return jsonResponse({ tag_name: latestTag });
    if (u === TAG_URL) {
      if (tagStatus !== 200) return new Response("not found", { status: tagStatus });
      return jsonResponse({
        html_url: `https://github.com/${REPO}/releases/tag/${EXPECTED_FIRMWARE_TAG}`,
        assets,
      });
    }
    if (u === REL_JSON_URL) return jsonResponse(manifest);
    return new Response("not found", { status: 404 });
  });
}

beforeEach(() => {
  clearReleaseIdentityCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("resolveAuthorizedRelease — authority policy (P0 PWA-01)", () => {
  it("pins the expected tag by default (v1.9.3 release candidate)", () => {
    expect(EXPECTED_FIRMWARE_TAG).toBe("v1.9.3");
  });

  it("resolves the authorized release BY TAG when latest == expected", async () => {
    vi.stubGlobal("fetch", makeFetch());
    const res = await resolveAuthorizedRelease();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.release.version).toBe("1.9.3");
    expect(res.release.expectedTag).toBe("v1.9.3");
    expect(res.release.latestTag).toBe("v1.9.3");
    expect(res.release.latestMismatch).toBe(false);
    expect(res.release.firmwareUrl).toBe(BIN_URL);
    expect(res.release.signatureUrl).toBe(SIG_URL);
    expect(res.release.firmwareSha256).toBe(SHA);
    expect(res.release.gitCommit).toBe(COMMIT);
  });

  it("REGRESSION: latest != expected → canonical still comes from the TAG, never latest", async () => {
    // GitHub "latest" is still v1.8.0 while the authorized release is v1.9.3.
    // The PWA must resolve v1.9.3 (by tag), flag the mismatch, and NEVER
    // silently offer/flash v1.8.0.
    vi.stubGlobal("fetch", makeFetch({ latestTag: "v1.8.0" }));
    const res = await resolveAuthorizedRelease();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.release.version).toBe("1.9.3");
    expect(res.release.latestTag).toBe("v1.8.0");
    expect(res.release.latestMismatch).toBe(true);
    expect(res.release.releaseUrl).toContain(`/releases/tag/v1.9.3`);
    expect(res.release.version).not.toBe("1.8.0");
  });

  it("tag not published (404) → FAIL-CLOSED with EXPECTED_RELEASE_NOT_PUBLISHED", async () => {
    vi.stubGlobal("fetch", makeFetch({ tagStatus: 404, latestTag: "v1.8.0" }));
    const res = await resolveAuthorizedRelease();
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe("EXPECTED_RELEASE_NOT_PUBLISHED");
    expect(res.latestTag).toBe("v1.8.0");
    // No fallback to latest — getCanonicalRelease must return null.
    expect(await getCanonicalRelease()).toBeNull();
  });

  it("manifest version drift → VERSION_POLICY_VIOLATION (fail-closed)", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetch({ manifest: { version: "1.8.0", buildId: "b", gitCommit: COMMIT, firmwareSha256: SHA } }),
    );
    const res = await resolveAuthorizedRelease();
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe("VERSION_POLICY_VIOLATION");
  });

  it("malformed SHA-256 in manifest → INVALID_MANIFEST_FIELD (fail-closed)", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetch({ manifest: { version: "1.9.3", buildId: "b", gitCommit: COMMIT, firmwareSha256: "zz" } }),
    );
    const res = await resolveAuthorizedRelease();
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe("INVALID_MANIFEST_FIELD");
  });

  it("malformed git commit in manifest → INVALID_MANIFEST_FIELD (fail-closed)", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetch({ manifest: { version: "1.9.3", buildId: "b", gitCommit: "deadbeef", firmwareSha256: SHA } }),
    );
    const res = await resolveAuthorizedRelease();
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe("INVALID_MANIFEST_FIELD");
  });

  it("non-SemVer manifest version → INVALID_MANIFEST_FIELD (fail-closed)", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetch({ manifest: { version: "1.9", buildId: "b", gitCommit: COMMIT, firmwareSha256: SHA } }),
    );
    const res = await resolveAuthorizedRelease();
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe("INVALID_MANIFEST_FIELD");
  });

  it("missing firmware asset on the release → FIRMWARE_ASSET_MISSING (fail-closed)", async () => {
    vi.stubGlobal("fetch", makeFetch({ omitAsset: "bin" }));
    const res = await resolveAuthorizedRelease();
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe("FIRMWARE_ASSET_MISSING");
  });

  it("missing signature asset on the release → SIGNATURE_ASSET_MISSING (fail-closed)", async () => {
    vi.stubGlobal("fetch", makeFetch({ omitAsset: "sig" }));
    const res = await resolveAuthorizedRelease();
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe("SIGNATURE_ASSET_MISSING");
  });

  it("GitHub API network failure → GITHUB_API_UNREACHABLE (fail-closed)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    const res = await resolveAuthorizedRelease();
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe("GITHUB_API_UNREACHABLE");
    expect(await getCanonicalRelease()).toBeNull();
  });
});

describe("verifyFirmwareSha256 — authority is the authorized release", () => {
  it("matches only the authorized release SHA", async () => {
    vi.stubGlobal("fetch", makeFetch({ latestTag: "v1.8.0" }));
    expect(await verifyFirmwareSha256(SHA)).toBe(true);
    expect(await verifyFirmwareSha256("b".repeat(64))).toBe(false);
  });

  it("returns false when the authorized release cannot be established", async () => {
    vi.stubGlobal("fetch", makeFetch({ tagStatus: 404 }));
    expect(await verifyFirmwareSha256(SHA)).toBe(false);
  });
});
