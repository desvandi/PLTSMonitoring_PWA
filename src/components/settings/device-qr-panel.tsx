'use client';

import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { QrCode, Download, Wifi, Info } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useSysConfig } from '@/components/providers/sys-config-provider';

/**
 * Encodes ESP32 Captive Portal onboarding payload as base64 JSON, then embeds
 * it into a URL fragment (`http://192.168.4.1/#plts=<base64>`). When the user
 * scans the QR while their phone is connected to the ESP32 AP, the Captive
 * Portal decodes the fragment and prefills the setup form.
 */
function encodeOnboardingUrl(payload: object): string {
  const json = JSON.stringify(payload);
  const b64 = typeof window === 'undefined'
    ? Buffer.from(json).toString('base64')
    : window.btoa(unescape(encodeURIComponent(json)));
  return `http://192.168.4.1/#plts=${b64}`;
}

/** WiFi network QR string per ZXing spec — universally supported by phone cameras. */
function buildWifiQr(ssid: string, password: string, hidden = false): string {
  const escape = (s: string) => s.replace(/([\\;,":])/g, '\\$1');
  return `WIFI:T:WPA;S:${escape(ssid)};P:${escape(password)};H:${hidden ? 'true' : 'false'};;`;
}

export function DeviceQrPanel() {
  const { config } = useSysConfig();

  const [wifiSsid, setWifiSsid] = useState('');
  const [wifiPass, setWifiPass] = useState('');
  const [interval, setInterval] = useState(15);
  const [vCalib, setVCalib] = useState(11);
  const [iCalibDc, setICalibDc] = useState(1);
  const [iCalibAc, setICalibAc] = useState(1);

  const [wifiDataUrl, setWifiDataUrl] = useState<string | null>(null);
  const [onboardDataUrl, setOnboardDataUrl] = useState<string | null>(null);

  const onboardingUrl = useMemo(() => {
    if (!config) return null;
    return encodeOnboardingUrl({
      ssid: wifiSsid,
      password: wifiPass,
      gas_url: config.gas_webapp_url,
      auth_token: config.auth_token,
      device_key: config.device_id,
      telemetry_interval_sec: interval,
      v_calib: vCalib,
      i_calib_dc: iCalibDc,
      i_calib_ac: iCalibAc,
    });
  }, [config, wifiSsid, wifiPass, interval, vCalib, iCalibDc, iCalibAc]);

  useEffect(() => {
    let cancelled = false;
    async function render() {
      if (!config) return;
      if (wifiSsid) {
        const wifi = await QRCode.toDataURL(buildWifiQr(wifiSsid, wifiPass), {
          width: 256,
          margin: 1,
          errorCorrectionLevel: 'M',
          color: { dark: '#0b1220', light: '#ffffff' },
        });
        if (!cancelled) setWifiDataUrl(wifi);
      } else if (!cancelled) {
        setWifiDataUrl(null);
      }
      if (onboardingUrl) {
        const onboard = await QRCode.toDataURL(onboardingUrl, {
          width: 288,
          margin: 1,
          errorCorrectionLevel: 'M',
          color: { dark: '#0b1220', light: '#ffffff' },
        });
        if (!cancelled) setOnboardDataUrl(onboard);
      }
    }
    void render();
    return () => {
      cancelled = true;
    };
  }, [config, wifiSsid, wifiPass, onboardingUrl]);

  if (!config) return null;

  const download = (dataUrl: string, name: string) => {
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success(`QR disimpan sebagai ${name}`);
  };

  return (
    <Card data-testid="device-qr-panel">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <QrCode className="w-4 h-4" /> QR Onboarding ESP32
        </CardTitle>
        <CardDescription>
          Cetak/tampilkan QR ini di lapangan. Setelah menyalakan ESP32 baru dan
          terhubung ke AP <span className="font-mono">PLTS-Monitor-Setup-XXXX</span>, kamera
          ponsel akan langsung mengisi form Captive Portal.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <Info className="w-4 h-4" />
          <AlertTitle>Aktif untuk device {config.device_id}</AlertTitle>
          <AlertDescription>
            Kredensial GAS diambil dari perangkat aktif; isi SSID/Password WiFi lokasi ESP32.
          </AlertDescription>
        </Alert>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="qr-ssid">SSID WiFi Site</Label>
            <Input
              id="qr-ssid"
              placeholder="PLTS_Basecamp_Tebo"
              value={wifiSsid}
              onChange={(e) => setWifiSsid(e.target.value)}
              data-testid="qr-input-ssid"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="qr-pass">Password WiFi</Label>
            <Input
              id="qr-pass"
              type="password"
              placeholder="••••••••"
              value={wifiPass}
              onChange={(e) => setWifiPass(e.target.value)}
              data-testid="qr-input-pass"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="qr-interval">Interval Telemetri (detik)</Label>
            <Input
              id="qr-interval"
              type="number"
              min={5}
              max={300}
              value={interval}
              onChange={(e) => setInterval(Number(e.target.value) || 15)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="qr-vcalib">V Calib</Label>
            <Input
              id="qr-vcalib"
              type="number"
              step={0.01}
              value={vCalib}
              onChange={(e) => setVCalib(Number(e.target.value) || 11)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="qr-icalib-dc">I Calib DC (INA219)</Label>
            <Input
              id="qr-icalib-dc"
              data-testid="qr-icalib-dc"
              type="number"
              step={0.01}
              value={iCalibDc}
              onChange={(e) => setICalibDc(Number(e.target.value) || 1)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="qr-icalib-ac">I Calib AC (ACS712)</Label>
            <Input
              id="qr-icalib-ac"
              data-testid="qr-icalib-ac"
              type="number"
              step={0.01}
              value={iCalibAc}
              onChange={(e) => setICalibAc(Number(e.target.value) || 1)}
            />
          </div>
        </div>

        <Tabs defaultValue="onboard" className="mt-2">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="onboard" data-testid="qr-tab-onboard">
              <QrCode className="w-3.5 h-3.5 mr-2" /> QR Onboarding
            </TabsTrigger>
            <TabsTrigger value="wifi" data-testid="qr-tab-wifi">
              <Wifi className="w-3.5 h-3.5 mr-2" /> QR WiFi (Auto-Join)
            </TabsTrigger>
          </TabsList>

          <TabsContent value="onboard" className="space-y-3 pt-3">
            <p className="text-xs text-muted-foreground">
              Cara pakai: (1) Colok ESP32 baru → (2) Ponsel gabung ke SSID
              <span className="font-mono"> PLTS-Monitor-Setup-XXXX </span>→ (3) Buka kamera dan
              arahkan ke QR — Captive Portal otomatis terbuka dengan form terisi.
            </p>
            <div className="flex flex-col items-center gap-3">
              {onboardDataUrl ? (
                <>
                  <img
                    src={onboardDataUrl}
                    alt="QR Onboarding ESP32"
                    width={288}
                    height={288}
                    className="rounded-md border border-border bg-white p-2"
                    data-testid="qr-onboard-image"
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => download(onboardDataUrl, `plts-onboard-${config.device_id}.png`)}
                    data-testid="qr-download-onboard"
                  >
                    <Download className="w-3.5 h-3.5 mr-2" /> Unduh QR Onboarding
                  </Button>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">Menyiapkan QR...</p>
              )}
            </div>
          </TabsContent>

          <TabsContent value="wifi" className="space-y-3 pt-3">
            <p className="text-xs text-muted-foreground">
              Format QR standar ZXing — kompatibel dengan iOS/Android untuk auto-join WiFi
              site (tanpa membuka Captive Portal). Isi SSID/Password terlebih dahulu.
            </p>
            <div className="flex flex-col items-center gap-3">
              {wifiDataUrl ? (
                <>
                  <img
                    src={wifiDataUrl}
                    alt="QR WiFi auto-join"
                    width={256}
                    height={256}
                    className="rounded-md border border-border bg-white p-2"
                    data-testid="qr-wifi-image"
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => download(wifiDataUrl, `plts-wifi-${wifiSsid}.png`)}
                    data-testid="qr-download-wifi"
                  >
                    <Download className="w-3.5 h-3.5 mr-2" /> Unduh QR WiFi
                  </Button>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">Isi SSID untuk memunculkan QR.</p>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
