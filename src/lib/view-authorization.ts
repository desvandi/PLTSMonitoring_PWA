// =============================================================================
// view-authorization — THE single source of truth for view-level role gating.
// -----------------------------------------------------------------------------
// [AUDIT p.484 / p.485b REMEDIATION 2026-09]
// Previously role enforcement was scattered and incomplete:
//   - the MOBILE navigation checked canOpenView(), but the DESKTOP sidebar
//     called onNavClick(item.key) directly — a viewer could open every
//     operator-only view from the desktop sidebar;
//   - page.tsx rendered views purely on `currentView` with NO role check —
//     the gate was navigation-only, not a render boundary;
//   - OPERATOR_ONLY_VIEWS omitted 'emergency' (ARM/DISARM/CONFIG controls).
//
// Now AppShell (mobile + desktop), the page-level render switch, and the
// command layer all consume THIS module. Viewer sessions (MQTT/GAS-derived)
// can never open or render operator-only views, even by direct state
// manipulation (currentView is zustand-persisted and survives reload).
// =============================================================================

import type { ViewKey } from "@/lib/store";
import type { SessionInfo } from "@/lib/types";

/**
 * Views that expose MUTATING surfaces. A viewer-scoped session (broker
 * subscription / GAS profile proves READ identity only) must never reach
 * them. [p.485b] 'emergency' is included: the view contains ARM, DISARM and
 * CONFIG controls — ADMIN_TOKEN remains the deeper gate (defense-in-depth),
 * but the view itself must not render for viewers.
 */
export const OPERATOR_ONLY_VIEWS: readonly ViewKey[] = [
  "calibration",
  "config",
  "ota",
  "settings",
  "relays",
  // [p.485b] previously missing — the audit's explicit finding.
  "emergency",
];

export function isOperatorOnlyView(v: ViewKey): boolean {
  return (OPERATOR_ONLY_VIEWS as readonly string[]).includes(v);
}

/**
 * May a session with this role open/render this view?
 * Fail-closed direction: an UNKNOWN role (undefined) is treated as
 * non-viewer ONLY because unauthenticated users never reach the shell
 * (page.tsx renders LoginForm instead); the render guard still blocks
 * viewers explicitly.
 */
export function canOpenView(role: SessionInfo["role"], v: ViewKey): boolean {
  return role !== "viewer" || !isOperatorOnlyView(v);
}
