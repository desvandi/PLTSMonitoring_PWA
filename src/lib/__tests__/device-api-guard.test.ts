// =============================================================================
// device-api-guard.test.ts — [AUDIT p.488 REMEDIATION regression tests]
// Policy under test: EVERY firmware mutation in deviceApi must pass
// assertMutationAllowed() BEFORE deviceRequest():
//   - compatibility snapshot MISSING (never verified) → BLOCKED (fail-closed)
//   - canViewTelemetry === false                      → BLOCKED
// Previously ONLY relay commands were fail-closed; config/calibration used
// the fail-open `if (compat && ...)` pattern and reboot/factory-reset/
// password/import/OTA had NO guard at all.
// Also covers [p.486]: otaUpload without security metadata is rejected
// client-side outside demo mode.
// =============================================================================
import { describe, expect, it, vi, beforeEach } from "vitest";

type CompatModule = typeof import("@/lib/compatibility");
type DeviceApiModule = typeof import("@/lib/deviceApi");

async function importFresh(): Promise<{ deviceApi: DeviceApiModule["deviceApi"]; compat: CompatModule }> {
  vi.resetModules();
  // Demo mode OFF so the metadata-less OTA path is fail-closed.
  vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "");
  const compat = (await import("@/lib/compatibility")) as CompatModule;
  const mod = (await import("@/lib/deviceApi")) as DeviceApiModule;
  return { deviceApi: mod.deviceApi, compat };
}

beforeEach(() => {
  vi.unstubAllEnvs();
});

describe("p.488 — mutation guard is fail-closed when the snapshot is NULL", () => {
  it.each([
    ["updateConfig", (d: DeviceApiModule["deviceApi"]) => d.updateConfig({})],
    ["updateCalibration", (d: DeviceApiModule["deviceApi"]) => d.updateCalibration({})],
    ["voltageCalibrationPoint", (d: DeviceApiModule["deviceApi"]) => d.voltageCalibrationPoint("low", 48, 2400)],
    ["acs712ZeroCal", (d: DeviceApiModule["deviceApi"]) => d.acs712ZeroCal()],
    ["acknowledgeAlarm", (d: DeviceApiModule["deviceApi"]) => d.acknowledgeAlarm("V_LOW")],
    ["reboot", (d: DeviceApiModule["deviceApi"]) => d.reboot()],
    ["factoryResetPrepare", (d: DeviceApiModule["deviceApi"]) => d.factoryResetPrepare()],
    ["factoryResetConfirm", (d: DeviceApiModule["deviceApi"]) => d.factoryResetConfirm("a".repeat(32))],
    ["updateDevice", (d: DeviceApiModule["deviceApi"]) => d.updateDevice({ deviceName: "x" })],
    ["changePassword", (d: DeviceApiModule["deviceApi"]) => d.changePassword("old12345", "new12345")],
    ["importConfig", (d: DeviceApiModule["deviceApi"]) => d.importConfig({} as never)],
  ])("%s rejects BEFORE any network call when never verified", async (_name, call) => {
    const { deviceApi, compat } = await importFresh();
    compat.setCompatibilitySnapshot(null); // never verified
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(call(deviceApi)).rejects.toThrow(/BLOCKED \(fail-closed\)/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("p.488 — mutation guard blocks incompatible snapshots", () => {
  it("protocol_mismatch snapshot → every mutation rejects", async () => {
    const { deviceApi, compat } = await importFresh();
    compat.setCompatibilitySnapshot(
      compat.evaluateCompatibility("1.9.3", 2, 1),
    );
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(deviceApi.updateConfig({})).rejects.toThrow(/BLOCKED/);
    await expect(deviceApi.reboot()).rejects.toThrow(/BLOCKED/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("p.488 — compatible snapshot lets mutations through to the wire", () => {
  it("updateConfig resolves and POSTs when compatibility is verified", async () => {
    const { deviceApi, compat } = await importFresh();
    compat.setCompatibilitySnapshot(compat.evaluateCompatibility("1.9.3", 1, 1));
    const fetchSpy = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ success: true, message: "ok", data: { updated: true } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchSpy);
    await expect(deviceApi.updateConfig({})).resolves.toEqual({ updated: true });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const calls = fetchSpy.mock.calls as unknown as Array<[string, RequestInit]>;
    const [url, init] = calls[0]!;
    expect(url).toContain("/api/config");
    expect(init.method).toBe("POST");
  });
});

describe("p.486 — OTA upload without security metadata is fail-closed (non-demo)", () => {
  it("metadata-less upload rejects client-side BEFORE opening the connection", async () => {
    const { deviceApi, compat } = await importFresh();
    compat.setCompatibilitySnapshot(compat.evaluateCompatibility("1.9.3", 1, 1));
    const file = new File([new Uint8Array([1, 2, 3])], "fw.bin");
    await expect(
      deviceApi.otaUpload(file, undefined, undefined),
    ).rejects.toThrow(/OTA upload BLOCKED \(fail-closed\)/);
  });

  it("metadata-less upload ALSO rejects when compatibility was never verified (guard first)", async () => {
    const { deviceApi, compat } = await importFresh();
    compat.setCompatibilitySnapshot(null);
    const file = new File([new Uint8Array([1, 2, 3])], "fw.bin");
    await expect(
      deviceApi.otaUpload(file, undefined, undefined),
    ).rejects.toThrow(/BLOCKED/);
  });
});
