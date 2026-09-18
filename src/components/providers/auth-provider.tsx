'use client';

// =============================================================================
// AuthProvider — manages PWA session (REST or MQTT mode).
// -----------------------------------------------------------------------------
// In MQTT mode, the user is auto-authenticated when MQTT connects (no
// password — device identity established via broker subscription).
// In REST mode, login uses username/password → JWT cookie + CSRF token.
// =============================================================================

import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import { api, setCsrfToken } from '@/lib/api';
import type { SessionInfo } from '@/lib/types';
import { useMqtt } from '@/components/providers/mqtt-provider';
import { useSysConfig } from '@/components/providers/sys-config-provider';
import { pingGasEndpoint } from '@/lib/sysConfig';
// [GATE-6 / F2-AUTH-009 2026-09] Device/admin token lifecycle — logout clears
// the sessionStorage credential stores, they do not survive the session.
import { clearAllAuthTokens } from '@/lib/authTokenSession';
import { clearAllAdminTokens } from '@/lib/adminTokenSession';

// [AUDIT 2026-08-28 F9 — GAS cloud session]
// In the documented zero-touch deployment (PWA on Vercel, no env vars, no
// MQTT broker) the previous auth model dead-ended on the login screen:
// production disables mock auth (fail-closed) and MQTT needs a broker URL,
// leaving an operator who JUST completed /setup with no way into the app.
//
// The GAS backend's trust model IS the AUTH_TOKEN shared secret: an operator
// who has configured a valid GAS URL + token (proven by the PING handshake)
// is an authenticated READER of that backend. This grants the same VIEWER
// scope as an MQTT subscription — read-only; mutating views stay hidden
// (AppShell role gate) and any REST mutation still 401s fail-closed.
const GAS_CLOUD_SESSION: SessionInfo = {
  isAuthenticated: true,
  username: 'gas-viewer',
  expiresAt: null,
  role: 'viewer',
};

// The GAS viewer session is granted ONLY when the REST/LAN login path is
// genuinely unavailable (production zero-touch: no API base URL, no demo
// mode, not a dev build). In dev/demo the operator is supposed to log in
// (admin/admin123) to drive the mock dashboard with operator scope — an
// auto-viewer session there would swallow the login screen.
const LAN_LOGIN_AVAILABLE =
  Boolean(process.env.NEXT_PUBLIC_API_BASE_URL) ||
  process.env.NEXT_PUBLIC_DEMO_MODE === 'true' ||
  process.env.NODE_ENV === 'development';

type AuthContextValue = {
  session: SessionInfo;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  isMqttMode: boolean;
  isGasMode: boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const DEFAULT_SESSION: SessionInfo = {
  isAuthenticated: false,
  username: null,
  expiresAt: null,
};

const MQTT_SESSION: SessionInfo = {
  isAuthenticated: true,
  username: 'mqtt-viewer',
  expiresAt: null,
  // [PWA-02 REMEDIATION 2026-08] VIEWER scope — a successful broker
  // subscription proves the client can READ this device's telemetry; it
  // grants NO right to mutate config/calibration/OTA. Previously this
  // session silently carried full operator privileges (anyone who knew a
  // device ID got dangerous-operation forms aimed at the device).
  role: 'viewer',
};

// [GATE-6 / F2-AUTH-004 2026-09] Logout is a TERMINATION event that must
// survive a page refresh within the browser session: the flag lives in
// sessionStorage and suppresses the automatic GAS PING re-authentication
// until the user EXPLICITLY re-authenticates (login / explicit device
// reconnect). Cleared by login() and by an explicit device switch.
const LOGGED_OUT_FLAG = 'plts_logged_out';

function readLoggedOutFlag(): boolean {
  try {
    return window.sessionStorage.getItem(LOGGED_OUT_FLAG) === '1';
  } catch {
    return false;
  }
}

function writeLoggedOutFlag(value: boolean): void {
  try {
    if (value) {
      window.sessionStorage.setItem(LOGGED_OUT_FLAG, '1');
    } else {
      window.sessionStorage.removeItem(LOGGED_OUT_FLAG);
    }
  } catch {
    // sessionStorage unavailable (SSR / hardened browser) — the in-memory
    // ref still guards the current mount.
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const { connected: mqttConnected, disconnect: mqttDisconnect } = useMqtt();
  const { config } = useSysConfig();
  // [AUDIT 2026-08-28 G5] Sesi MQTT kini DERIVED SAAT RENDER dari status
  // koneksi broker (bukan setState di dalam effect): `mqttConnected` sudah
  // reaktif, menurunkannya ke state terpisah hanya menciptakan sumber kedua
  // yang bisa saling bertentangan + cascading render.
  const [restSession, setRestSession] = useState<SessionInfo>(DEFAULT_SESSION);
  const [restLoading, setRestLoading] = useState(true);
  // [GATE-6 / F2-AUTH-004 2026-09] Logout latch — mirrors the sessionStorage
  // flag (survives refresh) and suppresses the automatic GAS PING
  // re-authentication until an EXPLICIT login / device reconnect.
  const loggedOutRef = useRef<boolean>(false);

  const refresh = useCallback(async () => {
    // Mode MQTT: sesi efektif sudah dicakup derived state; panggilan REST
    // /api/session hanya akan 401 di produksi MQTT-only — jangan panggil.
    if (mqttConnected) return;
    // [GATE-6 / F2-AUTH-004] After an explicit logout the user stays
    // UNAUTHENTICATED — no automatic GAS PING, no resurrected viewer
    // session. Only an explicit re-authentication clears the latch.
    if (loggedOutRef.current || readLoggedOutFlag()) {
      loggedOutRef.current = true;
      setRestSession(DEFAULT_SESSION);
      setRestLoading(false);
      return;
    }
    try {
      const s = await api.session();
      if (s.isAuthenticated) {
        // [F9] A real REST session always wins (operator scope).
        setRestSession({
          isAuthenticated: true,
          username: s.username,
          expiresAt: s.expiresAt,
          role: 'operator',
        });
        if (typeof document !== 'undefined') {
          const match = document.cookie.match(/(?:^|;\s*)plts_csrf=([^;]+)/);
          if (match) {
            setCsrfToken(decodeURIComponent(match[1]!));
          }
        }
      } else if (config && !LAN_LOGIN_AVAILABLE) {
        // [p.490-old REMEDIATION 2026-09] "Memiliki config yang bentuknya
        // valid" ≠ "sudah terautentikasi ke GAS". The GAS viewer session is
        // granted ONLY after a successful runtime PING handshake (token
        // verified by GAS) — config presence alone is NOT authentication.
        // On PING failure the user stays unauthenticated with an honest
        // error surfaced via the session refresh cycle.
        const ping = await pingGasEndpoint(
          config.gas_webapp_url,
          config.auth_token,
          7000,
          config.device_id,
        );
        setRestSession(ping.ok ? GAS_CLOUD_SESSION : DEFAULT_SESSION);
      } else {
        setRestSession(DEFAULT_SESSION);
      }
    } catch {
      // The PWA's own session route being unreachable does NOT invalidate the
      // operator's locally-stored GAS profile (GAS data flows browser → GAS
      // directly) — the viewer session stands; REST operator scope is never
      // granted on error (fail-closed against privilege escalation).
      // [p.490-old] Same rule on the error path: a GAS viewer session requires
      // a reachable, token-verifying backend (the config remains on disk for
      // the next refresh — the user is NOT auto-authenticated).
      setRestSession(DEFAULT_SESSION);
    } finally {
      setRestLoading(false);
    }
  }, [mqttConnected, config]);

  // [G5] Kickoff ditunda satu macrotask: setState di dalam refresh (setelah
  // await) tidak lagi sinkron-reachable dari badan effect — aturan
  // react-hooks/set-state-in-effect menghentikan pola cascading render.
  useEffect(() => {
    const kickoff = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(kickoff);
  }, [refresh]);

  // [G5] Sesi efektif = turunan langsung status koneksi. MQTT menang saat
  // terhubung (broker hidup = hak baca telemetri); REST/GAS sebaliknya.
  // "loading" juga derived: begitu broker terhubung, status sesi diketahui
  // tanpa menunggu round-trip REST.
  const session: SessionInfo = mqttConnected ? MQTT_SESSION : restSession;
  const loading = restLoading && !mqttConnected;

  const login = useCallback(
    async (username: string, password: string) => {
      // MQTT aktif → sesi sudah viewer via derived state; login REST hanya
      // relevan saat mode REST/GAS.
      const result = await api.login(username, password);
      setCsrfToken(result.csrfToken);
      // [GATE-6 / F2-AUTH-004] An EXPLICIT login is the sanctioned path back
      // after logout — the auto-PING suppression latch is released here.
      loggedOutRef.current = false;
      writeLoggedOutFlag(false);
      setRestSession({
        isAuthenticated: true,
        username: result.username,
        expiresAt: result.expiresAt,
        role: 'operator',      // [PWA-02] REST login = operator scope
      });
    },
    [],
  );

  const logout = useCallback(async () => {
    // [GATE-6 / F2-AUTH-004 + F2-AUTH-009 REMEDIATION 2026-09]
    // audit Phase 2 F2-AUTH-004: the OLD tail recreated the GAS viewer
    // session on logout (`setRestSession(config && !LAN_LOGIN_AVAILABLE ?
    // GAS_CLOUD_SESSION : ...)`) — "logout" immediately re-authenticated the
    // operator as gas-viewer, and refresh() auto-PINGed GAS back into a
    // session. A shared PC inherited the previous user's access after
    // logout + refresh.
    //
    // Logout is now a TERMINATION event for EVERY transport:
    //   1. MQTT disconnected,
    //   2. REST session revoked server-side (when it existed),
    //   3. CSRF cache cleared,
    //   4. GAS device auth tokens + admin tokens CLEARED from sessionStorage
    //      (F2-AUTH-009 — they no longer survive the authentication session),
    //   5. the logout latch is set (survives refresh) so refresh() performs
    //      NO automatic GAS PING and grants NO viewer session,
    //   6. the session state is explicitly UNAUTHENTICATED.
    // Only an explicit login (or an explicit device reconnect in /setup)
    // clears the latch and re-authenticates.
    const hadRestSession = restSession.isAuthenticated;
    if (mqttConnected) {
      mqttDisconnect();
    }
    if (hadRestSession) {
      try {
        await api.logout();
      } catch {
        // Network failure must not block local session teardown — the server
        // session expires within SESSION_TTL (≤1 h) and the revocation list
        // catches it on the next login cycle. CSRF cache is cleared below.
      }
    }
    setCsrfToken(null);
    // [F2-AUTH-009] Credential lifecycle ends with the authentication
    // session — device tokens and admin tokens do NOT survive logout.
    clearAllAuthTokens();
    clearAllAdminTokens();
    // [F2-AUTH-004] Latch + explicit unauthenticated state (the stored GAS
    // profile remains for the NEXT explicit connect — possession of the
    // profile is not authentication, and the auto-PING is suppressed).
    loggedOutRef.current = true;
    writeLoggedOutFlag(true);
    setRestSession(DEFAULT_SESSION);
  }, [mqttConnected, mqttDisconnect, restSession.isAuthenticated]);

  return (
    <AuthContext.Provider
      value={{
        session,
        loading,
        login,
        logout,
        refresh,
        isMqttMode: mqttConnected,
        isGasMode: !mqttConnected && session.role === 'viewer' && session.username === 'gas-viewer',
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export { ApiError } from '@/lib/api';
