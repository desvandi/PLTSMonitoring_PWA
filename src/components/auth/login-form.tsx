'use client';

import { useState } from 'react';
import { useAuth } from '@/components/providers/auth-provider';
import { useMqtt } from '@/components/providers/mqtt-provider';
import { useLanguage } from '@/components/providers/language-provider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Loader2,
  Lock,
  User,
  Sun,
  Wifi,
  ShieldCheck,
  Cpu,
  Radio,
  AlertCircle,
} from 'lucide-react';
import { LanguageSwitcher } from '@/components/layout/language-switcher';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { toast } from 'sonner';
import { API_BASE_URL } from '@/lib/api';

// LAN mode is available when:
//   (a) NEXT_PUBLIC_API_BASE_URL is set (PWA calls real ESP32 via Cloudflare Tunnel), OR
//   (b) NEXT_PUBLIC_DEMO_MODE === 'true' (mock API enabled)
const LAN_MODE_AVAILABLE =
  Boolean(API_BASE_URL) || process.env.NEXT_PUBLIC_DEMO_MODE === 'true';

export function LoginForm() {
  const { login } = useAuth();
  const { connect, disconnect, connected, deviceId } = useMqtt();
  const { t } = useLanguage();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [macInput, setMacInput] = useState('');
  const [mqttLoading, setMqttLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await login(username, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('login.error_invalid'));
    } finally {
      setLoading(false);
    }
  };

  const onMqttConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    const id = macInput.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
    if (!/^PLTS-[A-F0-9]{8}$/.test(id)) {
      toast.error('Device ID must be format PLTS-AB12CD34 (8 hex chars)');
      return;
    }
    setMqttLoading(true);
    try {
      await connect(id);
      toast.success('Connected to ESP32 via MQTT');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'MQTT connection failed');
    } finally {
      setMqttLoading(false);
    }
  };

  const onMqttDisconnect = () => {
    disconnect();
    setMacInput('');
    toast.info('Disconnected from MQTT');
  };

  return (
    <div className="min-h-screen flex flex-col bg-background bg-grid relative overflow-hidden">
      <div className="absolute top-4 right-4 flex items-center gap-2 z-10">
        <LanguageSwitcher />
        <ThemeToggle />
      </div>

      <div className="pointer-events-none absolute -top-32 -left-32 w-96 h-96 rounded-full bg-primary/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 -right-32 w-96 h-96 rounded-full bg-primary/5 blur-3xl" />

      <div className="flex-1 flex items-center justify-center p-4 relative z-1">
        <div className="w-full max-w-md space-y-6">
          <div className="text-center space-y-3">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 mb-2">
              <Sun className="w-8 h-8 text-primary" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">{t('app.name')}</h1>
            <p className="text-sm text-muted-foreground">{t('app.tagline')}</p>
          </div>

          <div className="flex flex-wrap justify-center gap-2 text-xs">
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-muted text-muted-foreground">
              <Cpu className="w-3 h-3" /> ESP32
            </span>
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-muted text-muted-foreground">
              <Wifi className="w-3 h-3" /> 48V LiFePO4
            </span>
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-muted text-muted-foreground">
              <ShieldCheck className="w-3 h-3" /> JWT + CSRF
            </span>
          </div>

          {LAN_MODE_AVAILABLE ? (
            <Card className="border-border/50 shadow-xl backdrop-blur-sm">
              <CardHeader className="space-y-1">
                <CardTitle className="text-xl">{t('login.title')}</CardTitle>
                <CardDescription>{t('login.subtitle')} — Local / LAN mode</CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={onSubmit} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="username">{t('login.username')}</Label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        id="username"
                        data-testid="login-username-input"
                        type="text"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        className="pl-9"
                        autoComplete="username"
                        required
                        disabled={loading}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="password">{t('login.password')}</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        id="password"
                        data-testid="login-password-input"
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="pl-9"
                        autoComplete="current-password"
                        required
                        disabled={loading}
                      />
                    </div>
                  </div>

                  {error && (
                    <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2">
                      {error}
                    </div>
                  )}

                  <Button type="submit" className="w-full" disabled={loading} data-testid="login-submit-button">
                    {loading ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        {t('common.loading')}
                      </>
                    ) : (
                      t('login.submit')
                    )}
                  </Button>

                  <p className="text-xs text-center text-muted-foreground">{t('login.demo_creds')}</p>
                </form>
              </CardContent>
            </Card>
          ) : (
            <Card className="border-border/50 shadow-xl backdrop-blur-sm">
              <CardHeader className="space-y-1">
                <CardTitle className="text-xl flex items-center gap-2">
                  <AlertCircle className="w-5 h-5 text-muted-foreground" />
                  Local / LAN mode disabled
                </CardTitle>
                <CardDescription>
                  This deployment is configured for MQTT remote mode only.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-muted-foreground">
                <p>
                  To view your ESP32 telemetry, use the <strong>Remote Mode (MQTT)</strong> card below —
                  enter the Device ID (e.g., PLTS-AB12CD34).
                </p>
                <p className="text-xs">To enable LAN mode instead, set one of these in your env vars:</p>
                <ul className="text-xs space-y-1 pl-4 list-disc">
                  <li>
                    <code className="font-mono bg-muted px-1 py-0.5 rounded">NEXT_PUBLIC_API_BASE_URL</code>
                    {' '}— point to your Cloudflare Tunnel URL (real ESP32 REST API)
                  </li>
                  <li>
                    <code className="font-mono bg-muted px-1 py-0.5 rounded">NEXT_PUBLIC_DEMO_MODE=true</code>
                    {' '}— enable mock API with demo credentials (admin/admin123)
                  </li>
                </ul>
              </CardContent>
            </Card>
          )}

          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-border" />
            <span className="text-xs text-muted-foreground uppercase tracking-wider">or</span>
            <div className="flex-1 h-px bg-border" />
          </div>

          <Card
            className={
              connected
                ? 'border-status-on/40 shadow-xl backdrop-blur-sm'
                : 'border-border/50 shadow-xl backdrop-blur-sm'
            }
          >
            <CardHeader className="space-y-1">
              <CardTitle className="text-xl flex items-center gap-2">
                <Radio
                  className={`w-5 h-5 ${connected ? 'text-status-on' : 'text-primary'}`}
                />
                Remote Mode (MQTT)
              </CardTitle>
              <CardDescription>
                {connected
                  ? `Connected to device ${deviceId} — telemetry from anywhere via internet`
                  : 'Monitor ESP32 telemetry from anywhere — no port forwarding needed (works behind MiFi/CGNAT)'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {connected ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 p-3 rounded-lg bg-status-on/10 border border-status-on/20">
                    <div className="status-dot status-dot-on animate-pulse" />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-status-on">MQTT Connected</p>
                      <p className="text-xs text-muted-foreground">Device: {deviceId}</p>
                    </div>
                  </div>
                  <Button onClick={onMqttDisconnect} variant="outline" className="w-full">
                    Disconnect
                  </Button>
                </div>
              ) : (
                <form onSubmit={onMqttConnect} className="space-y-3">
                  <div className="space-y-2">
                    <Label htmlFor="deviceId">ESP32 Device ID</Label>
                    <Input
                      id="deviceId"
                      type="text"
                      value={macInput}
                      onChange={(e) => setMacInput(e.target.value)}
                      placeholder="e.g., PLTS-AB12CD34"
                      className="font-mono uppercase"
                      required
                      disabled={mqttLoading}
                      maxLength={13}
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Found in Serial Monitor: <code className="font-mono">PLTS-XXXXXXXX</code>
                    </p>
                  </div>
                  <Button type="submit" className="w-full" disabled={mqttLoading}>
                    {mqttLoading ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Connecting...
                      </>
                    ) : (
                      <>
                        <Radio className="w-4 h-4 mr-2" />
                        Connect via MQTT
                      </>
                    )}
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>

          <p className="text-center text-xs text-muted-foreground">
            v1.0 · PWA · MQTT Remote · Monitoring-Only · {new Date().getFullYear()}
          </p>
        </div>
      </div>
    </div>
  );
}
