'use client';

// =============================================================================
// BmsCommPanel — v1.6.0 multi-protocol BMS/inverter configuration.
// -----------------------------------------------------------------------------
// Writes the bms* fields of DeviceConfig via the authenticated /api/config
// mutation (transaction-journaled like every mutation). The firmware hot-applies
// the change (Comm::BatteryCommManager::reconfigure) — no reboot needed.
// Honesty rules:
//   - The panel only appears when the firmware exposes bmsProtocol (≥1.6.0);
//     on older firmware it shows a version note instead of dead inputs.
//   - Validation mirrors the firmware ranges exactly (rejected client-side
//     before the request — same messages as the server).
// =============================================================================

import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { Cable, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useConfig } from '@/hooks/useApi';
import { api } from '@/lib/api';
import { deviceConfigOf } from '@/lib/config-shape';
import { useLanguage } from '@/components/providers/language-provider';

type ProtocolChoice = 'auto' | 'none' | 'pylontech_can' | 'modbus_rtu' | 'modbus_tcp';

export function BmsCommPanel() {
  const { t } = useLanguage();
  const { data } = useConfig();
  // Dual-shape /api/config (firmware-flat vs demo-nested) — see
  // src/lib/config-shape.ts. Fixes: panel BMS tak pernah aktif di mode demo.
  const config = deviceConfigOf(data);

  const supported = config.bmsProtocol !== undefined;
  const [protocol, setProtocol] = useState<ProtocolChoice>('auto');
  const [pollMs, setPollMs] = useState('5000');
  const [slaveId, setSlaveId] = useState('1');
  const [tcpHost, setTcpHost] = useState('');
  const [tcpPort, setTcpPort] = useState('502');
  const [saving, setSaving] = useState(false);

  // [react-hooks/set-state-in-effect] Pre-fill form memakai pola resmi
  // "adjust state when a prop changes" (setState saat render). Di-key
  // pada tuple field bms* — identik dengan deps effect lama: form hanya
  // resync ketika field bms* perangkat benar-benar berubah, bukan saat
  // config di-refetch (edit user yang sedang berjalan tak terclobber).
  const bmsKey = `${config.bmsProtocol}|${config.bmsPollIntervalMs}|${config.bmsModbusSlaveId}|${config.bmsModbusTcpHost}|${config.bmsModbusTcpPort}`;
  const [syncedKey, setSyncedKey] = useState('');
  if (config.bmsProtocol !== undefined && bmsKey !== syncedKey) {
    setSyncedKey(bmsKey);
    setProtocol(config.bmsProtocol as ProtocolChoice);
    setPollMs(String(config.bmsPollIntervalMs ?? 5000));
    setSlaveId(String(config.bmsModbusSlaveId ?? 1));
    setTcpHost(config.bmsModbusTcpHost ?? '');
    setTcpPort(String(config.bmsModbusTcpPort ?? 502));
  }

  const handleSave = useCallback(async () => {
    const poll = Number(pollMs);
    const slave = Number(slaveId);
    const port = Number(tcpPort);
    if (!Number.isFinite(poll) || poll < 1000 || poll > 600000) {
      toast.error('bmsPollIntervalMs harus 1000..600000');
      return;
    }
    if (!Number.isFinite(slave) || slave < 1 || slave > 247) {
      toast.error('Slave ID harus 1..247');
      return;
    }
    if (!Number.isFinite(port) || port < 1 || port > 65535) {
      toast.error('Port harus 1..65535');
      return;
    }
    setSaving(true);
    try {
      await api.updateConfig({
        bmsProtocol: protocol,
        bmsPollIntervalMs: poll,
        bmsModbusSlaveId: slave,
        bmsModbusTcpHost: tcpHost.trim(),
        bmsModbusTcpPort: port,
      }); // Partial<DeviceConfig> — semua field bms* terdefinisi di DeviceConfig
      toast.success(t('settings.bms.saved'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [pollMs, slaveId, tcpPort, tcpHost, protocol, t]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Cable className="w-4 h-4 text-primary" />
          {t('settings.bms.title')}
        </CardTitle>
        <CardDescription>{t('settings.bms.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!supported ? (
          <p className="text-sm text-muted-foreground">
            Firmware &lt; 1.6.0 — perangkat ini belum mendukung port komunikasi
            BMS/inverter. Perbarui firmware untuk mengaktifkan.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="bms-protocol">{t('settings.bms.protocol')}</Label>
                <Select value={protocol} onValueChange={(v) => setProtocol(v as ProtocolChoice)}>
                  <SelectTrigger id="bms-protocol">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">{t('settings.bms.protocol_auto')}</SelectItem>
                    <SelectItem value="none">{t('settings.bms.protocol_none')}</SelectItem>
                    <SelectItem value="pylontech_can">{t('settings.bms.protocol_pylontech_can')}</SelectItem>
                    <SelectItem value="modbus_rtu">{t('settings.bms.protocol_modbus_rtu')}</SelectItem>
                    <SelectItem value="modbus_tcp">{t('settings.bms.protocol_modbus_tcp')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bms-poll">{t('settings.bms.poll_interval')}</Label>
                <Input
                  id="bms-poll"
                  type="number"
                  min={1000}
                  max={600000}
                  step={500}
                  value={pollMs}
                  onChange={(e) => setPollMs(e.target.value)}
                />
              </div>
              {(protocol === 'modbus_rtu' || protocol === 'modbus_tcp' || protocol === 'auto') && (
                <div className="space-y-1.5">
                  <Label htmlFor="bms-slave">{t('settings.bms.slave_id')}</Label>
                  <Input
                    id="bms-slave"
                    type="number"
                    min={1}
                    max={247}
                    value={slaveId}
                    onChange={(e) => setSlaveId(e.target.value)}
                  />
                </div>
              )}
              {(protocol === 'modbus_tcp' || protocol === 'auto') && (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="bms-host">{t('settings.bms.tcp_host')}</Label>
                    <Input
                      id="bms-host"
                      placeholder="192.168.1.50"
                      value={tcpHost}
                      onChange={(e) => setTcpHost(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="bms-port">{t('settings.bms.tcp_port')}</Label>
                    <Input
                      id="bms-port"
                      type="number"
                      min={1}
                      max={65535}
                      value={tcpPort}
                      onChange={(e) => setTcpPort(e.target.value)}
                    />
                  </div>
                </>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{t('settings.bms.provenance_note')}</p>
            <Button onClick={handleSave} disabled={saving}>
              <Save className="w-4 h-4 mr-2" />
              {t('settings.bms.save')}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
