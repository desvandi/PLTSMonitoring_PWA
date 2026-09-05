/**
 * release-policy.ts — [Audit 2026-09-05 re-audit · P1-5] Authorized release
 * policy invariant.
 *
 * POLICY (unchangeable by environment in production):
 *   production build
 *       ↓
 *   authorized firmware release identity (release-policy.json)
 *       ↓
 *   IMMUTABLE
 *
 * The authorized production tag is a committed POLICY INVARIANT, not an
 * operator-provided environment choice. If `NEXT_PUBLIC_EXPECTED_FIRMWARE_TAG`
 * is set on the production channel and differs from the authorized tag, this
 * module THROWS at import time — which fails `next build` (the bundler imports
 * this module), fails vitest, and fails any production server start. That is
 * the audit's required behavior:
 *
 *   EXPECTED_FIRMWARE_TAG == authorized release policy == published production
 *   release, else BUILD FAIL — not a warning.
 *
 * Overrides remain possible ONLY on the explicit staging channel
 * (`NEXT_PUBLIC_RELEASE_CHANNEL=staging`), which exists for pre-release
 * channel testing. A staging override never authorizes production OTA by
 * itself: the device still verifies SHA-256 + Ed25519, and the release must
 * exist under the overridden tag.
 *
 * Single source of truth: `release-policy.json` (repo root) — also consumed
 * by `scripts/validate-production-config.mjs` and the CI
 * `production-identity` gate, so code, script, and CI can never disagree.
 */
import policy from "../../release-policy.json";

export interface ReleasePolicy {
  authorizedProductionTag: string;
  authorizedProductionVersion: string;
}

const POLICY = policy as ReleasePolicy;

/** The one tag a production build of this PWA is authorized to deploy. */
export const AUTHORIZED_PRODUCTION_TAG: string = POLICY.authorizedProductionTag;

/** Same as AUTHORIZED_PRODUCTION_TAG without the leading "v". */
export const AUTHORIZED_PRODUCTION_VERSION: string = POLICY.authorizedProductionVersion;

export type ReleaseChannel = "production" | "staging";

const TAG_RE = /^v\d+\.\d+\.\d+$/;

export interface ExpectedTagResolution {
  /** The tag this PWA build is authorized to deploy. */
  tag: string;
  /** Channel this build runs on. */
  channel: ReleaseChannel;
  /** true when the tag came from an env override (staging only). */
  fromEnvOverride: boolean;
}

/**
 * Resolve the release channel. Default (and any unrecognized value) is an
 * ERROR, not a silent fallback to production: a typo like
 * NEXT_PUBLIC_RELEASE_CHANNEL=prodution must fail loudly, not silently
 * downgrade the channel.
 */
export function resolveReleaseChannel(): ReleaseChannel {
  const raw = (process.env.NEXT_PUBLIC_RELEASE_CHANNEL ?? "").trim().toLowerCase();
  if (raw === "" || raw === "production") return "production";
  if (raw === "staging") return "staging";
  throw new Error(
    `RELEASE POLICY VIOLATION: NEXT_PUBLIC_RELEASE_CHANNEL="${raw}" is not a valid channel ` +
      `("production" | "staging"). Refusing to guess — production OTA must never run on an ` +
      `ambiguous channel configuration.`,
  );
}

/**
 * Resolve the expected firmware tag under policy:
 *   - production channel: ALWAYS the authorized tag from release-policy.json.
 *     A differing env override is a hard error (fail-closed).
 *   - staging channel: env override allowed (explicit opt-in), must still be
 *     a well-formed vX.Y.Z tag.
 */
export function resolveExpectedFirmwareTag(): ExpectedTagResolution {
  const channel = resolveReleaseChannel();
  const envTag = (process.env.NEXT_PUBLIC_EXPECTED_FIRMWARE_TAG ?? "").trim();

  if (channel === "production") {
    if (envTag !== "" && envTag !== AUTHORIZED_PRODUCTION_TAG) {
      throw new Error(
        `RELEASE POLICY VIOLATION: NEXT_PUBLIC_EXPECTED_FIRMWARE_TAG="${envTag}" does not ` +
          `match the authorized production release tag "${AUTHORIZED_PRODUCTION_TAG}" ` +
          `(release-policy.json). The production release identity is an INVARIANT, not an ` +
          `operator choice. To test a pre-release channel, set ` +
          `NEXT_PUBLIC_RELEASE_CHANNEL=staging explicitly. Build FAILS closed.`,
      );
    }
    return { tag: AUTHORIZED_PRODUCTION_TAG, channel, fromEnvOverride: false };
  }

  // staging: explicit override channel
  const tag = envTag !== "" ? envTag : AUTHORIZED_PRODUCTION_TAG;
  if (!TAG_RE.test(tag)) {
    throw new Error(
      `RELEASE POLICY VIOLATION: expected firmware tag "${tag}" is not a well-formed ` +
        `vX.Y.Z tag. Build FAILS closed.`,
    );
  }
  return { tag, channel, fromEnvOverride: tag !== AUTHORIZED_PRODUCTION_TAG };
}
