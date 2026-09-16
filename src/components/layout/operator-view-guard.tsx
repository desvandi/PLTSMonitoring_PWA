'use client';

// =============================================================================
// OperatorViewGuard — centralized RENDER-level authorization boundary.
// -----------------------------------------------------------------------------
// [AUDIT p.484 / p.485b REMEDIATION 2026-09] AppShell's navigation gating
// (mobile AND desktop) is now backed by lib/view-authorization.ts, but the
// render switch in page.tsx must ALSO enforce the same policy — navigation
// hiding is UX, not a security boundary. This guard wraps every
// operator-only view at render time:
//   - a viewer session (MQTT/GAS-derived, read-only scope) that reaches an
//     operator-only currentView (zustand-persisted state, direct store
//     manipulation, stale tab after a role change) sees an explicit
//     ACCESS-DENIED panel — the view component never mounts, its effects
//     never run, and its command paths are never reachable;
//   - an operator session renders the view normally.
// Defense-in-depth stack: nav gating (AppShell) → render gating (this guard)
// → command-layer gating (deviceApi.assertMutationAllowed) → device-side
// auth/CSRF/role (firmware RBAC).
// =============================================================================

import type { ReactNode } from 'react';
import { ShieldAlert } from 'lucide-react';
import { useAuth } from '@/components/providers/auth-provider';
import { canOpenView } from '@/lib/view-authorization';
import type { ViewKey } from '@/lib/store';

export function OperatorViewGuard({ view, children }: { view: ViewKey; children: ReactNode }) {
  const { session } = useAuth();
  if (!canOpenView(session.role, view)) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 py-16 text-center">
        <ShieldAlert className="w-10 h-10 text-status-warn" aria-hidden />
        <h2 className="text-lg font-semibold tracking-tight">
          Access denied — operator session required
        </h2>
        <p className="max-w-md text-sm text-muted-foreground">
          The <span className="font-mono text-xs">{view}</span> view exposes mutating
          operations and is restricted to operator sessions. Your current session is
          viewer-scoped (read-only telemetry). Log in as an operator to access
          configuration, calibration, relay, OTA and emergency controls.
        </p>
      </div>
    );
  }
  return <>{children}</>;
}
