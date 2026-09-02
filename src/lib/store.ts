// =============================================================================
// Client-side UI state (Zustand).
// -----------------------------------------------------------------------------
// 15 views (brief §52-67). Persisted across reloads so users land on the same
// view after closing/reopening the PWA.
// =============================================================================

import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ViewKey =
  | "dashboard"
  | "battery"
  | "ac"
  | "environment"
  | "energy"
  | "calibration"
  | "config"
  | "alarms"
  | "diagnostics"
  | "sensors"
  | "events"
  | "reports"
  | "ai"
  | "settings"
  | "ota"
  | "fleet"
  | "emergency";

/** Daftar view valid — dipakai deep-link push-alarm (?view=alarms) agar
 *  parameter URL tidak bisa meng-inject nilai sembarangan ke state UI. */
export const VIEW_KEYS: readonly ViewKey[] = [
  "dashboard",
  "fleet",
  "battery",
  "ac",
  "environment",
  "energy",
  "calibration",
  "config",
  "alarms",
  "diagnostics",
  "sensors",
  "events",
  "reports",
  "ai",
  "settings",
  "ota",
  "emergency",
] as const;

export function isViewKey(value: unknown): value is ViewKey {
  return typeof value === "string" && (VIEW_KEYS as readonly string[]).includes(value);
}

type UiState = {
  currentView: ViewKey;
  setView: (v: ViewKey) => void;
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  // Historical chart time-range selector (battery view)
  chartTimeRange: "1h" | "6h" | "12h" | "24h" | "7d" | "30d";
  setChartTimeRange: (r: UiState["chartTimeRange"]) => void;
};

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      currentView: "dashboard",
      setView: (v) => set({ currentView: v }),
      sidebarCollapsed: false,
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      chartTimeRange: "1h",
      setChartTimeRange: (r) => set({ chartTimeRange: r }),
    }),
    {
      name: "plts-ui",
      partialize: (s) => ({
        currentView: s.currentView,
        sidebarCollapsed: s.sidebarCollapsed,
        chartTimeRange: s.chartTimeRange,
      }),
    },
  ),
);
