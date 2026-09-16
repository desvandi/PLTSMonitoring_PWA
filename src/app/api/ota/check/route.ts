import { NextRequest } from 'next/server';
import { requireAuth, verifyCsrfToken } from '@/lib/auth';
import { getFirmwareInfo, isMockAuthEnabled } from '@/lib/mockStore';
import { authFailure, fail, ok } from '@/lib/apiResponse';

export const runtime = 'nodejs';

// POST /api/ota/check — check if a firmware update is available.
// [self-review] In production (mock disabled), resolve the AUTHORIZED
// release identity from the firmware repo's GitHub Releases API so the PWA
// reports the REAL authorized version + SHA-256, not a mock value.
// [P0 PWA-01 fix 2026-09-05] Authority is the pinned EXPECTED tag (immutable,
// release-tag-protection ACTIVE) — `releases/latest` is consulted ONLY for
// mismatch detection and is NEVER a source of OTA identity.
export async function POST(req: NextRequest) {
  const auth = await requireAuth({ mutation: true });
  if (!auth.ok) return authFailure(auth);
  if (!(await verifyCsrfToken(req))) return fail('Invalid CSRF token', 403);

  // Demo mode: return mock store values.
  if (isMockAuthEnabled()) {
    const info = getFirmwareInfo();
    return ok(
      {
        available: info.updateAvailable,
        latestVersion: info.latestAvailable,
        currentVersion: info.currentVersion,
        source: 'mock',
      },
      info.updateAvailable ? 'Update available (demo)' : 'Firmware is up to date (demo)',
    );
  }

  // Production: resolve the AUTHORIZED release (by immutable tag).
  try {
    const { resolveAuthorizedRelease } = await import('@/lib/release-identity');
    const res = await resolveAuthorizedRelease();
    if (!res.ok) {
      // Fail-closed: the authorized release cannot be established. Report
      // the policy state so the UI can explain WHY OTA is blocked.
      return ok(
        {
          available: false,
          latestVersion: null,
          currentVersion: null,
          expectedTag: res.expectedTag,
          latestTag: res.latestTag,
          latestMismatch: res.latestTag !== null && res.latestTag !== res.expectedTag,
          blockedReason: res.code,
          source: 'github-releases',
        },
        `Authorized release ${res.expectedTag} unavailable (${res.code}) — production OTA stays blocked (fail-closed)`,
      );
    }
    const release = res.release;
    return ok(
      {
        available: true,
        latestVersion: release.version,
        currentVersion: null, // PWA doesn't know the running firmware version
        firmwareSha256: release.firmwareSha256,
        gitCommit: release.gitCommit,
        releaseId: release.releaseId,
        releaseUrl: release.releaseUrl,
        manifestUrl: release.manifestUrl,
        expectedTag: release.expectedTag,
        latestTag: release.latestTag,
        latestMismatch: release.latestMismatch,
        source: 'github-releases',
      },
      `Authorized firmware: v${release.version} (canonical release ${release.expectedTag})`,
    );
  } catch (err) {
    return fail(
      `Failed to resolve authorized release: ${err instanceof Error ? err.message : 'unknown'}`,
      502,
    );
  }
}
