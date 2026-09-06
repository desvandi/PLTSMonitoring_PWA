'use client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Settings2, ArrowRight } from 'lucide-react';
import { useUiStore } from '@/lib/store';
import { SystemConfigPanel } from '@/components/settings/system-config-panel';
import { DeviceQrPanel } from '@/components/settings/device-qr-panel';
import { OtaSigningPanel } from '@/components/settings/ota-signing-panel';
import { BrowserNotificationPanel } from '@/components/settings/browser-notification-panel';
import { PushAlarmPanel } from '@/components/settings/push-alarm-panel';
import { CalibrationWizard } from '@/components/settings/calibration-wizard';
import { BmsCommPanel } from '@/components/settings/bms-comm-panel';

// [PARITY-3 2026-09-06] The old "Device Configuration" card was a DEAD FORM:
// six uncontrolled defaultValue inputs + a Save button with no onClick —
// every edit silently went nowhere. The real editor is the Configuration
// view (ConfigurationCenter, wired to POST /api/config + /api/config/device
// with CSRF/requestId/validation). The dead form is replaced with an honest
// pointer card; no pretend-editable inputs remain.
export function SettingsView() {
  const setView = useUiStore((s) => s.setView);
  return (
    <div className="p-4 space-y-4">
      <h2 className="text-2xl font-bold">Settings</h2>
      <Card className="p-4 space-y-3" data-testid="settings-device-config-pointer">
        <div className="flex items-center gap-2">
          <Settings2 className="w-4 h-4 text-primary" />
          <h3 className="font-semibold">Device Configuration</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          Device configuration (name, site, timezone, battery limits, BMS comm,
          export/import) is edited in the <b>Configuration</b> view — with
          validation, CSRF protection and idempotent requestId semantics.
          This card previously showed an uneditable copy; it now says so.
        </p>
        <Button
          size="sm"
          variant="outline"
          data-testid="settings-goto-config"
          onClick={() => setView('config')}
        >
          Buka Configuration <ArrowRight className="w-3.5 h-3.5 ml-1" />
        </Button>
      </Card>
      <SystemConfigPanel />
      <BmsCommPanel />
      <CalibrationWizard />
      <BrowserNotificationPanel />
      <PushAlarmPanel />
      <DeviceQrPanel />
      <OtaSigningPanel />
    </div>
  );
}
