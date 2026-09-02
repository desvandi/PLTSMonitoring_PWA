'use client';
import { useDiagnostics } from '@/hooks/useApi';
import { Card } from '@/components/ui/card';

export function DiagnosticsView() {
  const { data, isLoading } = useDiagnostics();
  const diag = data; // request<Diagnostics> already unwraps

  if (isLoading) return <div className="p-4">Loading diagnostics...</div>;

  const items = [
    { label: 'Uptime', value: diag?.uptimeSeconds ? `${Math.floor(diag.uptimeSeconds / 3600)}h ${Math.floor((diag.uptimeSeconds % 3600) / 60)}m` : '--' },
    { label: 'Free Heap', value: diag?.freeHeap ? `${(diag.freeHeap / 1024).toFixed(1)} KB` : '--' },
    { label: 'Min Free Heap', value: diag?.minFreeHeap ? `${(diag.minFreeHeap / 1024).toFixed(1)} KB` : '--' },
    { label: 'WiFi RSSI', value: diag?.wifiRssi ? `${diag.wifiRssi} dBm` : '--' },
    { label: 'WiFi Reconnects', value: diag?.wifiReconnectCount ?? '--' },
    { label: 'MQTT Connected', value: diag?.mqttConnected ? 'YES' : 'NO' },
    { label: 'NTP Synced', value: diag?.ntpSynced ? 'YES' : 'NO' },
    { label: 'Storage OK', value: diag?.filesystemOk ? 'YES' : 'NO' },
    { label: 'Boot Count', value: diag?.bootCount ?? '--' },
    { label: 'Firmware', value: diag?.firmwareVersion ?? '--' },
    { label: 'Protocol', value: diag?.protocolVersion ?? '--' },
    { label: 'Spool Size', value: diag?.spoolSize ?? '--' },
  ];

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-2xl font-bold">Diagnostics</h2>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {items.map((item, i) => (
          <Card key={i} className="p-3">
            <div className="text-xs text-muted-foreground uppercase">{item.label}</div>
            <div className="text-lg font-mono font-semibold">{item.value}</div>
          </Card>
        ))}
      </div>
    </div>
  );
}
