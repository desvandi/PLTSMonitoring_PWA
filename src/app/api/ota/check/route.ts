import { NextRequest } from 'next/server';
import { requireAuth, verifyCsrfToken } from '@/lib/auth';
import { getFirmwareInfo, isMockAuthEnabled } from '@/lib/mockStore';
import { ok, fail, unauthorized } from '@/lib/apiResponse';

export const runtime = 'nodejs';

// POST /api/ota/check — check if a firmware update is available.
// [self-review] In production (mock disabled), fetch the canonical release
// identity from the firmware repo's GitHub Releases API so the PWA reports
// the REAL latest version + SHA-256, not a mock value.
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (!auth.ok) return unauthorized(auth.message);
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

  // Production: fetch canonical release from GitHub Releases API.
  try {
    const { getCanonicalRelease } = await import('@/lib/release-identity');
    const release = await getCanonicalRelease();
    if (!release) {
      return ok(
        {
          available: false,
          latestVersion: null,
          currentVersion: null,
          source: 'github-releases',
        },
        'No canonical release found (GitHub Releases API unreachable or no releases)',
      );
    }
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
        source: 'github-releases',
      },
      `Latest firmware: v${release.version} (canonical GitHub Release)`,
    );
  } catch (err) {
    return fail(
      `Failed to fetch canonical release: ${err instanceof Error ? err.message : 'unknown'}`,
      502,
    );
  }
}
