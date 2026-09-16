'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';
import { ReactNode } from 'react';

export function ThemeProvider({
  children,
  nonce,
}: {
  children: ReactNode;
  /** [p.481] Per-request CSP nonce (from src/middleware.ts via the root
   *  layout) — next-themes forwards it to its anti-FOUC inline script so
   *  the script passes the nonce-based script-src policy. */
  nonce?: string;
}) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem
      disableTransitionOnChange={false}
      storageKey="plts-theme"
      nonce={nonce}
    >
      {children}
    </NextThemesProvider>
  );
}
