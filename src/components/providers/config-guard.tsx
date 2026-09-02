'use client';

import { useEffect, ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useSysConfig } from './sys-config-provider';

const OPEN_ROUTES = ['/setup', '/install'];

/**
 * Routing Guard — §2.2 of technical brief.
 * If PLTS_SYS_CONFIG missing/invalid → redirect to /setup.
 */
export function ConfigGuard({ children }: { children: ReactNode }) {
  const { config, ready } = useSysConfig();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!ready) return;
    const isOpenRoute = OPEN_ROUTES.some((r) => pathname === r || pathname.startsWith(`${r}/`));
    if (!config && !isOpenRoute) {
      router.replace('/setup');
    }
  }, [config, ready, pathname, router]);

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Memuat konfigurasi...</p>
        </div>
      </div>
    );
  }

  const isOpenRoute = OPEN_ROUTES.some((r) => pathname === r || pathname.startsWith(`${r}/`));
  if (!config && !isOpenRoute) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Mengalihkan ke setup awal...</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
