// =============================================================================
// /api/health — Readiness check untuk uptime & cron harian Vercel.
// =============================================================================
// Prinsip: "Sistem tidak boleh berbohong pada operator."
//  - Hanya melaporkan fakta nyata (boolean keberadaan env, hasil ping GAS).
//  - TIDAK membocorkan nilai secret apa pun (hanya "configured: true/false").
//  - Jika GAS tidak dikonfigurasi, dilaporkan apa adanya — bukan "OK" palsu.
//
// Endpoint ini publik (tanpa auth) karena:
//  1. Dipanggil oleh Vercel Cron (header x-vercel-cron) tiap hari 03:00 WIB.
//  2. Semua informasi yang dikembalikan tidak sensitif (boolean + versi).
// =============================================================================

import { ok } from "@/lib/apiResponse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

const GAS_PING_TIMEOUT_MS = 8000;

interface GasPingResult {
  attempted: boolean;
  configured: boolean;
  reachable: boolean;
  httpStatus: number | null;
  error: string | null;
}

async function pingGas(url: string): Promise<GasPingResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GAS_PING_TIMEOUT_MS);
  try {
    // HEAD lebih murah daripada GET; sebagian deployment GAS tidak mengizinkan
    // HEAD, maka fallback ke GET jika status 405/403.
    let res: Response;
    try {
      res = await fetch(url, {
        method: "HEAD",
        redirect: "follow",
        signal: controller.signal,
        cache: "no-store",
      });
      if (res.status === 405 || res.status === 403) {
        res = await fetch(url, {
          method: "GET",
          redirect: "follow",
          signal: controller.signal,
          cache: "no-store",
        });
      }
    } catch {
      res = await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        cache: "no-store",
      });
    }
    return {
      attempted: true,
      configured: true,
      reachable: res.ok,
      httpStatus: res.status,
      error: res.ok ? null : `HTTP ${res.status}`,
    };
  } catch (err) {
    const msg =
      err instanceof Error && err.name === "AbortError"
        ? `timeout setelah ${GAS_PING_TIMEOUT_MS}ms`
        : err instanceof Error
          ? err.message
          : "unknown";
    return {
      attempted: true,
      configured: true,
      reachable: false,
      httpStatus: null,
      error: msg,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(request: Request) {
  const viaCron = request.headers.get("x-vercel-cron") === "1";

  const gasUrl = process.env.NEXT_PUBLIC_GAS_INSIGHTS_URL?.trim() || "";
  const jwtSecret = process.env.JWT_SECRET?.trim() || "";

  const checks = {
    mqttBrokerConfigured: Boolean(
      process.env.NEXT_PUBLIC_MQTT_BROKER_URL?.trim(),
    ),
    mqttCredentialsConfigured: Boolean(
      process.env.NEXT_PUBLIC_MQTT_USERNAME?.trim() &&
        process.env.NEXT_PUBLIC_MQTT_PASSWORD?.trim(),
    ),
    gasUrlConfigured: gasUrl.length > 0,
    jwtSecretConfigured: jwtSecret.length >= 32,
  };

  // Ping GAS hanya jika URL terpasang — jangan mengarang hasil.
  const gasPing: GasPingResult = gasUrl
    ? await pingGas(gasUrl)
    : {
        attempted: false,
        configured: false,
        reachable: false,
        httpStatus: null,
        error: "NEXT_PUBLIC_GAS_INSIGHTS_URL tidak diset",
      };

  return ok(
    {
      service: "plts-monitor-pwa",
      nodeEnv: process.env.NODE_ENV ?? null,
      via: viaCron ? "cron" : "manual",
      timestamp: new Date().toISOString(),
      checks,
      gasPing,
    },
    "Health check selesai",
  );
}
