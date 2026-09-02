'use client';

// =============================================================================
// AuthProvider — manages PWA session (REST or MQTT mode).
// -----------------------------------------------------------------------------
// In MQTT mode, the user is auto-authenticated when MQTT connects (no
// password — device identity established via broker subscription).
// In REST mode, login uses username/password → JWT cookie + CSRF token.
// =============================================================================

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { api, setCsrfToken } from '@/lib/api';
import type { SessionInfo } from '@/lib/types';
import { useMqtt } from '@/components/providers/mqtt-provider';
import { useSysConfig } from '@/components/providers/sys-config-provider';

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

export function AuthProvider({ children }: { children: ReactNode }) {
  const { connected: mqttConnected, disconnect: mqttDisconnect } = useMqtt();
  const { config } = useSysConfig();
  // [AUDIT 2026-08-28 G5] Sesi MQTT kini DERIVED SAAT RENDER dari status
  // koneksi broker (bukan setState di dalam effect): `mqttConnected` sudah
  // reaktif, menurunkannya ke state terpisah hanya menciptakan sumber kedua
  // yang bisa saling bertentangan + cascading render.
  const [restSession, setRestSession] = useState<SessionInfo>(DEFAULT_SESSION);
  const [restLoading, setRestLoading] = useState(true);

  const refresh = useCallback(async () => {
    // Mode MQTT: sesi efektif sudah dicakup derived state; panggilan REST
    // /api/session hanya akan 401 di produksi MQTT-only — jangan panggil.
    if (mqttConnected) return;
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
        // [F9] No REST session, no MQTT — but the operator HAS a validated
        // GAS profile in PLTS_SYS_CONFIG → viewer session for GAS mode.
        setRestSession(GAS_CLOUD_SESSION);
      } else {
        setRestSession(DEFAULT_SESSION);
      }
    } catch {
      // The PWA's own session route being unreachable does NOT invalidate the
      // operator's locally-stored GAS profile (GAS data flows browser → GAS
      // directly) — the viewer session stands; REST operator scope is never
      // granted on error (fail-closed against privilege escalation).
      setRestSession(config && !LAN_LOGIN_AVAILABLE ? GAS_CLOUD_SESSION : DEFAULT_SESSION);
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
    if (mqttConnected) {
      mqttDisconnect();
      // Setelah broker terputus, derived session jatuh ke restSession —
      // kembalikan ke profil GAS (viewer) bila zero-touch, bukan sesi admin.
      setRestSession(config && !LAN_LOGIN_AVAILABLE ? GAS_CLOUD_SESSION : DEFAULT_SESSION);
      return;
    }
    try {
      await api.logout();
    } catch {
      // ignore
    }
    setCsrfToken(null);
    // [F9] Logging out of REST does not erase the local GAS profile — the
    // operator returns to the (viewer-scoped) GAS session, mirroring MQTT.
    setRestSession(config && !LAN_LOGIN_AVAILABLE ? GAS_CLOUD_SESSION : DEFAULT_SESSION);
  }, [mqttConnected, mqttDisconnect, config]);

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
