'use client';

import { useAuth } from '@/components/providers/auth-provider';
import { useUiStore } from '@/lib/store';
import { LoginForm } from '@/components/auth/login-form';
import { AppShell } from '@/components/layout/app-shell';
import { DashboardView } from '@/components/dashboard/dashboard-view';
import { FleetView } from '@/components/fleet/fleet-view';
import { BatteryView } from '@/components/battery/battery-view';
import { AcOutputView } from '@/components/ac/ac-output-view';
import { EnvironmentView } from '@/components/environment/environment-view';
import { EnergyAnalyticsView } from '@/components/energy/energy-analytics-view';
import { CalibrationCenter } from '@/components/calibration/calibration-center';
import { ConfigurationCenter } from '@/components/config/configuration-center';
import { AlarmCenter } from '@/components/alarms/alarm-center';
import { DiagnosticsView } from '@/components/diagnostics/diagnostics-view';
import { SensorHealthView } from '@/components/sensors/sensor-health-view';
import { EventLogView } from '@/components/events/event-log-view';
import { ReportsView } from '@/components/reports/reports-view';
import { AiView } from '@/components/ai/ai-view';
import { SettingsView } from '@/components/settings/settings-view';
import { OtaView } from '@/components/ota/ota-view';
import { EmergencyControlView } from '@/components/emergency/emergency-control-view';
import { Loader2 } from 'lucide-react';

export default function Home() {
  const { session, loading } = useAuth();
  const { currentView } = useUiStore();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!session.isAuthenticated) {
    return <LoginForm />;
  }

  return (
    <AppShell>
      {currentView === 'dashboard' && <DashboardView />}
      {currentView === 'fleet' && <FleetView />}
      {currentView === 'battery' && <BatteryView />}
      {currentView === 'ac' && <AcOutputView />}
      {currentView === 'environment' && <EnvironmentView />}
      {currentView === 'energy' && <EnergyAnalyticsView />}
      {currentView === 'calibration' && <CalibrationCenter />}
      {currentView === 'config' && <ConfigurationCenter />}
      {currentView === 'alarms' && <AlarmCenter />}
      {currentView === 'diagnostics' && <DiagnosticsView />}
      {currentView === 'sensors' && <SensorHealthView />}
      {currentView === 'events' && <EventLogView />}
      {currentView === 'reports' && <ReportsView />}
      {currentView === 'ai' && <AiView />}
      {currentView === 'settings' && <SettingsView />}
      {currentView === 'ota' && <OtaView />}
      {currentView === 'emergency' && <EmergencyControlView />}
    </AppShell>
  );
}
