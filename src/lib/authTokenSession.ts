/**
 * authTokenSession.ts — session-scoped AUTH_TOKEN store (audit p.483).
 * -----------------------------------------------------------------------------
 * AUDIT FINDING (p.483, residual): the GAS AUTH_TOKEN (per-device viewer
 * credential) was persisted in localStorage inside PLTS_SYS_CONFIG, surviving
 * forever across browser sessions. XSS, a shared machine, or a browser
 * profile leak would hand over the credential that can READ the device's
 * telemetry, reports and emergency log.
 *
 * REMEDIATION (this module — mirrors adminTokenSession.ts): the auth token
 * now lives in sessionStorage (key: PLTS_AUTH_TOKENS, map deviceId → token)
 * with an in-memory fallback when storage is unavailable.
 *   - sessionStorage dies with the browser session → exposure window shrinks
 *     from "forever" to "this session".
 *   - lib/sysConfig.ts NEVER persists DeviceProfile.auth_token to localStorage
 *     (legacy payloads are migrated here on read, then re-written clean).
 *   - sysConfig injects the session-resolved token into the IN-MEMORY config
 *     (readSysConfig → parseDeviceProfile), so components keep consuming
 *     `device.auth_token` unchanged while the disk blob stays token-free.
 *
 * Trade-off (documented, deliberate — same as the admin token): a restarted
 * browser no longer remembers the token; the operator re-enters it once per
 * session through the setup/settings flow. Fail-closed stays intact: an
 * empty token makes every GAS request fail with an honest error instead of
 * silently sending an unauthenticated body.
 */

const STORAGE_KEY = 'PLTS_AUTH_TOKENS';

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
    emitTokensChangedEvent();
    return;
  }
  try {
    if (Object.keys(map).length === 0) store.removeItem(STORAGE_KEY);
    else store.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* quota/disabled — memory fallback keeps this session functional */
  }
  emitTokensChangedEvent();
}

/**
 * [SELF-AUDIT 2026-09-16] Notify same-tab listeners (e.g. PushAlarmBridge)
 * that the session token map changed — sessionStorage does NOT fire the
 * `storage` event within the tab that wrote it, so an explicit event is the
 * only reliable in-tab signal. The push-alarm bridge uses it to re-push the
 * active device credentials to the service worker (GAS K-7 contract).
 */
export const AUTH_TOKENS_CHANGED_EVENT = 'plts:auth-tokens-changed';

function emitTokensChangedEvent(): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent(AUTH_TOKENS_CHANGED_EVENT));
  } catch {
    /* non-DOM context — ignore */
  }
}

export function getAuthToken(deviceId: string): string | undefined {
  if (!deviceId) return undefined;
  return readMap()[deviceId];
}

/** Store (or clear, when token is empty) the auth token for one device. */
export function setAuthToken(deviceId: string, token: string): void {
  if (!deviceId) return;
  const map = readMap();
  if (typeof token === 'string' && token.trim().length > 0) {
    map[deviceId] = token.trim();
  } else {
    delete map[deviceId];
  }
  writeMap(map);
}

export function clearAuthToken(deviceId: string): void {
  if (!deviceId) return;
  const map = readMap();
  delete map[deviceId];
  writeMap(map);
}

export function clearAllAuthTokens(): void {
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
 * Runtime resolution: session store FIRST, then the deprecated in-memory
 * profile field. Used by sysConfig when building the in-memory config and by
 * command senders that need the freshest value.
 */
export function resolveAuthToken(device: {
  device_id: string;
  auth_token?: string;
}): string {
  const fromSession = getAuthToken(device.device_id);
  if (fromSession) return fromSession;
  return device.auth_token?.trim() ?? '';
}
