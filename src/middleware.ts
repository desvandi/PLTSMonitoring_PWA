// =============================================================================
// middleware.ts — nonce-based Content-Security-Policy (AUDIT p.481).
// -----------------------------------------------------------------------------
// The previous production CSP (vercel.json) carried 'unsafe-inline' in BOTH
// script-src and style-src — gutting the CSP's XSS mitigation exactly where
// it matters (script execution). This middleware now issues a PER-REQUEST
// nonce and enforces:
//
//   script-src 'self' 'nonce-<per-request>' https://va.vercel-scripts.com
//     → inline <script> without the nonce is BLOCKED. Next.js reads the
//       nonce from the request headers and applies it to its own bootstrap
//       scripts automatically (documented app-router pattern).
//   style-src keeps 'unsafe-inline' as a DOCUMENTED RESIDUAL (P3):
//     the shadcn chart component injects a <style> tag with dynamic CSS
//     custom properties (chart.tsx). Removing it requires refactoring the
//     theming layer; style injection is materially lower risk than script
//     injection and is tracked in REMEDIATION.md.
//   frame-ancestors 'none' + X-Frame-Options: DENY — the PWA has no
//     same-origin embedding requirement; clickjacking surface removed.
//
// Development adds 'unsafe-eval' (React Refresh / HMR requirement).
// =============================================================================

import { NextRequest, NextResponse } from "next/server";

function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export function middleware(request: NextRequest) {
  const nonce = generateNonce();
  const isDev = process.env.NODE_ENV !== "production";

  const csp = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' https://va.vercel-scripts.com${
      isDev ? " 'unsafe-eval'" : ""
    }`,
    // [p.481 residual — documented] chart.tsx dynamic CSS variables require
    // inline <style>; refactor to constructable stylesheets is tracked.
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob:`,
    `font-src 'self' data:`,
    // GAS (https), device API (https), MQTT broker (wss), Vercel analytics.
    `connect-src 'self' https: wss:`,
    `worker-src 'self' blob:`,
    `manifest-src 'self'`,
    `media-src 'self' data:`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    // [p.481] was 'self' — the PWA never embeds itself in an iframe.
    `frame-ancestors 'none'`,
    `upgrade-insecure-requests`,
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  // Next.js reads the nonce from the request headers and applies it to the
  // scripts it emits (app-router nonce pattern from the Next.js docs).
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  response.headers.set("Content-Security-Policy", csp);
  // [p.481] DENY (was SAMEORIGIN via vercel.json) — no embedding use case.
  response.headers.set("X-Frame-Options", "DENY");
  return response;
}

export const config = {
  matcher: [
    // All application routes — static assets skip the middleware (no CSP
    // semantics on non-document responses) and keep vercel.json's baseline
    // hardening headers.
    {
      source:
        "/((?!_next/static|_next/image|favicon.ico|favicon-32.png|icon-192.png|apple-icon.png|manifest.webmanifest|sw.js|icon.svg|vendor/).*)",
    },
  ],
};
