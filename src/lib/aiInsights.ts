// =============================================================================
// AI Insights — kontrak & validasi insight (brief §94-95).
// -----------------------------------------------------------------------------
// PWA mengambil insights dari endpoint /api/insights milik ESP32 (HMAC proxy ke
// GAS → Gemini). PWA TIDAK PERNAH memanggil GAS langsung.
//
// [WAVE-7 / PW7-5] File ini sebelumnya berisi hook useAiInsights() dengan
// fallback mock — hook itu DEAD CODE: AiView memakai versi hooks/useApi.ts,
// sehingga validasi isValidInsight() di sini tidak pernah dijalankan. Modul
// ini kini murni validator kontrak; penyaringannya dipanggil dari
// hooks/useApi.ts (satu sumber kebenaran untuk query insights).
// =============================================================================

import type { AiInsight } from "./types";

export const ALLOWED_CATEGORIES = [
  "battery_analysis",
  "energy_analysis",
  "energy_anomaly",
  "maintenance_suggestion",
  "environment_alert",
] as const;

export const ALLOWED_SEVERITIES = ["info", "warning", "critical"] as const;

/**
 * Validasi kontrak per-insight. Setiap insight yang tidak lolos TIDAK
 * dirender — tidak ada jalan bagi payload yang menyamar sebagai insight
 * non-advisory / kategori asing untuk tampil di UI.
 */
export function isValidInsight(ins: unknown): ins is AiInsight {
  if (!ins || typeof ins !== "object") return false;
  const i = ins as Record<string, unknown>;
  if (typeof i.id !== "string" || !i.id) return false;
  if (
    typeof i.category !== "string" ||
    !(ALLOWED_CATEGORIES as readonly string[]).includes(i.category)
  )
    return false;
  if (
    typeof i.severity !== "string" ||
    !(ALLOWED_SEVERITIES as readonly string[]).includes(i.severity)
  )
    return false;
  if (typeof i.title !== "string" || !i.title) return false;
  if (typeof i.body !== "string" || !i.body) return false;
  // Number.isFinite: NaN/Infinity lolos typeof 'number' tapi bukan timestamp sah.
  if (typeof i.generatedAt !== "number" || !Number.isFinite(i.generatedAt)) return false;
  if (typeof i.source !== "string" || !["gemini", "mock"].includes(i.source)) return false;
  if (i.advisoryOnly !== true) return false; // brief §94-95: ALWAYS advisory
  return true;
}
