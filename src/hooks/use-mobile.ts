import * as React from "react";

const MOBILE_BREAKPOINT = 768;

function subscribeToViewport(callback: () => void): () => void {
  const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
  mql.addEventListener("change", callback);
  return () => mql.removeEventListener("change", callback);
}

/**
 * Media-query-backed viewport flag. useSyncExternalStore is the
 * compiler-approved replacement for the old mount-effect + setState chain
 * (react-hooks/set-state-in-effect): getSnapshot returns a primitive so the
 * snapshot reference is always stable, and getServerSnapshot=false keeps the
 * historical first-render/SSR answer.
 */
export function useIsMobile() {
  const isMobile = React.useSyncExternalStore(
    subscribeToViewport,
    () => window.innerWidth < MOBILE_BREAKPOINT,
    () => false,
  );
  return isMobile;
}
