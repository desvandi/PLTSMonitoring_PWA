// =============================================================================
// release-policy.test.ts — [Audit 2026-09-05 re-audit · P1-5 regression tests]
// Policy under test:
//   1. The authorized production tag is an INVARIANT resolved from
//      release-policy.json — it can NEVER be overridden by environment on
//      the production channel (mismatch = throw = build fails).
//   2. Overrides are only possible on the EXPLICIT staging channel.
//   3. An unrecognized channel value is an error, not a silent production
//      fallback.
// =============================================================================
import { afterEach, describe, expect, it } from "vitest";

import {
  AUTHORIZED_PRODUCTION_TAG,
  AUTHORIZED_PRODUCTION_VERSION,
  resolveExpectedFirmwareTag,
  resolveReleaseChannel,
} from "@/lib/release-policy";
import policyJson from "../../../release-policy.json";

const ENV_KEYS = [
  "NEXT_PUBLIC_RELEASE_CHANNEL",
  "NEXT_PUBLIC_EXPECTED_FIRMWARE_TAG",
] as const;

function setEnv(kv: Partial<Record<(typeof ENV_KEYS)[number], string>>) {
  for (const k of ENV_KEYS) {
    if (k in kv) process.env[k] = kv[k];
  }
}

afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
});

describe("release-policy — single source of truth", () => {
  it("release-policy.json declares a well-formed authorized production tag", () => {
    expect(policyJson.authorizedProductionTag).toMatch(/^v\d+\.\d+\.\d+$/);
    expect(policyJson.authorizedProductionTag).toBe(AUTHORIZED_PRODUCTION_TAG);
    expect(AUTHORIZED_PRODUCTION_VERSION).toBe(AUTHORIZED_PRODUCTION_TAG.replace(/^v/, ""));
  });
});

describe("release-policy — production channel invariance (P1-5)", () => {
  it("default (no env) resolves the authorized production tag", () => {
    const r = resolveExpectedFirmwareTag();
    expect(r).toEqual({
      tag: AUTHORIZED_PRODUCTION_TAG,
      channel: "production",
      fromEnvOverride: false,
    });
  });

  it("env override EQUAL to the authorized tag is accepted on production", () => {
    setEnv({ NEXT_PUBLIC_EXPECTED_FIRMWARE_TAG: AUTHORIZED_PRODUCTION_TAG });
    const r = resolveExpectedFirmwareTag();
    expect(r.tag).toBe(AUTHORIZED_PRODUCTION_TAG);
    expect(r.channel).toBe("production");
    expect(r.fromEnvOverride).toBe(false);
  });

  it("env override DIFFERING from the authorized tag THROWS on production (build must fail)", () => {
    setEnv({ NEXT_PUBLIC_EXPECTED_FIRMWARE_TAG: "v0.0.1" });
    expect(() => resolveExpectedFirmwareTag()).toThrow(/RELEASE POLICY VIOLATION/);
    expect(() => resolveExpectedFirmwareTag()).toThrow(/v0\.0\.1/);
  });

  it("explicit production channel is required to stay production", () => {
    setEnv({ NEXT_PUBLIC_RELEASE_CHANNEL: "production" });
    expect(resolveReleaseChannel()).toBe("production");
  });

  it("an UNRECOGNIZED channel value is an error, not a silent production fallback", () => {
    setEnv({ NEXT_PUBLIC_RELEASE_CHANNEL: "prodution" }); // typo on purpose
    expect(() => resolveReleaseChannel()).toThrow(/RELEASE POLICY VIOLATION/);
    expect(() => resolveReleaseChannel()).toThrow(/prodution/);
  });
});

describe("release-policy — staging channel (explicit opt-in)", () => {
  it("staging channel allows a well-formed tag override", () => {
    setEnv({
      NEXT_PUBLIC_RELEASE_CHANNEL: "staging",
      NEXT_PUBLIC_EXPECTED_FIRMWARE_TAG: "v1.9.4",
    });
    const r = resolveExpectedFirmwareTag();
    expect(r).toEqual({ tag: "v1.9.4", channel: "staging", fromEnvOverride: true });
  });

  it("staging channel without override falls back to the authorized tag", () => {
    setEnv({ NEXT_PUBLIC_RELEASE_CHANNEL: "staging" });
    const r = resolveExpectedFirmwareTag();
    expect(r.tag).toBe(AUTHORIZED_PRODUCTION_TAG);
    expect(r.fromEnvOverride).toBe(false);
  });

  it("staging channel rejects a malformed tag", () => {
    setEnv({
      NEXT_PUBLIC_RELEASE_CHANNEL: "staging",
      NEXT_PUBLIC_EXPECTED_FIRMWARE_TAG: "latest",
    });
    expect(() => resolveExpectedFirmwareTag()).toThrow(/not a well-formed/);
  });
});
