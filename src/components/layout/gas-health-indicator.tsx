'use client';

import { CheckCircle2, Loader2, RefreshCw, WifiOff, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useGasHealth } from '@/hooks/useGasHealth';
import { useSysConfig } from '@/components/providers/sys-config-provider';

const STYLES = {
  idle:     { dot: 'bg-muted-foreground/60', ring: 'ring-muted-foreground/30' },
  checking: { dot: 'bg-sky-400 animate-pulse',    ring: 'ring-sky-400/30' },
  online:   { dot: 'bg-emerald-500',              ring: 'ring-emerald-500/30' },
  degraded: { dot: 'bg-amber-500',                ring: 'ring-amber-500/30' },
  offline:  { dot: 'bg-red-500',                  ring: 'ring-red-500/30' },
} as const;

const LABELS = {
  idle: 'Idle',
  checking: 'Memeriksa...',
  online: 'GAS Online',
  degraded: 'GAS Lambat',
  offline: 'GAS Offline',
} as const;

export function GasHealthIndicator() {
  const { config } = useSysConfig();
  const { state, latency_ms, last_checked_at, message, refresh } = useGasHealth();
  const style = STYLES[state];

  if (!config) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-2 text-xs px-2 py-1 rounded-md hover:bg-muted transition-colors"
          data-testid="gas-health-dot"
          aria-label={`Status GAS: ${LABELS[state]}`}
        >
          <span
            className={cn(
              'inline-block w-2.5 h-2.5 rounded-full ring-4',
              style.dot,
              style.ring
            )}
          />
          <span className="hidden md:inline text-muted-foreground">{LABELS[state]}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            {state === 'online' && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
            {state === 'degraded' && <AlertTriangle className="w-4 h-4 text-amber-500" />}
            {state === 'offline' && <WifiOff className="w-4 h-4 text-red-500" />}
            {state === 'checking' && <Loader2 className="w-4 h-4 animate-spin text-sky-400" />}
            <p className="text-sm font-medium">Google Apps Script</p>
          </div>
          <dl className="text-xs space-y-1 text-muted-foreground">
            <div className="flex justify-between">
              <dt>Status</dt>
              <dd className="text-foreground">{LABELS[state]}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Latency</dt>
              <dd className="font-mono">{latency_ms != null ? `${latency_ms} ms` : '—'}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Terakhir</dt>
              <dd className="font-mono">
                {last_checked_at ? new Date(last_checked_at).toLocaleTimeString('id-ID') : '—'}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt>Device</dt>
              <dd className="font-mono truncate max-w-[10rem]">{config.device_id}</dd>
            </div>
          </dl>
          <p className="text-xs text-muted-foreground break-words">{message}</p>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void refresh()}
            className="w-full"
            data-testid="gas-health-refresh"
          >
            <RefreshCw className="w-3.5 h-3.5 mr-2" /> Cek Ulang Sekarang
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
