/**
 * adminTokenSession.ts — session-scoped ADMIN_TOKEN store (P1-3 hardening)
 * -----------------------------------------------------------------------------
 * AUDIT FINDING (P1): the operator ADMIN_TOKEN (Config sheet GAS) was
 * persisted in localStorage inside PLTS_SYS_CONFIG. localStorage survives
 * forever — an XSS payload, a shared machine, or a browser profile leak
 * would hand over the ONE credential that can ARM/DISARM the fleet and
 * publish OTA manifests.
 *
 * REMEDIATION (this module): the admin token now lives in
 * sessionStorage (key: PLTS_ADMIN_TOKENS, map deviceId → token) with an
 * in-memory fallback when storage is unavailable.
 *   - sessionStorage dies with the browser session/tab → exposure window
 *     shrinks from "forever" to "this session".
 *   - lib/sysConfig.ts NEVER persists DeviceProfile.admin_token anymore
 *     (legacy payloads are migrated here on read, then re-written clean).
 *   - Components resolve the runtime token via resolveAdminToken() /
 *     withAdminToken() — the profile field is kept ONLY as a deprecated
 *     in-memory type compatibility shim.
 *
 * Trade-off (documented, deliberate): a NEW TAB / restarted browser no
 * longer remembers the token — the operator types it once per session.
 * Fail-closed stays intact: empty token → emergency commands refuse to
 * send with an honest prompt (see lib/emergency.ts).
 */

const STORAGE_KEY = 'PLTS_ADMIN_TOKENS';

/** In-memory fallback — also the effective store during SSR-safe dry runs. */
const memoryStore = new Map<string, string>();

const isBrowser = () => typeof window !== 'undefined';

/** sessionStorage may throw (disabled storage / quota) — probe it once. */
function backend(): Storage | null {
  if (!isBrowser()) return null;
  try {
    const probe = '__plts_session_probe__';
    window.sessionStorage.setItem(probe, probe);
    window.sessionStorage.removeItem(probe);
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function readMap(): Record<string, string> {
  const store = backend();
  if (!store) {
    return Object.fromEntries(memoryStore);
  }
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'string' && v.trim().length > 0) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function writeMap(map: Record<string, string>): void {
  const store = backend();
  if (!store) {
    memoryStore.clear();
    for (const [k, v] of Object.entries(map)) memoryStore.set(k, v);
    return;
  }
  try {
    if (Object.keys(map).length === 0) store.removeItem(STORAGE_KEY);
    else store.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* quota/disabled — memory fallback keeps this session functional */
  }
}

export function getAdminToken(deviceId: string): string | undefined {
  if (!deviceId) return undefined;
  return readMap()[deviceId];
}

/** Store (or clear, when token is empty) the admin token for one device. */
export function setAdminToken(deviceId: string, token: string): void {
  if (!deviceId) return;
  const map = readMap();
  if (typeof token === 'string' && token.trim().length > 0) {
    map[deviceId] = token.trim();
  } else {
    delete map[deviceId];
  }
  writeMap(map);
}

export function clearAdminToken(deviceId: string): void {
  if (!deviceId) return;
  const map = readMap();
  delete map[deviceId];
  writeMap(map);
}

export function clearAllAdminTokens(): void {
  const store = backend();
  if (store) {
    try {
      store.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }
  memoryStore.clear();
}

/**
 * Runtime resolution: session store FIRST, then the deprecated profile
 * field (kept for in-memory compatibility). Used by command senders.
 */
export function resolveAdminToken(device: {
  device_id: string;
  admin_token?: string;
}): string | undefined {
  const fromSession = getAdminToken(device.device_id);
  if (fromSession) return fromSession;
  return device.admin_token?.trim() ? device.admin_token.trim() : undefined;
}

/**
 * Return a profile copy with the runtime-resolved admin token attached —
 * the shape sendEmergencyCommand() and OTA publish expect.
 */
export function withAdminToken<T extends { device_id: string; admin_token?: string }>(
  device: T,
): T {
  const token = resolveAdminToken(device);
  return token ? { ...device, admin_token: token } : { ...device, admin_token: undefined };
}
