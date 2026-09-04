// =============================================================================
// admin-token-session.test.ts — P1-3 remediation contract.
// -----------------------------------------------------------------------------
// AUDIT FINDING (P1): the operator ADMIN_TOKEN was persisted inside the
// localStorage PLTS_SYS_CONFIG blob (survives forever — XSS / shared machine
// / profile leak would hand over the fleet-level credential).
//
// REMEDIATION TRUTH RULES under test:
//   S1  setAdminToken/getAdminToken round-trip per device (sessionStorage).
//   S2  Empty token CLEARS the entry (no stale secrets).
//   S3  clearAllAdminTokens wipes everything.
//   S4  persistSysConfig() NEVER writes admin_token into localStorage — even
//       when a profile still carries one, it is migrated + stripped.
//   S5  readSysConfig() migrates a LEGACY payload (token on disk) into the
//       session store and re-persists the blob CLEAN.
//   S6  resolveAdminToken(): session store wins over the deprecated profile
//       field; profile field is the fallback when the session is empty.
//   S7  sendEmergencyCommand() resolves the token through the session store
//       (profile without the field still sends; empty everywhere = refuse).
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

// Reset module state between tests: the memory fallback Map is module-scope.
let sysConfigModule: typeof import("../sysConfig");
let sessionModule: typeof import("../adminTokenSession");

beforeEach(async () => {
  localStore.clear();
  sessionStore.clear();
  vi.stubGlobal("window", windowShim);
  vi.resetModules();
  sysConfigModule = await import("../sysConfig");
  sessionModule = await import("../adminTokenSession");
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

const PROFILE_BASE = {
  device_id: "PLTS_A",
  label: "Basecamp A",
  gas_webapp_url: "https://script.google.com/macros/s/A/exec",
  auth_token: "plts_sec_A",
  dashboard_settings: { ...DASHBOARD },
};

describe("S1-S3 — session-scoped token store", () => {
  it("S1 set/get round-trips per device", () => {
    sessionModule.setAdminToken("PLTS_A", "secret-A");
    sessionModule.setAdminToken("PLTS_B", "secret-B");
    expect(sessionModule.getAdminToken("PLTS_A")).toBe("secret-A");
    expect(sessionModule.getAdminToken("PLTS_B")).toBe("secret-B");
    expect(sessionModule.getAdminToken("PLTS_UNKNOWN")).toBeUndefined();
  });

  it("S2 empty token clears the entry (no stale secrets)", () => {
    sessionModule.setAdminToken("PLTS_A", "secret-A");
    sessionModule.setAdminToken("PLTS_A", "");
    expect(sessionModule.getAdminToken("PLTS_A")).toBeUndefined();
    // And the raw sessionStorage blob no longer mentions the secret:
    const raw = sessionStore.get("PLTS_ADMIN_TOKENS");
    expect(raw).toBeUndefined();
  });

  it("S3 clearAllAdminTokens wipes everything", () => {
    sessionModule.setAdminToken("PLTS_A", "secret-A");
    sessionModule.setAdminToken("PLTS_B", "secret-B");
    sessionModule.clearAllAdminTokens();
    expect(sessionModule.getAdminToken("PLTS_A")).toBeUndefined();
    expect(sessionModule.getAdminToken("PLTS_B")).toBeUndefined();
  });
});

describe("S4 — persistSysConfig NEVER writes admin_token to localStorage", () => {
  it("strips the token from the disk blob and migrates it to the session store", () => {
    const cfg = sysConfigModule.persistSysConfig({
      gas_webapp_url: PROFILE_BASE.gas_webapp_url,
      auth_token: PROFILE_BASE.auth_token,
      device_id: PROFILE_BASE.device_id,
      dashboard_settings: PROFILE_BASE.dashboard_settings,
      active_device_id: PROFILE_BASE.device_id,
      devices: [{ ...PROFILE_BASE, admin_token: "operator-secret" }],
    });
    // The persisted blob must not leak the secret…
    const raw = localStore.get("PLTS_SYS_CONFIG") ?? "";
    expect(raw.length).toBeGreaterThan(0);
    expect(raw.includes("operator-secret")).toBe(false);
    const parsedBlob = JSON.parse(raw) as { devices: Array<{ admin_token?: string }> };
    expect(parsedBlob.devices[0]?.admin_token).toBeUndefined();
    // …and the enriched return value must be clean too.
    expect(cfg.devices[0].admin_token).toBeUndefined();
    // The secret rode the session store instead.
    expect(sessionModule.getAdminToken("PLTS_A")).toBe("operator-secret");
  });
});

describe("S5 — readSysConfig migrates a legacy (token-on-disk) payload", () => {
  it("moves the secret into the session store and re-persists CLEAN", () => {
    // Hand-craft a legacy v2 blob that still carries admin_token on disk.
    const legacy = {
      version: "2.0.0",
      updated_at: "2026-08-01T00:00:00.000Z",
      gas_webapp_url: PROFILE_BASE.gas_webapp_url,
      auth_token: PROFILE_BASE.auth_token,
      device_id: PROFILE_BASE.device_id,
      dashboard_settings: PROFILE_BASE.dashboard_settings,
      active_device_id: PROFILE_BASE.device_id,
      devices: [{ ...PROFILE_BASE, admin_token: "legacy-secret" }],
    };
    localStore.set("PLTS_SYS_CONFIG", JSON.stringify(legacy));

    const read = sysConfigModule.readSysConfig();
    expect(read).not.toBeNull();
    // Secret migrated to the session store…
    expect(sessionModule.getAdminToken("PLTS_A")).toBe("legacy-secret");
    // …and the on-disk blob is now clean.
    const rawAfter = localStore.get("PLTS_SYS_CONFIG") ?? "";
    expect(rawAfter.includes("legacy-secret")).toBe(false);
    expect(read?.devices[0]?.admin_token).toBeUndefined();
  });
});

describe("S6 — resolveAdminToken precedence", () => {
  it("session store wins over the deprecated profile field", () => {
    sessionModule.setAdminToken("PLTS_A", "session-wins");
    expect(
      sessionModule.resolveAdminToken({ device_id: "PLTS_A", admin_token: "profile-loses" })
    ).toBe("session-wins");
  });

  it("profile field is the fallback when the session is empty", () => {
    expect(
      sessionModule.resolveAdminToken({ device_id: "PLTS_A", admin_token: "profile-fallback" })
    ).toBe("profile-fallback");
  });

  it("empty everywhere → undefined (fail-closed)", () => {
    expect(sessionModule.resolveAdminToken({ device_id: "PLTS_A" })).toBeUndefined();
    expect(sessionModule.resolveAdminToken({ device_id: "PLTS_A", admin_token: "  " })).toBeUndefined();
  });
});

describe("S7 — sendEmergencyCommand resolves via the session store", () => {
  it("sends with the session-stored token even when the profile omits it", async () => {
    const emergency = await import("../emergency");
    sessionModule.setAdminToken("PLTS_A", "session-secret");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: "SUCCESS", message: "OK", data: { command_id: "c1" } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const res = await emergency.sendEmergencyCommand(
      {
        gas_webapp_url: PROFILE_BASE.gas_webapp_url,
        auth_token: PROFILE_BASE.auth_token,
        device_id: "PLTS_A",
        admin_token: undefined,
      },
      "ARM"
    );
    expect(res.ok).toBe(true);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.admin_token).toBe("session-secret");
  });

  it("refuses (fail-closed) when neither session nor profile has a token", async () => {
    const emergency = await import("../emergency");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await emergency.sendEmergencyCommand(
      {
        gas_webapp_url: PROFILE_BASE.gas_webapp_url,
        auth_token: PROFILE_BASE.auth_token,
        device_id: "PLTS_A",
        admin_token: undefined,
      },
      "DISARM"
    );
    expect(res.ok).toBe(false);
    expect(res.message).toContain("ADMIN_TOKEN");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
