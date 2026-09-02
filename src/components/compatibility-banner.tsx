'use client';

import { useCompatibility } from '@/lib/compatibility';
import { AlertTriangle, RefreshCw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/components/providers/language-provider';

// =============================================================================
// CompatibilityBanner — shows when firmware version/protocol is incompatible.
// -----------------------------------------------------------------------------
// Provides a clear recovery path: refresh to fetch latest cached PWA, or
// connect via MQTT instead of LAN.
// =============================================================================

export function CompatibilityBanner() {
  const { data } = useCompatibility();
  // Hook subscription kept; translator binding removed (unused).
  useLanguage();
  const [dismissed, setDismissed] = useState(false);
  const pathname = usePathname();

  // Re-show banner when status changes from compatible → incompatible.
  // [react-hooks/set-state-in-effect] Pola resmi "adjust state when a
  // prop changes": setState saat render me-render ulang seketika tanpa
  // commit state antara — semantik identik effect lama, tanpa effect.
  const [prevStatus, setPrevStatus] = useState(data?.status);
  if (data?.status !== prevStatus) {
    setPrevStatus(data?.status);
    if (data && data.status !== 'compatible') setDismissed(false);
  }

  // Suppress banner on onboarding routes — Setup/Install have no AppShell
  // header, so the sticky top-14 would visually collide with the page title.
  const OPEN_ROUTES = ['/setup', '/install'];
  if (OPEN_ROUTES.some((r) => pathname === r || pathname.startsWith(`${r}/`))) {
    return null;
  }

  if (!data || data.status === 'compatible' || dismissed) return null;

  const isError = data.status === 'unknown' || data.status === 'protocol_mismatch' ||
    data.status === 'firmware_too_old' || data.status === 'config_schema_mismatch';

  return (
    <div
      className={cn(
        'border-b px-4 py-2.5 flex items-center gap-3 text-sm',
        isError
          ? 'bg-status-error/10 border-status-error/30 text-status-error'
          : 'bg-status-warn/10 border-status-warn/30 text-status-warn',
      )}
      role="alert"
    >
      <AlertTriangle className="w-4 h-4 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <span className="font-medium">{data.message}</span>
        <span className="ml-2 text-xs opacity-80">
          PWA v{data.pwaVersion}
          {data.firmwareVersion ? ` · Firmware v${data.firmwareVersion}` : ''}
          {data.protocolVersion != null ? ` · Protocol v${data.protocolVersion}` : ''}
        </span>
      </div>
      <Button
        size="sm"
        variant="outline"
        onClick={() => window.location.reload()}
        className="flex-shrink-0"
      >
        <RefreshCw className="w-3 h-3 mr-1.5" />
        Refresh
      </Button>
      <Button
        size="icon"
        variant="ghost"
        onClick={() => setDismissed(true)}
        className="flex-shrink-0 h-7 w-7"
        aria-label="Dismiss"
      >
        <X className="w-3.5 h-3.5" />
      </Button>
    </div>
  );
}
