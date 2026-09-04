'use client';

// =============================================================================
// Event Log View — system events (brief §61)
// -----------------------------------------------------------------------------
// Event types (firmware emits these):
//   DEVICE_BOOT, WIFI_CONNECTED, WIFI_DISCONNECTED, TIME_SYNCED,
//   SENSOR_FAILURE, SENSOR_RECOVERED, ALARM_ACTIVE, ALARM_ACKNOWLEDGED,
//   ALARM_CLEARED, SOC_BASELINE_CORRECTED, CALIBRATION_CHANGED,
//   CONFIGURATION_CHANGED, OTA_STARTED, OTA_SUCCESS, OTA_FAILED,
//   STORAGE_ERROR.
//
// Events are NVS-persisted (ring buffer 200 entries) + mirrored to /api/events.
// This view provides filter by type + time-range selection + CSV export.
// =============================================================================

import { useState, useMemo } from 'react';
import { api } from '@/lib/api';
import { useLanguage } from '@/components/providers/language-provider';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { History, Download, RefreshCw } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { formatDateTime } from '@/lib/format';
import { toast } from 'sonner';
import type { SystemEvent, EventType } from '@/lib/types';

// Event type → display color
const EVENT_COLORS: Record<EventType, string> = {
  DEVICE_BOOT: 'text-status-info',
  WIFI_CONNECTED: 'text-status-on',
  WIFI_DISCONNECTED: 'text-status-warn',
  TIME_SYNCED: 'text-status-info',
  SENSOR_FAILURE: 'text-status-error',
  SENSOR_RECOVERED: 'text-status-on',
  ALARM_ACTIVE: 'text-status-warn',
  ALARM_ACKNOWLEDGED: 'text-status-info',
  ALARM_CLEARED: 'text-status-on',
  SOC_BASELINE_CORRECTED: 'text-status-info',
  CALIBRATION_CHANGED: 'text-primary',
  CONFIGURATION_CHANGED: 'text-primary',
  OTA_STARTED: 'text-status-info',
  OTA_SUCCESS: 'text-status-on',
  OTA_FAILED: 'text-status-error',
  STORAGE_ERROR: 'text-status-error',
};

export function EventLogView() {
  const { t } = useLanguage();
  const [filterType, setFilterType] = useState<EventType | 'all'>('all');
  const [limit, setLimit] = useState(50);

  // Fetch events (no auto-refresh — events are slow-changing)
  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['events', filterType, limit],
    queryFn: () => api.events({ limit }),
    staleTime: 60_000,
  });

  // [AUDIT 2026-08-28 G3] `data?.events ?? []` dievaluasi DI DALAM useMemo:
  // di luar, setiap render membuat array baru → dependensi useMemo berubah
  // setiap render (filter type pelan tapi bocor memoization).
  const filtered = useMemo(() => {
    const events = data?.events ?? [];
    if (filterType === 'all') return events;
    return events.filter((e) => e.type === filterType);
  }, [data, filterType]);

  const exportCsv = () => {
    if (filtered.length === 0) {
      toast.error('No events to export');
      return;
    }
    const headers = ['timestamp', 'iso', 'type', 'message', 'payload'];
    const rows = filtered.map((e) => [
      e.timestamp,
      new Date(e.timestamp).toISOString(),
      e.type,
      // Escape quotes + newlines for CSV
      `"${e.message.replace(/"/g, '""').replace(/\n/g, ' ')}"`,
      `"${JSON.stringify(e.payload ?? {}).replace(/"/g, '""')}"`,
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `plts-events-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${filtered.length} events`);
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-12 w-64" />
        <Skeleton className="h-16 rounded-xl" />
        <Skeleton className="h-96 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <History className="w-6 h-6 text-primary" />
          {t('events.title')}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">{t('events.subtitle')}</p>
      </div>

      {/* Filter bar */}
      <Card className="border-border/60">
        <CardContent className="p-3 flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground uppercase tracking-wider">
              {t('events.filter_type')}:
            </span>
            <Select value={filterType} onValueChange={(v) => setFilterType(v as EventType | 'all')}>
              <SelectTrigger className="w-48 h-8">
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All events</SelectItem>
                {Object.keys(EVENT_COLORS).map((et) => (
                  <SelectItem key={et} value={et}>
                    {et.replace(/_/g, ' ').toLowerCase()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground uppercase tracking-wider">
              Limit:
            </span>
            <Select value={String(limit)} onValueChange={(v) => setLimit(parseInt(v, 10))}>
              <SelectTrigger className="w-24 h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="50">50</SelectItem>
                <SelectItem value="100">100</SelectItem>
                <SelectItem value="200">200</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="ml-auto flex gap-2">
            <Button
              variant="outline" size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
            >
              <RefreshCw className={`w-3 h-3 mr-1 ${isFetching ? 'animate-spin' : ''}`} />
              {t('common.refresh')}
            </Button>
            <Button variant="outline" size="sm" onClick={exportCsv}>
              <Download className="w-3 h-3 mr-1" />
              CSV
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Event list */}
      <Card className="border-border/60">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center justify-between">
            <span>
              {filtered.length} event{filtered.length === 1 ? '' : 's'}
              {filterType !== 'all' && ` (${filterType.replace(/_/g, ' ').toLowerCase()})`}
            </span>
            {data?.total != null && (
              <span className="text-[10px] text-muted-foreground">
                Total in journal: {data.total}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {filtered.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground text-sm">
              {t('events.empty')}
            </div>
          ) : (
            <ScrollArea className="h-[60vh] pr-3">
              <div className="space-y-2">
                {filtered.map((ev: SystemEvent) => {
                  const color = EVENT_COLORS[ev.type] ?? 'text-muted-foreground';
                  return (
                    <div
                      key={ev.id}
                      className="flex items-start gap-3 p-2 rounded-md hover:bg-muted/40 text-xs"
                    >
                      <span className="font-mono text-muted-foreground flex-shrink-0 w-32">
                        {formatDateTime(ev.timestamp)}
                      </span>
                      <Badge
                        variant="outline"
                        className={`text-[9px] px-1.5 h-4 flex-shrink-0 ${color}`}
                      >
                        {ev.type.replace(/_/g, ' ')}
                      </Badge>
                      <div className="flex-1 min-w-0">
                        <p className="text-foreground">{ev.message}</p>
                        {ev.payload && Object.keys(ev.payload).length > 0 && (
                          <details className="mt-1 text-[10px] text-muted-foreground">
                            <summary className="cursor-pointer">payload</summary>
                            <pre className="mt-1 p-2 bg-muted/40 rounded text-[10px] overflow-x-auto">
                              {JSON.stringify(ev.payload, null, 2)}
                            </pre>
                          </details>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
