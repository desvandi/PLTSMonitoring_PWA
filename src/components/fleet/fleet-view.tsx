'use client';

import { RefreshCw, Signal, Cpu, ArrowRight, AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { useSysConfig } from '@/components/providers/sys-config-provider';
import { useFleetStatus, type FleetDeviceStatus } from '@/hooks/useFleetStatus';

function rssiBars(rssi: number | null): string {
  if (rssi == null) return '—';
  if (rssi >= -60) return '████';
  if (rssi >= -70) return '███ ';
  if (rssi >= -80) return '██  ';
  if (rssi >= -90) return '█   ';
  return '·   ';
}

function fmtRelative(iso: string | null): string {
  if (!iso) return '—';
  const diffMs = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diffMs)) return '—';
  if (diffMs < 45_000) return 'baru saja';
  if (diffMs < 3_600_000) return `${Math.round(diffMs / 60_000)} menit lalu`;
  if (diffMs < 86_400_000) return `${Math.round(diffMs / 3_600_000)} jam lalu`;
  return `${Math.round(diffMs / 86_400_000)} hari lalu`;
}

export function FleetView() {
  const { config, switchDevice } = useSysConfig();
  const { statuses, refresh, lastRefreshAt } = useFleetStatus();

  if (!config) return null;

  const online = statuses.filter((s) => s.online).length;
  const total = statuses.length;

  const onSwitch = (device: FleetDeviceStatus['device']) => {
    switchDevice(device.device_id);
    toast.success(`Perangkat aktif: ${device.label}`);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold" data-testid="fleet-title">
            Fleet Dashboard
          </h2>
          <p className="text-sm text-muted-foreground">
            Ringkasan status semua perangkat terdaftar di PWA ini.{' '}
            {lastRefreshAt && (
              <span className="font-mono">
                · sync terakhir {new Date(lastRefreshAt).toLocaleTimeString('id-ID')}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs">
            {online}/{total} online
          </Badge>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void refresh()}
            data-testid="fleet-refresh"
          >
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Sync
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Cpu className="w-4 h-4" /> Perangkat Terdaftar
          </CardTitle>
          <CardDescription>
            Data diambil langsung dari GAS masing-masing perangkat (aksi <code>LATEST</code>).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table data-testid="fleet-table">
              <TableHeader>
                <TableRow>
                  <TableHead>Perangkat</TableHead>
                  <TableHead className="text-right">V-Bat</TableHead>
                  <TableHead className="text-right">SOC</TableHead>
                  <TableHead className="text-right">I-DC (INA219)</TableHead>
                  <TableHead className="text-right">I-AC (ACS712)</TableHead>
                  <TableHead className="text-right">RSSI</TableHead>
                  <TableHead>Firmware</TableHead>
                  <TableHead>Terakhir Online</TableHead>
                  <TableHead className="text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {statuses.map((row) => {
                  const isActive = row.device.device_id === config.active_device_id;
                  return (
                    <TableRow
                      key={row.device.device_id}
                      data-testid={`fleet-row-${row.device.device_id}`}
                      className={cn(isActive && 'bg-muted/40')}
                    >
                      <TableCell>
                        <div className="flex items-center gap-2 min-w-0">
                          {row.loading ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground shrink-0" />
                          ) : row.online ? (
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                          ) : (
                            <AlertTriangle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                          )}
                          <div className="min-w-0">
                            <p className="font-medium text-sm truncate">
                              {row.device.label}
                              {isActive && (
                                <Badge variant="outline" className="ml-2 text-[10px] font-normal">
                                  aktif
                                </Badge>
                              )}
                            </p>
                            <p className="text-[10px] text-muted-foreground font-mono truncate">
                              {row.device.device_id}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="font-mono">
                          {row.telemetry?.v_bat != null ? `${row.telemetry.v_bat.toFixed(2)} V` : '—'}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        {/* [AUDIT 2026-08-28 F10] SOC + provenance — the fleet
                            card never shows a bare SOC number without telling
                            the operator WHERE it came from. */}
                        {row.telemetry?.soc_percent != null ? (
                          <span className="inline-flex flex-col items-end leading-tight">
                            <span className="font-mono">{row.telemetry.soc_percent.toFixed(1)}%</span>
                            <span
                              className="text-[9px] text-muted-foreground font-mono"
                              data-testid={`fleet-soc-source-${row.device.device_id}`}
                            >
                              {row.telemetry.soc_source ?? 'UNKNOWN'}
                            </span>
                          </span>
                        ) : (
                          <span className="font-mono">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        <span className={cn(row.telemetry?.ina219_ok === 'false' && 'text-amber-500')}>
                          {row.telemetry?.i_bat_dc != null ? `${row.telemetry.i_bat_dc.toFixed(2)} A` : '—'}
                        </span>
                        {/* [PARITY-3 2026-09-06 FIX] Dead branch: gasEnvelope maps ina219_ok to
                            'true' | 'false' | null — the literal 'MISSING' never
                            occurred, so the "sensor absen" hint could never
                            render. 'false' is the device's honest report. */}
                        {row.telemetry?.ina219_ok === 'false' && (
                          <div className="text-[10px] text-amber-500">sensor absen</div>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {row.telemetry?.i_ac_load != null ? `${row.telemetry.i_ac_load.toFixed(2)} A` : '—'}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        <span className="inline-flex items-center gap-1">
                          <Signal className="w-3 h-3" />
                          <span>{row.telemetry?.rssi != null ? `${row.telemetry.rssi}` : '—'}</span>
                          <span className="opacity-60">{rssiBars(row.telemetry?.rssi ?? null)}</span>
                        </span>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {row.telemetry?.fw_version ?? '—'}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {row.error ? (
                          <span className="text-destructive">{row.error}</span>
                        ) : (
                          fmtRelative(row.telemetry?.timestamp ?? row.last_checked_at)
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => onSwitch(row.device)}
                          disabled={isActive}
                          data-testid={`fleet-open-${row.device.device_id}`}
                        >
                          {isActive ? 'Aktif' : (
                            <>
                              Buka <ArrowRight className="w-3 h-3 ml-1" />
                            </>
                          )}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {statuses.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-muted-foreground text-sm py-6">
                      Belum ada perangkat terdaftar. Tambahkan lewat menu Device Switcher.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
