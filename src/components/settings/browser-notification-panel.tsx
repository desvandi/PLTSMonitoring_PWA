'use client';

import { Bell, BellOff, ShieldAlert } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useNotificationToggle } from '@/hooks/useLowBatteryNotifier';

/**
 * Settings card that lets the operator subscribe to browser notifications for
 * low-battery alerts across every registered device.
 */
export function BrowserNotificationPanel() {
  const { state, enabled, toggle } = useNotificationToggle();
  const unsupported = state === 'unsupported';
  const denied = state === 'denied';

  return (
    <Card data-testid="browser-notify-panel">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {enabled ? <Bell className="w-4 h-4 text-emerald-500" /> : <BellOff className="w-4 h-4" />}
          Browser Push Notifications
        </CardTitle>
        <CardDescription>
          Kirim alert baterai kritis (di bawah cutoff) langsung ke sistem notifikasi
          browser Anda — bekerja meski tab PWA di-minimize. Cooldown 30 menit per
          perangkat agar tidak spam.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {unsupported && (
          <Alert variant="destructive">
            <ShieldAlert className="w-4 h-4" />
            <AlertTitle>Tidak Didukung</AlertTitle>
            <AlertDescription>
              Browser Anda tidak mendukung <code>Notification API</code>. Gunakan Chrome,
              Edge, Firefox, atau Safari terbaru.
            </AlertDescription>
          </Alert>
        )}
        {denied && (
          <Alert>
            <ShieldAlert className="w-4 h-4" />
            <AlertTitle>Izin Ditolak</AlertTitle>
            <AlertDescription>
              Izin notifikasi ditolak. Buka pengaturan situs pada browser Anda
              lalu ubah izin Notifications menjadi <em>Allow</em>.
            </AlertDescription>
          </Alert>
        )}

        <div className="flex items-center justify-between rounded-md border border-border p-3">
          <div className="min-w-0">
            <Label htmlFor="notify-toggle" className="cursor-pointer">
              Aktifkan alert low-battery
            </Label>
            <p className="text-xs text-muted-foreground">
              Menggunakan threshold <code>low_battery_warning_threshold</code> pada dashboard settings.
            </p>
          </div>
          <Switch
            id="notify-toggle"
            checked={enabled}
            onCheckedChange={(v) => void toggle(v)}
            disabled={unsupported}
            data-testid="notify-toggle"
          />
        </div>
      </CardContent>
    </Card>
  );
}
