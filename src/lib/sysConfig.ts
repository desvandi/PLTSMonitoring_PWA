/**
 * PLTS_SYS_CONFIG — Runtime dynamic configuration stored in browser localStorage.
 *
 * Contract enforced by §2.3 of the technical brief (Zero-Touch Deployment).
 * The PWA is deployed once; each user pastes their own GAS URL + token, which
 * is persisted in localStorage under the key `PLTS_SYS_CONFIG`.
 *
 * v2.0.0 — Multi-Device support (2026-02-22)
 * The config now stores an array of `devices` plus an `active_device_id`.
 * Legacy v1.0.0 payloads (single device) are auto-migrated on read.
 * The top-level `gas_webapp_url`, `auth_token`, `device_id` fields continue to
 * MIRROR the active device so existing components keep working unchanged.
 */
export const SYS_CONFIG_KEY = 'PLTS_SYS_CONFIG';
export const SYS_CONFIG_VERSION = '2.0.0';

export interface DashboardSettings {
  telemetry_refresh_interval_sec: number;
  battery_nominal_voltage: number;
  battery_capacity_ah: number;
  low_battery_warning_threshold: number;
  enable_audio_alarm: boolean;
  theme: 'dark' | 'light';
}

export interface DeviceProfile {
  device_id: string;
  label: string;
  gas_webapp_url: string;
  auth_token: string;
  // v1.7.0 [E-WAVE] — operator-only secret (Config sheet ADMIN_TOKEN on GAS).
  // Gates EMERGENCY_COMMAND (ARM/DISARM/CONFIG) exactly like OTA_PUBLISH.
  // Optional + backward-compatible: absent on legacy profiles → emergency
  // control stays DISABLED with an honest prompt (fail-closed).
  admin_token?: string;
  dashboard_settings: DashboardSettings;
}

export interface PltsSysConfig {
  version: string;
  updated_at: string;
  // Mirror of the active device (kept for backward compatibility with v1.x).
  gas_webapp_url: string;
  auth_token: string;
  device_id: string;
  dashboard_settings: DashboardSettings;
  // Multi-device (v2.0.0+)
  active_device_id: string;
  devices: DeviceProfile[];
}

export const DEFAULT_DASHBOARD_SETTINGS: DashboardSettings = {
  telemetry_refresh_interval_sec: 5,
  // [P0-007 REMEDIATION 2026-08] 48 V / 15S LiFePO4 defaults — aligned with
  // the firmware (Core/Config.h: nominal 48 V, low 45 V, 200 Ah) and the GAS
  // backend (48V_15S_LIFEPO4). Previously 24 V / 22 V / 100 Ah — a cross-system
  // contradiction that produced wrong low-battery thresholds on fresh installs.
  battery_nominal_voltage: 48,
  battery_capacity_ah: 200,
  low_battery_warning_threshold: 45.0,
  enable_audio_alarm: true,
  theme: 'dark',
};

const isBrowser = () => typeof window !== 'undefined';

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

function parseDashboardSettings(ds: Record<string, unknown> | undefined): DashboardSettings {
  const src = ds ?? {};
  return {
    telemetry_refresh_interval_sec: isFiniteNumber(src.telemetry_refresh_interval_sec)
      ? src.telemetry_refresh_interval_sec
      : DEFAULT_DASHBOARD_SETTINGS.telemetry_refresh_interval_sec,
    battery_nominal_voltage: isFiniteNumber(src.battery_nominal_voltage)
      ? src.battery_nominal_voltage
      : DEFAULT_DASHBOARD_SETTINGS.battery_nominal_voltage,
    battery_capacity_ah: isFiniteNumber(src.battery_capacity_ah)
      ? src.battery_capacity_ah
      : DEFAULT_DASHBOARD_SETTINGS.battery_capacity_ah,
    low_battery_warning_threshold: isFiniteNumber(src.low_battery_warning_threshold)
      ? src.low_battery_warning_threshold
      : DEFAULT_DASHBOARD_SETTINGS.low_battery_warning_threshold,
    enable_audio_alarm:
      typeof src.enable_audio_alarm === 'boolean'
        ? src.enable_audio_alarm
        : DEFAULT_DASHBOARD_SETTINGS.enable_audio_alarm,
    theme: src.theme === 'light' ? 'light' : 'dark',
  };
}

function parseDeviceProfile(raw: unknown): DeviceProfile | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (!isNonEmptyString(obj.device_id)) return null;
  if (!isNonEmptyString(obj.gas_webapp_url) || !obj.gas_webapp_url.toString().startsWith('http')) return null;
  if (!isNonEmptyString(obj.auth_token)) return null;
  return {
    device_id: obj.device_id as string,
    label: isNonEmptyString(obj.label) ? (obj.label as string) : (obj.device_id as string),
    gas_webapp_url: obj.gas_webapp_url as string,
    auth_token: obj.auth_token as string,
    admin_token: isNonEmptyString(obj.admin_token) ? (obj.admin_token as string) : undefined,
    dashboard_settings: parseDashboardSettings(obj.dashboard_settings as Record<string, unknown> | undefined),
  };
}

/** Schema validation with automatic v1 → v2 migration. */
export function validateSysConfig(raw: unknown): PltsSysConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;

  // Attempt to reconstruct devices[] — either from v2 or from v1 top-level fields.
  let devices: DeviceProfile[] = [];
  if (Array.isArray(obj.devices)) {
    devices = obj.devices.map(parseDeviceProfile).filter((d): d is DeviceProfile => Boolean(d));
  }
  if (devices.length === 0) {
    const legacy = parseDeviceProfile(obj);
    if (legacy) devices = [legacy];
  }
  if (devices.length === 0) return null;

  const requestedActive = isNonEmptyString(obj.active_device_id)
    ? (obj.active_device_id as string)
    : (isNonEmptyString(obj.device_id) ? (obj.device_id as string) : devices[0].device_id);
  const active = devices.find((d) => d.device_id === requestedActive) ?? devices[0];

  return {
    version: SYS_CONFIG_VERSION,
    updated_at: isNonEmptyString(obj.updated_at) ? (obj.updated_at as string) : new Date().toISOString(),
    gas_webapp_url: active.gas_webapp_url,
    auth_token: active.auth_token,
    device_id: active.device_id,
    dashboard_settings: active.dashboard_settings,
    active_device_id: active.device_id,
    devices,
  };
}

export function readSysConfig(): PltsSysConfig | null {
  if (!isBrowser()) return null;
  try {
    const raw = window.localStorage.getItem(SYS_CONFIG_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    const validated = validateSysConfig(parsed);
    if (!validated) return null;
    // Persist migrated payload back to disk so v1 legacy blobs get upgraded
    // to v2 in place — no repeat migration on every read.
    const originalVersion = (parsed as { version?: string })?.version;
    if (originalVersion !== SYS_CONFIG_VERSION) {
      try {
        window.localStorage.setItem(SYS_CONFIG_KEY, JSON.stringify(validated));
      } catch {
        /* ignore quota errors — in-memory config is still valid */
      }
    }
    return validated;
  } catch {
    return null;
  }
}

/** Persist a fully-formed config. Prefer the higher-level helpers below. */
export function persistSysConfig(config: Omit<PltsSysConfig, 'version' | 'updated_at'>): PltsSysConfig {
  const enriched: PltsSysConfig = {
    ...config,
    version: SYS_CONFIG_VERSION,
    updated_at: new Date().toISOString(),
  };
  if (isBrowser()) {
    window.localStorage.setItem(SYS_CONFIG_KEY, JSON.stringify(enriched));
    window.dispatchEvent(new CustomEvent('plts:config-updated'));
  }
  return enriched;
}

/**
 * Convenience helper for the First-Run Setup wizard — persists a single device
 * as the active/only entry. Overwrites the previous config completely.
 */
export function writeSysConfig(input: {
  gas_webapp_url: string;
  auth_token: string;
  device_id: string;
  label?: string;
  dashboard_settings: DashboardSettings;
}): PltsSysConfig {
  const device: DeviceProfile = {
    device_id: input.device_id,
    label: input.label ?? input.device_id,
    gas_webapp_url: input.gas_webapp_url,
    auth_token: input.auth_token,
    dashboard_settings: input.dashboard_settings,
  };
  return persistSysConfig({
    gas_webapp_url: device.gas_webapp_url,
    auth_token: device.auth_token,
    device_id: device.device_id,
    dashboard_settings: device.dashboard_settings,
    active_device_id: device.device_id,
    devices: [device],
  });
}

export function clearSysConfig(): void {
  if (!isBrowser()) return;
  window.localStorage.removeItem(SYS_CONFIG_KEY);
  window.dispatchEvent(new CustomEvent('plts:config-updated'));
}

// ---------------------------------------------------------------------------
// Multi-device helpers
// ---------------------------------------------------------------------------

export function addDeviceToConfig(existing: PltsSysConfig, profile: DeviceProfile): PltsSysConfig {
  const filtered = existing.devices.filter((d) => d.device_id !== profile.device_id);
  const devices = [...filtered, profile];
  return persistSysConfig({
    ...existing,
    devices,
    active_device_id: profile.device_id,
    gas_webapp_url: profile.gas_webapp_url,
    auth_token: profile.auth_token,
    device_id: profile.device_id,
    dashboard_settings: profile.dashboard_settings,
  });
}

/**
 * [AUDIT 2026-08-28 F1] Upsert the ACTIVE device in place — the rest of the
 * fleet is preserved. The /setup edit path previously called writeSysConfig()
 * which collapses devices[] to a single entry, silently destroying every other
 * device profile the operator had configured (the exact regression the
 * Settings import path documents and avoids).
 *
 * Renaming the device is safe: the OLD active entry is removed and the new
 * profile appended — no orphan duplicate is left behind.
 */
export function updateActiveDevice(existing: PltsSysConfig, profile: DeviceProfile): PltsSysConfig {
  const devices = existing.devices
    .filter((d) => d.device_id !== existing.active_device_id) // the entry being edited
    .filter((d) => d.device_id !== profile.device_id)         // any collision with the new id
    .concat(profile);
  return persistSysConfig({
    ...existing,
    devices,
    active_device_id: profile.device_id,
    gas_webapp_url: profile.gas_webapp_url,
    auth_token: profile.auth_token,
    device_id: profile.device_id,
    dashboard_settings: profile.dashboard_settings,
  });
}

export function removeDeviceFromConfig(existing: PltsSysConfig, deviceId: string): PltsSysConfig | null {
  const devices = existing.devices.filter((d) => d.device_id !== deviceId);
  if (devices.length === 0) {
    clearSysConfig();
    return null;
  }
  const active = devices.find((d) => d.device_id === existing.active_device_id) ?? devices[0];
  return persistSysConfig({
    ...existing,
    devices,
    active_device_id: active.device_id,
    gas_webapp_url: active.gas_webapp_url,
    auth_token: active.auth_token,
    device_id: active.device_id,
    dashboard_settings: active.dashboard_settings,
  });
}

export function switchActiveDevice(existing: PltsSysConfig, deviceId: string): PltsSysConfig {
  const target = existing.devices.find((d) => d.device_id === deviceId);
  if (!target) return existing;
  return persistSysConfig({
    ...existing,
    active_device_id: target.device_id,
    gas_webapp_url: target.gas_webapp_url,
    auth_token: target.auth_token,
    device_id: target.device_id,
    dashboard_settings: target.dashboard_settings,
  });
}

// ---------------------------------------------------------------------------
// PING/PONG handshake (§2.4)
// ---------------------------------------------------------------------------

export interface HandshakeResult {
  ok: boolean;
  message: string;
  status?: string;
  code?: number;
  latency_ms?: number;
  /** [WAVE-4 / GAS-2-S] null = not checked (no device_key sent / older
   * GAS); true/false = the DEVICES sheet membership report from GAS. */
  device_registered?: boolean | null;
  /** true when GAS runs in legacy single-device mode (empty DEVICES sheet). */
  legacy_mode?: boolean;
}

export async function pingGasEndpoint(
  gasUrl: string,
  token: string,
  timeoutMs = 7000,
  deviceKey?: string
): Promise<HandshakeResult> {
  if (!gasUrl || !gasUrl.startsWith('http')) {
    return { ok: false, message: 'URL GAS tidak valid (harus diawali http/https).' };
  }
  if (!token) {
    return { ok: false, message: 'Auth token tidak boleh kosong.' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = performance.now();

  try {
    // [WAVE-4 / GAS-2-S] device_key rides along when the operator already
    // typed one — GAS ≥ Wave 4 answers with an honest registration report in
    // data.device_registered (older deployments ignore the extra field).
    const pingBody: Record<string, string> = { action: 'PING', token };
    if (deviceKey && deviceKey.trim()) pingBody.device_key = deviceKey.trim();
    const response = await fetch(gasUrl, {
      method: 'POST',
      body: JSON.stringify(pingBody),
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      signal: controller.signal,
      redirect: 'follow',
    });
    clearTimeout(timer);
    const latency = Math.round(performance.now() - startedAt);

    if (!response.ok) {
      return { ok: false, message: `GAS mengembalikan HTTP ${response.status}.`, code: response.status, latency_ms: latency };
    }

    const payload = (await response.json().catch(() => null)) as {
      status?: string;
      code?: number;
      message?: string;
      data?: { device_registered?: boolean | null; legacy_mode?: boolean } | null;
    } | null;

    if (!payload) {
      return { ok: false, message: 'Respons GAS tidak dapat di-parse (bukan JSON).', latency_ms: latency };
    }

    const isSuccess = payload.status === 'SUCCESS' && String(payload.message || '').toUpperCase() === 'PONG';
    // [WAVE-4 / GAS-2-S] Registration is INFORMATION, not a handshake
    // failure: GAS is reachable and the token is valid either way. Surface
    // an unregistered device_key as a visible warning instead of letting
    // the operator discover it later via a 400 on the first TELEMETRY call.
    const deviceRegistered = payload.data?.device_registered ?? null;
    const legacyMode = payload.data?.legacy_mode ?? false;
    let message: string;
    if (!isSuccess) message = payload.message || 'Handshake gagal.';
    else if (deviceRegistered === false) {
      message = `Handshake sukses — tetapi device ID "${deviceKey?.trim()}" BELUM terdaftar di sheet DEVICES GAS. Telemetri akan ditolak sampai device didaftarkan.`;
    } else if (legacyMode) {
      message = 'Handshake sukses (mode legacy — sheet DEVICES kosong, device apa pun diterima).';
    } else message = 'Handshake sukses (PING/PONG).';
    return {
      ok: isSuccess,
      status: payload.status,
      code: payload.code,
      message,
      latency_ms: latency,
      device_registered: deviceRegistered,
      legacy_mode: legacyMode,
    };
  } catch (err) {
    clearTimeout(timer);
    const latency = Math.round(performance.now() - startedAt);
    if ((err as Error).name === 'AbortError') {
      return { ok: false, message: `Timeout > ${timeoutMs}ms saat menghubungi GAS.`, latency_ms: latency };
    }
    return { ok: false, message: `Kesalahan jaringan/CORS: ${(err as Error).message}`, latency_ms: latency };
  }
}

/** Serialize current config to a download-ready JSON blob. §2.5 */
export function exportSysConfigBlob(config: PltsSysConfig): Blob {
  return new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
}

// ---------------------------------------------------------------------------
// HMAC-SHA256 utility — used by Signed OTA publishing and QR onboarding
// ---------------------------------------------------------------------------

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const buf = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function sha256Hex(input: ArrayBuffer): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', input);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
