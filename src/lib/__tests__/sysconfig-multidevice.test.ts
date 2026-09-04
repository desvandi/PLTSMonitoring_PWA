// =============================================================================
// sysConfig multi-device semantics — regression coverage for the 2026-08-28
// pre-bench audit of the "Setup Awal PLTS Monitor" flow.
// -----------------------------------------------------------------------------
// Truth rules under test:
//   F1  updateActiveDevice() preserves the rest of the fleet — the /setup edit
//       path previously collapsed devices[] to a single entry via
//       writeSysConfig(), silently destroying every other profile.
//   F1b Renaming the active device leaves no orphan duplicate.
//   F8  addDeviceToConfig() upserts by device_id (documented — the setup UI
//       now BLOCKS duplicate ids before this can trigger).
//   F4  validateSysConfig() accepts multi-device backups and resolves the
//       active device; v1 legacy single-device blobs migrate to v2.
//   F5  Dashboard settings defaults stay 48 V / 200 Ah / 45 V (P0-007).
//   F10 parseLatestEnvelope() reads the CANONICAL NESTED GAS envelope
//       (data.battery.voltage.value …) and keeps the flat legacy fallback.
//   F10b SOC provenance (soc_source) is carried through, never guessed.
// =============================================================================
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  validateSysConfig,
  writeSysConfig,
  addDeviceToConfig,
  updateActiveDevice,
  removeDeviceFromConfig,
  switchActiveDevice,
  DEFAULT_DASHBOARD_SETTINGS,
  type DeviceProfile,
  type PltsSysConfig,
} from "../sysConfig";
import { parseLatestEnvelope } from "../gasEnvelope";

// --- Minimal localStorage shim (node environment) ---------------------------
const store = new Map<string, string>();
const windowShim = {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
  dispatchEvent: () => true,
};
vi.stubGlobal("window", windowShim);

function device(id: string, label = id): DeviceProfile {
  return {
    device_id: id,
    label,
    gas_webapp_url: `https://script.google.com/macros/s/${id}/exec`,
    auth_token: `plts_sec_${id}`,
    dashboard_settings: { ...DEFAULT_DASHBOARD_SETTINGS },
  };
}

function fleetConfig(): PltsSysConfig {
  const d1 = device("PLTS_A", "Basecamp A");
  const d2 = device("PLTS_B", "Site B");
  const d3 = device("PLTS_C", "Site C");
  return {
    version: "2.0.0",
    updated_at: new Date().toISOString(),
    gas_webapp_url: d1.gas_webapp_url,
    auth_token: d1.auth_token,
    device_id: d1.device_id,
    dashboard_settings: d1.dashboard_settings,
    active_device_id: d1.device_id,
    devices: [d1, d2, d3],
  };
}

beforeEach(() => {
  store.clear();
});

afterEach(() => {
  store.clear();
});

// Explicit narrowing helper — keeps the suite free of non-null assertions.
function unwrap<T>(v: T | null | undefined, what: string): T {
  if (v === null || v === undefined) throw new Error(`expected non-null: ${what}`);
  return v;
}

// --- F1: updateActiveDevice preserves the fleet ------------------------------
describe("updateActiveDevice (F1 — /setup edit path)", () => {
  it("updates ONLY the active device and keeps the rest of the fleet", () => {
    const cfg = fleetConfig();
    const edited: DeviceProfile = {
      ...cfg.devices[0],
      auth_token: "plts_sec_EDITED",
    };
    const next = updateActiveDevice(cfg, edited);

    expect(next.devices).toHaveLength(3);
    expect(next.devices.find((d) => d.device_id === "PLTS_A")?.auth_token).toBe(
      "plts_sec_EDITED",
    );
    expect(next.devices.find((d) => d.device_id === "PLTS_B")).toBeDefined();
    expect(next.devices.find((d) => d.device_id === "PLTS_C")).toBeDefined();
    expect(next.active_device_id).toBe("PLTS_A");
    expect(next.auth_token).toBe("plts_sec_EDITED"); // mirror follows active
  });

  it("renaming the active device leaves no orphan duplicate", () => {
    const cfg = fleetConfig();
    const renamed: DeviceProfile = {
      ...cfg.devices[0],
      device_id: "PLTS_A2",
    };
    const next = updateActiveDevice(cfg, renamed);

    expect(next.devices).toHaveLength(3);
    expect(next.devices.find((d) => d.device_id === "PLTS_A")).toBeUndefined();
    expect(next.devices.filter((d) => d.device_id === "PLTS_A2")).toHaveLength(1);
    expect(next.active_device_id).toBe("PLTS_A2");
  });

  it("edit colliding with ANOTHER device id replaces that entry (upsert semantics)", () => {
    const cfg = fleetConfig();
    // Operator edits the active device PLTS_A but types PLTS_B as the new id.
    const collided: DeviceProfile = {
      ...cfg.devices[0],
      device_id: "PLTS_B",
    };
    const next = updateActiveDevice(cfg, collided);

    // Old active removed, collision target replaced — no duplicates.
    expect(next.devices).toHaveLength(2);
    expect(next.devices.find((d) => d.device_id === "PLTS_A")).toBeUndefined();
    expect(next.devices.filter((d) => d.device_id === "PLTS_B")).toHaveLength(1);
    expect(next.devices.find((d) => d.device_id === "PLTS_C")).toBeDefined();
  });
});

// --- F8: addDeviceToConfig upsert (documented) -------------------------------
describe("addDeviceToConfig (F8 — duplicate ids upsert)", () => {
  it("adds a NEW device and makes it active", () => {
    const cfg = fleetConfig();
    const next = addDeviceToConfig(cfg, device("PLTS_D"));
    expect(next.devices).toHaveLength(4);
    expect(next.active_device_id).toBe("PLTS_D");
  });

  it("an EXISTING id silently replaces the old profile (why the UI blocks it)", () => {
    const cfg = fleetConfig();
    const next = addDeviceToConfig(cfg, device("PLTS_B", "Site B REPLACED"));
    expect(next.devices).toHaveLength(3);
    expect(next.devices.find((d) => d.device_id === "PLTS_B")?.label).toBe(
      "Site B REPLACED",
    );
  });
});

// --- Reference behavior: writeSysConfig collapses (documented truth) ---------
describe("writeSysConfig (documented collapse semantics)", () => {
  it("overwrites the WHOLE config with a single device — first-run only", () => {
    const next = writeSysConfig({
      gas_webapp_url: "https://script.google.com/x/exec",
      auth_token: "plts_sec_x",
      device_id: "PLTS_X",
      dashboard_settings: { ...DEFAULT_DASHBOARD_SETTINGS },
    });
    expect(next.devices).toHaveLength(1);
    expect(next.device_id).toBe("PLTS_X");
    expect(next.active_device_id).toBe("PLTS_X");
  });
});

// --- F4: import validation ----------------------------------------------------
describe("validateSysConfig (F4 — multi-device backup)", () => {
  it("accepts a multi-device backup and resolves the active profile", () => {
    const raw = JSON.parse(JSON.stringify(fleetConfig()));
    const validated = unwrap(validateSysConfig(raw), "validated");
    expect(validated.devices).toHaveLength(3);
    expect(validated.device_id).toBe("PLTS_A");
  });

  it("migrates a legacy v1 single-device blob", () => {
    const validated = unwrap(
      validateSysConfig({
        gas_webapp_url: "https://script.google.com/legacy/exec",
        auth_token: "plts_sec_legacy",
        device_id: "PLTS_LEGACY",
        dashboard_settings: {},
      }),
      "validated",
    );
    expect(validated.devices).toHaveLength(1);
    expect(validated.devices[0].device_id).toBe("PLTS_LEGACY");
    expect(validated.dashboard_settings.battery_nominal_voltage).toBe(48);
  });

  it("rejects payloads without any valid device", () => {
    expect(validateSysConfig({ foo: 1 })).toBeNull();
    expect(validateSysConfig(null)).toBeNull();
  });
});

// --- switchActiveDevice / removeDeviceFromConfig sanity ----------------------
describe("switchActiveDevice / removeDeviceFromConfig", () => {
  it("switching mirrors the target device fields", () => {
    const next = switchActiveDevice(fleetConfig(), "PLTS_B");
    expect(next.active_device_id).toBe("PLTS_B");
    expect(next.auth_token).toBe("plts_sec_PLTS_B");
  });

  it("removing the LAST device clears the config (null)", () => {
    let cfg = fleetConfig();
    cfg = removeDeviceFromConfig(cfg, "PLTS_A") ?? cfg;
    cfg = removeDeviceFromConfig(cfg, "PLTS_B") ?? cfg;
    expect(removeDeviceFromConfig(cfg, "PLTS_C")).toBeNull();
  });
});

// --- F5: 48V defaults (P0-007) ------------------------------------------------
describe("DEFAULT_DASHBOARD_SETTINGS (P0-007)", () => {
  it("stays aligned with firmware/GAS 48V 15S LiFePO4 canonical config", () => {
    expect(DEFAULT_DASHBOARD_SETTINGS.battery_nominal_voltage).toBe(48);
    expect(DEFAULT_DASHBOARD_SETTINGS.battery_capacity_ah).toBe(200);
    expect(DEFAULT_DASHBOARD_SETTINGS.low_battery_warning_threshold).toBe(45.0);
  });
});

// --- F10: GAS envelope parsing -------------------------------------------------
describe("parseLatestEnvelope (F10 — canonical nested envelope)", () => {
  const canonical = {
    protocolVersion: "2",
    deviceId: "PLTS_A",
    sequence: 105,
    eventTime: "2026-08-28T09:00:00Z",
    ingestionTime: "2026-08-28T09:00:05Z",
    isLate: false,
    timeQuality: "VALID",
    battery: {
      voltage: { value: 52.4, unit: "V", quality: "VALID" },
      current: { value: -10.2, unit: "A", quality: "VALID" },
      power: { value: -534.5, unit: "W", quality: "DERIVED" },
      soc: { value: 78.4, unit: "%", quality: "ESTIMATED", provenance: "BMS_DIRECT" },
      direction: "DISCHARGING",
      bms: { connected: true, protocol: "pylontech_can" },
    },
    ac: {
      rmsCurrent: { value: 3.1, unit: "A", quality: "VALID" },
      estimatedPower: { value: 680, unit: "W", quality: "ESTIMATED" },
    },
    environment: {
      temperature: { value: 29.7, unit: "°C", quality: "VALID" },
      humidity: { value: 61, unit: "%", quality: "VALID" },
    },
    health: {
      freeHeap: 183000,
      rssi: -64,
      firmwareVersion: "1.6.1",
      ina219Online: true,
    },
    overallQuality: "VALID",
  };

  it("reads every value from the nested canonical shape (the old parser saw only nulls)", () => {
    const t = parseLatestEnvelope(canonical);
    expect(t.v_bat).toBe(52.4);
    expect(t.i_bat_dc).toBe(-10.2);
    expect(t.p_bat_dc).toBe(-534.5);
    expect(t.i_ac_load).toBe(3.1);
    expect(t.soc_percent).toBe(78.4);
    expect(t.rssi).toBe(-64);
    expect(t.free_heap).toBe(183000);
    expect(t.fw_version).toBe("1.6.1");
    expect(t.temp_celsius).toBe(29.7);
    expect(t.timestamp).toBe("2026-08-28T09:00:00Z");
    expect(t.ina219_ok).toBe("true");
  });

  it("carries SOC provenance through — never guesses", () => {
    expect(parseLatestEnvelope(canonical).soc_source).toBe("BMS_DIRECT");
    // No provenance field → null (UNKNOWN is the UI's display fallback).
    expect(parseLatestEnvelope({ battery: { soc: { value: 50 } } }).soc_source).toBeNull();
  });

  it("keeps the FLAT legacy fallback for pre-v2 backends", () => {
    const t = parseLatestEnvelope({
      v_bat: 51.2,
      i_bat_dc: 4.4,
      p_bat_dc: 225.3,
      i_ac_load: 2.2,
      soc_percent: 66,
      ina219_ok: "MISSING",
      rssi: -71,
      free_heap: 165000,
      fw_version: "1.4.0",
      temp_celsius: 30.1,
      timestamp: "2026-08-28T08:00:00Z",
    });
    expect(t.v_bat).toBe(51.2);
    expect(t.i_bat_dc).toBe(4.4);
    expect(t.soc_percent).toBe(66);
    expect(t.ina219_ok).toBe("MISSING");
    expect(t.fw_version).toBe("1.4.0");
  });

  it("maps legacy i_bat → i_bat_dc when i_bat_dc is absent", () => {
    const t = parseLatestEnvelope({ i_bat: -7.5 });
    expect(t.i_bat_dc).toBe(-7.5);
  });

  it("returns nulls (never NaN/undefined) for an empty/absent payload", () => {
    const t = parseLatestEnvelope(null);
    expect(t.v_bat).toBeNull();
    expect(t.soc_percent).toBeNull();
    expect(t.soc_source).toBeNull();
    expect(t.fw_version).toBeNull();
    expect(t.ina219_ok).toBeNull();
  });

  it("coerces sheet-style strings and rejects garbage without throwing", () => {
    const t = parseLatestEnvelope({
      battery: { voltage: { value: "52.4" }, soc: { value: "78.4", provenance: "SHUNT_COULOMB" } },
    });
    expect(t.v_bat).toBe(52.4);
    expect(t.soc_percent).toBe(78.4);
    expect(t.soc_source).toBe("SHUNT_COULOMB");

    const bad = parseLatestEnvelope({ battery: { voltage: { value: "not-a-number" } } });
    expect(bad.v_bat).toBeNull();
  });
});
