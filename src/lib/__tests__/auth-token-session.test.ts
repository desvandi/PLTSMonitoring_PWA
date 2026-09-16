// =============================================================================
// auth-token-session.test.ts — [AUDIT p.483 REMEDIATION contract]
// -----------------------------------------------------------------------------
// AUDIT FINDING (p.483): the GAS AUTH_TOKEN (per-device viewer credential)
// was persisted inside the localStorage PLTS_SYS_CONFIG blob — surviving
// forever across browser sessions (XSS / shared machine / profile leak).
//
// REMEDIATION TRUTH RULES under test:
//   A1  setAuthToken/getAuthToken round-trip per device (sessionStorage).
//   A2  Empty token CLEARS the entry.
//   A3  resolveAuthToken(): session store wins; profile field is the
//       in-session fallback; empty everywhere = '' (fail-closed downstream).
//   A4  persistSysConfig() NEVER writes auth_token into localStorage — it is
//       migrated to the session store and stripped from the disk blob, while
//       the RETURNED (in-memory) config still resolves it for same-session
//       consumers (setup wizard immediate PING).
//   A5  readSysConfig() migrates a LEGACY payload (token on disk) into the
//       session store and re-persists the blob CLEAN (token-free).
//   A6  After a "browser restart" (session storage wiped, disk blob kept),
//       the config is still VALID (URL/settings) but auth_token resolves to
//       '' — GAS requests fail honestly instead of silently using nothing.
// =============================================================================
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const localStore = new Map<string, string>();
const sessionStore = new Map<string, string>();

const windowShim = {
  localStorage: {
    getItem: (k: string) => localStore.get(k) ?? null,
    setItem: (k: string, v: string) => void localStore.set(k, v),
    removeItem: (k: string) => void localStore.delete(k),
  },
  sessionStorage: {
    getItem: (k: string) => sessionStore.get(k) ?? null,
    setItem: (k: string, v: string) => void sessionStore.set(k, v),
    removeItem: (k: string) => void sessionStore.delete(k),
  },
  dispatchEvent: () => true,
};

let sysConfigModule: typeof import("../sysConfig");
let authSessionModule: typeof import("../authTokenSession");

beforeEach(async () => {
  localStore.clear();
  sessionStore.clear();
  vi.stubGlobal("window", windowShim);
  vi.resetModules();
  sysConfigModule = await import("../sysConfig");
  authSessionModule = await import("../authTokenSession");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const DASHBOARD = {
  telemetry_refresh_interval_sec: 5,
  battery_nominal_voltage: 48,
  battery_capacity_ah: 200,
  low_battery_warning_threshold: 45,
  enable_audio_alarm: true,
  theme: "dark" as const,
};

const PROFILE = {
  device_id: "PLTS_A",
  label: "Basecamp A",
  gas_webapp_url: "https://script.google.com/macros/s/A/exec",
  auth_token: "viewer-secret-A",
  dashboard_settings: { ...DASHBOARD },
};

describe("A1-A3 — session-scoped auth-token store", () => {
  it("A1 set/get round-trips per device", () => {
    authSessionModule.setAuthToken("PLTS_A", "tok-A");
    authSessionModule.setAuthToken("PLTS_B", "tok-B");
    expect(authSessionModule.getAuthToken("PLTS_A")).toBe("tok-A");
    expect(authSessionModule.getAuthToken("PLTS_B")).toBe("tok-B");
    expect(authSessionModule.getAuthToken("PLTS_UNKNOWN")).toBeUndefined();
  });

  it("A2 empty token clears the entry (no stale secrets)", () => {
    authSessionModule.setAuthToken("PLTS_A", "tok-A");
    authSessionModule.setAuthToken("PLTS_A", "");
    expect(authSessionModule.getAuthToken("PLTS_A")).toBeUndefined();
    expect(sessionStore.get("PLTS_AUTH_TOKENS")).toBeUndefined();
  });

  it("A3 session store wins over the deprecated profile field", () => {
    authSessionModule.setAuthToken("PLTS_A", "session-token");
    expect(
      authSessionModule.resolveAuthToken({ device_id: "PLTS_A", auth_token: "profile-token" }),
    ).toBe("session-token");
    // Profile fallback when the session store is empty:
    authSessionModule.setAuthToken("PLTS_A", ""); // clear the session entry
    expect(
      authSessionModule.resolveAuthToken({ device_id: "PLTS_A", auth_token: "profile-token" }),
    ).toBe("profile-token");
    // Empty everywhere → '' (GAS calls fail closed downstream):
    expect(authSessionModule.resolveAuthToken({ device_id: "PLTS_A", auth_token: "" })).toBe("");
  });
});

describe("A4 — persistSysConfig never writes auth_token to localStorage", () => {
  it("migrates the token to the session store + strips the disk blob; return value resolves it", () => {
    const cfg = sysConfigModule.persistSysConfig({
      gas_webapp_url: PROFILE.gas_webapp_url,
      auth_token: PROFILE.auth_token,
      device_id: PROFILE.device_id,
      dashboard_settings: { ...DASHBOARD },
      active_device_id: PROFILE.device_id,
      devices: [{ ...PROFILE }],
    });

    // The session store now holds the viewer credential…
    expect(authSessionModule.getAuthToken("PLTS_A")).toBe("viewer-secret-A");
    // …and the localStorage blob NEVER contains it.
    const raw = localStore.get("PLTS_SYS_CONFIG") ?? "";
    expect(raw.includes("viewer-secret-A")).toBe(false);
    const parsed = JSON.parse(raw) as { auth_token: string; devices: Array<{ auth_token: string }> };
    expect(parsed.auth_token).toBe("");
    expect(parsed.devices[0]?.auth_token).toBe("");
    // The in-memory return still resolves the token (same-session PING works).
    expect(cfg.auth_token).toBe("viewer-secret-A");
    expect(cfg.devices[0]?.auth_token).toBe("viewer-secret-A");
  });
});

describe("A5 — readSysConfig migrates a legacy (token-on-disk) payload", () => {
  it("moves the token into the session store and re-persists CLEAN", () => {
    // Legacy v1-style blob with the token baked into the disk payload.
    localStore.set(
      "PLTS_SYS_CONFIG",
      JSON.stringify({ version: "2.0.0", updated_at: "2026-01-01T00:00:00Z", ...PROFILE }),
    );
    const read = sysConfigModule.readSysConfig();
    expect(read).not.toBeNull();
    // Token migrated to the session store…
    expect(authSessionModule.getAuthToken("PLTS_A")).toBe("viewer-secret-A");
    // …disk blob rewritten clean…
    const rawAfter = localStore.get("PLTS_SYS_CONFIG") ?? "";
    expect(rawAfter.includes("viewer-secret-A")).toBe(false);
    // …and the in-memory view resolves the token for this session.
    expect(read?.auth_token).toBe("viewer-secret-A");
  });
});

describe("A6 — after a browser restart the config is valid but tokenless", () => {
  it("session store wiped → auth_token resolves to '' (fail-closed, honest)", async () => {
    // First visit: persist a config (token → session store, disk clean).
    sysConfigModule.persistSysConfig({
      gas_webapp_url: PROFILE.gas_webapp_url,
      auth_token: PROFILE.auth_token,
      device_id: PROFILE.device_id,
      dashboard_settings: { ...DASHBOARD },
      active_device_id: PROFILE.device_id,
      devices: [{ ...PROFILE }],
    });
    // "Restart": sessionStorage dies, localStorage survives.
    sessionStore.clear();
    vi.resetModules();
    sysConfigModule = await import("../sysConfig");
    authSessionModule = await import("../authTokenSession");

    const read = sysConfigModule.readSysConfig();
    // The profile itself remains valid (URL + settings survived)…
    expect(read).not.toBeNull();
    expect(read?.gas_webapp_url).toBe(PROFILE.gas_webapp_url);
    // …but the credential is gone — the operator re-enters it once per
    // session (documented trade-off, mirrors the admin token).
    expect(read?.auth_token).toBe("");
    expect(read?.devices[0]?.auth_token).toBe("");
  });
});
