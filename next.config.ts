import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";
import releasePolicy from "./release-policy.json";

// ============================================================================
// [Audit 2026-09-05 re-audit · P1-5] BUILD-TIME release identity invariant.
// next.config.ts is evaluated by `next build` BEFORE any compilation, so this
// check is guaranteed to run at build time with the real process.env —
// exactly the audit requirement:
//
//   production build
//       ↓
//   authorized firmware release identity (release-policy.json)
//       ↓
//   IMMUTABLE — a mismatched NEXT_PUBLIC_EXPECTED_FIRMWARE_TAG FAILS the build.
//
// The same invariant is ALSO enforced at runtime by
// src/lib/release-policy.ts (module-init throw) and in CI by the
// production-config-gate job. Three independent layers, one policy file.
// Staging channels (NEXT_PUBLIC_RELEASE_CHANNEL=staging) may override the tag
// explicitly — production never can.
// ============================================================================
const AUTHORIZED_TAG: string = releasePolicy.authorizedProductionTag;
const channel = (process.env.NEXT_PUBLIC_RELEASE_CHANNEL ?? "production").trim().toLowerCase();
if (channel !== "production" && channel !== "staging") {
  throw new Error(
    `RELEASE POLICY VIOLATION: NEXT_PUBLIC_RELEASE_CHANNEL="${channel}" is not a valid channel ` +
      `("production" | "staging"). Build FAILS closed.`,
  );
}
if (channel === "production") {
  const envTag = (process.env.NEXT_PUBLIC_EXPECTED_FIRMWARE_TAG ?? "").trim();
  if (envTag !== "" && envTag !== AUTHORIZED_TAG) {
    throw new Error(
      `RELEASE POLICY VIOLATION: NEXT_PUBLIC_EXPECTED_FIRMWARE_TAG="${envTag}" does not match ` +
        `the authorized production release tag "${AUTHORIZED_TAG}" (release-policy.json). ` +
        `The production release identity is an INVARIANT, not an operator choice. ` +
        `For a pre-release channel use NEXT_PUBLIC_RELEASE_CHANNEL=staging. Build FAILS closed.`,
    );
  }
}

const withSerwist = withSerwistInit({
  swSrc: "src/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development" && !process.env.SERWIST_DEV,
  reloadOnOnline: true,
  cacheOnNavigation: true,
});

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  typescript: {
    ignoreBuildErrors: false,
  },
  serverExternalPackages: ["mqtt"],
  turbopack: {},
};

export default withSerwist(nextConfig);
