'use client';

import { ReactNode, useState, useEffect } from 'react';
import { useUiStore, type ViewKey } from '@/lib/store';
import { useLanguage } from '@/components/providers/language-provider';
import { useAuth } from '@/components/providers/auth-provider';
import { useMqtt } from '@/components/providers/mqtt-provider';
import { useVersion, useStatus } from '@/hooks/useApi';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard,
  Battery,
  Zap,
  Thermometer,
  BarChart3,
  Gauge,
  Settings,
  AlertTriangle,
  Activity,
  Cpu,
  Radio,
  ScrollText,
  FileBarChart,
  Sparkles,
  Download,
  LogOut,
  Menu,
  Wifi,
  WifiOff,
  Sun,
  Server,
  Cloud,
  ShieldAlert,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { LanguageSwitcher } from '@/components/layout/language-switcher';
import { GasHealthIndicator } from '@/components/layout/gas-health-indicator';
import { DeviceSwitcher } from '@/components/layout/device-switcher';
import { useLowBatteryNotifier } from '@/hooks/useLowBatteryNotifier';
import { CompatibilityBanner } from '@/components/compatibility-banner';
import { formatTime, formatUptime, formatRssi } from '@/lib/format';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';

type NavItem = {
  key: ViewKey;
  icon: React.ComponentType<{ className?: string }>;
};

const NAV_ITEMS: NavItem[] = [
  { key: 'dashboard', icon: LayoutDashboard },
  { key: 'fleet', icon: Server },
  { key: 'emergency', icon: ShieldAlert },
  { key: 'battery', icon: Battery },
  { key: 'ac', icon: Zap },
  { key: 'environment', icon: Thermometer },
  { key: 'energy', icon: BarChart3 },
  { key: 'calibration', icon: Gauge },
  { key: 'config', icon: Settings },
  { key: 'alarms', icon: AlertTriangle },
  { key: 'diagnostics', icon: Activity },
  { key: 'sensors', icon: Cpu },
  { key: 'events', icon: ScrollText },
  { key: 'reports', icon: FileBarChart },
  { key: 'ai', icon: Sparkles },
  { key: 'settings', icon: Settings },
  { key: 'ota', icon: Download },
];

// Mobile bottom-nav subset (top 5 most used)
const MOBILE_NAV: ViewKey[] = ['dashboard', 'battery', 'alarms', 'energy', 'settings'];

// [PWA-02 REMEDIATION 2026-08] Operator-only views — mutating surfaces gated
// by session role. A viewer-scoped MQTT session (broker subscription proves
// READ identity only) cannot open config/calibration/OTA/settings.
const OPERATOR_ONLY_VIEWS: ViewKey[] = ['calibration', 'config', 'ota', 'settings'];

export function AppShell({ children }: { children: ReactNode }) {
  const { currentView, setView } = useUiStore();
  const { t, lang } = useLanguage();
  const { logout, session } = useAuth();
  const { data: version } = useVersion();
  const { data: status } = useStatus();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  useLowBatteryNotifier();

  useEffect(() => {
    const id = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const onNavClick = (v: ViewKey) => {
    setView(v);
    setMobileNavOpen(false);
  };

  const rssiInfo = status ? formatRssi(status.health.wifiRssi) : null;
  const hasRestApi = Boolean(process.env.NEXT_PUBLIC_API_BASE_URL);
  const { connected: mqttConnected } = useMqtt();
  const { isMqttMode, isGasMode } = useAuth();
  // [AUDIT 2026-08-28 F9] Mode badge must NEVER lie: a GAS-cloud deployment
  // (no REST base URL, no broker) is GAS mode — not "mock". Mock/demo only
  // applies when neither a real backend NOR a GAS profile exists.
  const isMock = !hasRestApi && !isMqttMode && !isGasMode;
  // [PWA-02] Role gate: viewer sessions cannot reach mutating views.
  const isViewer = session.role === 'viewer';
  const canOpenView = (v: ViewKey) =>
    !isViewer || !OPERATOR_ONLY_VIEWS.includes(v);

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="sticky top-0 z-40 h-14 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="h-full flex items-center px-3 sm:px-4 gap-2">
          <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden" aria-label="Menu">
                <Menu className="w-5 h-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 p-0 overflow-y-auto">
              <SheetHeader className="px-4 py-3 border-b">
                <SheetTitle className="flex items-center gap-2">
                  <Sun className="w-5 h-5 text-primary" />
                  {t('app.name')}
                </SheetTitle>
              </SheetHeader>
              <nav className="p-2 space-y-1">
                {NAV_ITEMS.map((item) => {
                  const Icon = item.icon;
                  const active = currentView === item.key;
                  return (
                    <button
                      key={item.key}
                      onClick={() => canOpenView(item.key) && onNavClick(item.key)}
                      disabled={!canOpenView(item.key)}
                      title={!canOpenView(item.key) ? 'Viewer scope — operator login required' : undefined}
                      data-testid={`nav-${item.key}`}
                      className={cn(
                        'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                        active
                          ? 'bg-primary/10 text-primary'
                          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                      )}
                    >
                      <Icon className="w-4 h-4" />
                      {t(`nav.${item.key}` as const)}
                    </button>
                  );
                })}
              </nav>
              <div className="absolute bottom-0 left-0 right-0 p-4 border-t">
                <Button
                  variant="ghost"
                  className="w-full justify-start text-muted-foreground"
                  onClick={logout}
                >
                  <LogOut className="w-4 h-4 mr-2" />
                  Logout
                </Button>
              </div>
            </SheetContent>
          </Sheet>

          <div className="md:hidden flex items-center gap-2">
            <div className="w-7 h-7 rounded-md bg-primary/10 border border-primary/20 flex items-center justify-center">
              <Sun className="w-4 h-4 text-primary" />
            </div>
          </div>

          <div className="hidden md:flex items-center gap-2 mr-4">
            <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
              <Sun className="w-4 h-4 text-primary" />
            </div>
            <div className="flex flex-col leading-tight">
              <span className="text-sm font-semibold">
                {status?.deviceName ?? t('app.name')}
              </span>
              <span className="text-[10px] text-muted-foreground">
                {version ? `v${version.currentVersion}` : 'v1.0'}
                {isMqttMode && <span className="ml-1 text-status-on">· mqtt</span>}
                {!isMqttMode && hasRestApi && <span className="ml-1 text-status-info">· live</span>}
                {isMock && <span className="ml-1 text-amber-500">· mock</span>}
              </span>
            </div>
          </div>

          <div className="hidden lg:flex items-center gap-3 ml-2">
            <div className="flex items-center gap-1.5 text-xs">
              {status?.online ? (
                <Wifi className="w-3.5 h-3.5 text-status-on" />
              ) : (
                <WifiOff className="w-3.5 h-3.5 text-status-error" />
              )}
              <span className="text-muted-foreground">{rssiInfo ? `${rssiInfo.bars}/4` : '--'}</span>
            </div>
            <div className="text-xs text-muted-foreground">
              <span className="font-mono">{formatTime(clock, status?.config.timezone, lang)}</span>
            </div>
            {status && (
              <div className="text-xs text-muted-foreground">
                <span className="font-mono">↑ {formatUptime(status.uptimeSeconds, lang)}</span>
              </div>
            )}
          </div>

          <div className="flex-1" />

          <div className="flex items-center gap-1">
            <div className="hidden md:flex items-center gap-2 mr-1">
              <DeviceSwitcher />
              <GasHealthIndicator />
            </div>
            <div className="md:hidden">
              <GasHealthIndicator />
            </div>
            {isMqttMode ? (
              <Badge
                variant="outline"
                className="hidden sm:inline-flex text-xs font-normal text-status-on border-status-on/30"
              >
                <Radio className="w-3 h-3 mr-1" />
                MQTT {mqttConnected ? 'Connected' : 'Disconnected'}
              </Badge>
            ) : isGasMode ? (
              <Badge
                variant="outline"
                className="hidden sm:inline-flex text-xs font-normal text-status-info border-status-info/30"
                data-testid="mode-badge-gas"
              >
                <Cloud className="w-3 h-3 mr-1" />
                GAS Cloud · Viewer
              </Badge>
            ) : (
              <Badge variant="outline" className="hidden sm:inline-flex text-xs font-normal">
                {isMock ? t('common.mock_mode') : t('common.live_mode')}
              </Badge>
            )}
            <LanguageSwitcher />
            <ThemeToggle />
            <Button
              variant="ghost"
              size="icon"
              onClick={logout}
              aria-label="Logout"
              title="Logout"
            >
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </header>

      <CompatibilityBanner />

      <div className="flex-1 flex">
        <aside className="hidden md:flex w-56 flex-col border-r border-border bg-sidebar/30">
          <nav className="flex-1 p-3 space-y-1 overflow-y-auto max-h-[calc(100vh-3.5rem-7rem)]">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = currentView === item.key;
              return (
                <button
                  key={item.key}
                  onClick={() => onNavClick(item.key)}
                  data-testid={`nav-desktop-${item.key}`}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                    active
                      ? 'bg-primary/10 text-primary border border-primary/20'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground border border-transparent',
                  )}
                >
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  {t(`nav.${item.key}` as const)}
                </button>
              );
            })}
          </nav>

          <div className="p-3 border-t border-border space-y-1.5 text-xs text-muted-foreground">
            <div className="flex items-center justify-between">
              <span>Firmware</span>
              <span className="font-mono">v{version?.currentVersion ?? '—'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Heap</span>
              <span className="font-mono">
                {status ? `${Math.round(status.health.freeHeap / 1024)} KB` : '—'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>Protocol</span>
              <span className="font-mono">v{status?.protocolVersion ?? '—'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>User</span>
              <span className="font-mono truncate max-w-24">{session.username ?? '—'}</span>
            </div>
          </div>
        </aside>

        <main className="flex-1 min-w-0 overflow-x-hidden pb-16 md:pb-0">
          <div className="p-4 sm:p-6 max-w-7xl mx-auto">{children}</div>
        </main>
      </div>

      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 h-14 border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="grid grid-cols-5 h-full">
          {MOBILE_NAV.map((key) => {
            const item = NAV_ITEMS.find((n) => n.key === key);
            if (!item) return null;
            const Icon = item.icon;
            const active = currentView === key;
            return (
              <button
                key={key}
                onClick={() => canOpenView(key) && onNavClick(key)}
                disabled={!canOpenView(key)}
                className={cn(
                  'flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors',
                  active ? 'text-primary' : 'text-muted-foreground',
                  !canOpenView(key) && 'opacity-40',
                )}
              >
                <Icon className={cn('w-5 h-5', active && 'scale-110')} />
                {t(`nav.${key}` as const)}
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
