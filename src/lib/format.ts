// =============================================================================
// Formatting utilities for the PLTS Monitor dashboard.
// -----------------------------------------------------------------------------
// KEY DISCIPLINE (brief §1): `null` is invalid/unknown, NEVER 0.
// fmtV(null) → "N/A", not "0.00 V".
// =============================================================================

export type Language = "id" | "en";

export function fmtV(v: number | null | undefined, unit = "V", digits = 2): string {
  if (v == null || !Number.isFinite(v)) return "N/A";
  return `${v.toFixed(digits)} ${unit}`;
}

export function fmtA(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return "N/A";
  return `${v.toFixed(digits)} A`;
}

export function fmtW(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "N/A";
  return `${v.toFixed(digits)} W`;
}

export function fmtWh(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "N/A";
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(digits)} kWh`;
  return `${v.toFixed(digits)} Wh`;
}

export function fmtAh(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return "N/A";
  return `${v.toFixed(digits)} Ah`;
}

export function fmtPct(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "N/A";
  return `${v.toFixed(digits)}%`;
}

export function fmtTemp(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "N/A";
  return `${v.toFixed(digits)} °C`;
}

export function fmtHum(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "N/A";
  return `${v.toFixed(digits)} %`;
}

export function formatUptime(seconds: number, lang: Language = "id"): string {
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const parts: string[] = [];
  if (d > 0) parts.push(`${d} ${lang === "id" ? "h" : "d"}`);
  if (h > 0) parts.push(`${h} ${lang === "id" ? "j" : "h"}`);
  if (m > 0) parts.push(`${m} ${lang === "id" ? "m" : "m"}`);
  parts.push(`${ss}s`);
  return parts.join(" ");
}

export function formatTime(ts: number, timezone?: string, lang: Language = "id"): string {
  const d = new Date(ts);
  try {
    return new Intl.DateTimeFormat(lang === "id" ? "id-ID" : "en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      timeZone: timezone,
    }).format(d);
  } catch {
    return d.toLocaleTimeString();
  }
}

export function formatDateTime(ts: number, timezone?: string, lang: Language = "id"): string {
  const d = new Date(ts);
  try {
    return new Intl.DateTimeFormat(lang === "id" ? "id-ID" : "en-US", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      timeZone: timezone,
    }).format(d);
  } catch {
    return d.toLocaleString();
  }
}

export function formatDate(ts: number, timezone?: string, lang: Language = "id"): string {
  const d = new Date(ts);
  try {
    return new Intl.DateTimeFormat(lang === "id" ? "id-ID" : "en-US", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone: timezone,
    }).format(d);
  } catch {
    return d.toLocaleDateString();
  }
}

export function formatRelativeTime(ts: number | null, lang: Language = "id"): string {
  if (!ts) return lang === "id" ? "Tidak pernah" : "Never";
  const diff = Date.now() - ts;
  if (diff < 5_000) return lang === "id" ? "Baru saja" : "Just now";
  if (diff < 60_000)
    return lang === "id"
      ? `${Math.floor(diff / 1000)} dtk lalu`
      : `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000)
    return lang === "id"
      ? `${Math.floor(diff / 60000)} mnt lalu`
      : `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86_400_000)
    return lang === "id"
      ? `${Math.floor(diff / 3_600_000)} jam lalu`
      : `${Math.floor(diff / 3_600_000)}h ago`;
  return lang === "id"
    ? `${Math.floor(diff / 86_400_000)} hari lalu`
    : `${Math.floor(diff / 86_400_000)}d ago`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return "N/A";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function formatRssi(rssi: number): { label: string; bars: number } {
  if (!Number.isFinite(rssi)) return { label: "Unknown", bars: 0 };
  if (rssi >= -55) return { label: "Excellent", bars: 4 };
  if (rssi >= -65) return { label: "Good", bars: 3 };
  if (rssi >= -75) return { label: "Fair", bars: 2 };
  if (rssi >= -85) return { label: "Weak", bars: 1 };
  return { label: "Poor", bars: 0 };
}

// Compute dew point via Magnus formula — used to display "DERIVED" quality.
export function computeDewPoint(tempC: number, humidityPct: number): number | null {
  if (!Number.isFinite(tempC) || !Number.isFinite(humidityPct)) return null;
  if (humidityPct <= 0 || humidityPct > 100) return null;
  const a = 17.625;
  const b = 243.04;
  const alpha = Math.log(humidityPct / 100) + (a * tempC) / (b + tempC);
  return (b * alpha) / (a - alpha);
}

// Estimate condensation risk: dew point within 3 °C of ambient temp
// (conservative threshold — surface temp estimate).
export function isCondensationRisk(tempC: number | null, humidityPct: number | null): boolean {
  if (tempC == null || humidityPct == null) return false;
  const dp = computeDewPoint(tempC, humidityPct);
  if (dp == null) return false;
  return tempC - dp < 3;
}

// Estimate remaining runtime in hours given current draw (W) and remaining Ah.
// Returns null if inputs invalid or current draw ~0.
export function estimateRuntimeHours(
  remainingAh: number | null,
  currentW: number | null,
  voltage: number | null,
): number | null {
  if (remainingAh == null || currentW == null || voltage == null) return null;
  if (!Number.isFinite(remainingAh) || !Number.isFinite(currentW) || !Number.isFinite(voltage))
    return null;
  if (currentW <= 0 || voltage <= 0) return null;
  const remainingWh = remainingAh * voltage;
  return remainingWh / currentW;
}
