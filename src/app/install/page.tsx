'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Cpu, ExternalLink, Info } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

/**
 * ESP Web Tools flashing landing page — §4.5 of technical brief.
 * Presents the ESP Web Tools <esp-web-install-button> web component and
 * points it at /firmware/manifest.json shipped in /public.
 * The firmware version badge is read live from that manifest so it can never
 * drift from the actually-shipped binary (audit 2026-08-27, finding F-B4).
 *
 * [W11-2 REMEDIATION 2026-09] The web component is now SELF-HOSTED from
 * /vendor/esp-web-tools/10.4.0/ (verbatim dist/web of the npm tarball —
 * provenance + sha256 in PROVENANCE.md). It was previously loaded from
 * unpkg.com with a floating major (@10), no SRI, and dynamic imports that
 * fell back to the CDN — a supply-chain hole one WebSerial permission away
 * from flashing arbitrary firmware. Loading first-party bytes keeps the
 * whole import chain under CSP script-src 'self'.
 */
export default function InstallPage() {
  const buttonHostRef = useRef<HTMLDivElement | null>(null);
  const [fwVersion, setFwVersion] = useState<string | null>(null);

  useEffect(() => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-plts-esp-web-tools]');
    if (existing) return;
    const script = document.createElement('script');
    script.type = 'module';
    // Pinned, self-hosted, integrity-guaranteed by same-origin + CSP 'self'.
    // Upgrade = new versioned directory + update this path (see PROVENANCE.md).
    script.src = '/vendor/esp-web-tools/10.4.0/install-button.js';
    script.setAttribute('data-plts-esp-web-tools', 'true');
    document.head.appendChild(script);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch('/firmware/manifest.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('manifest fetch failed'))))
      .then((m: { version?: string }) => {
        if (!cancelled && typeof m.version === 'string' && m.version) setFwVersion(m.version);
      })
      .catch(() => {
        /* Fail-closed label: tanpa manifest kita TIDAK menebak versi. */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground py-8 px-4">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <Link
            href="/"
            className="text-sm text-muted-foreground inline-flex items-center gap-1 hover:text-foreground"
            data-testid="install-back-link"
          >
            <ArrowLeft className="w-4 h-4" /> Kembali
          </Link>
          <span className="text-xs text-muted-foreground" data-testid="install-fw-version">
            {fwVersion ? `Firmware v${fwVersion}` : 'Firmware — versi tidak diketahui'}
          </span>
        </div>

        <header className="space-y-2">
          <div className="flex items-center gap-2 text-primary">
            <Cpu className="w-6 h-6" />
            <h1 className="text-2xl font-semibold tracking-tight" data-testid="install-title">
              Flash Firmware ESP32 dari Browser
            </h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Hubungkan ESP32 melalui kabel USB, lalu klik tombol di bawah. ESP Web Tools akan meng-*flash* firmware
            generic — Anda cukup selesaikan setup WiFi &amp; GAS URL lewat Captive Portal setelah reboot.
          </p>
        </header>

        <Alert>
          <Info className="w-4 h-4" />
          <AlertTitle>Prasyarat Browser</AlertTitle>
          <AlertDescription>
            Gunakan browser Chrome, Edge, atau Opera terbaru di komputer (Web Serial API belum didukung di iOS/Android).
          </AlertDescription>
        </Alert>

        <Card>
          <CardHeader>
            <CardTitle>Langkah Flashing</CardTitle>
            <CardDescription>Estimasi 60–90 detik untuk board ESP32 4MB.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <ol className="list-decimal list-inside space-y-1.5 text-muted-foreground">
              <li>Hubungkan ESP32 via kabel USB (kabel data, bukan kabel charging).</li>
              <li>Tekan tombol <span className="font-medium text-foreground">Install PLTS Firmware</span> di bawah.</li>
              <li>Pilih port serial ESP32 (biasanya <code>CP210x</code> atau <code>CH340</code>).</li>
              <li>Tunggu hingga proses flashing 100% dan modul reboot otomatis.</li>
              <li>ESP32 memancarkan WiFi <code>PLTS-Monitor-Setup-XXXX</code>. Sambungkan HP/laptop untuk konfigurasi.</li>
            </ol>

            <div ref={buttonHostRef} className="pt-2 flex flex-col items-center gap-3">
              {/* Custom element registered by esp-web-tools script above. */}
              <esp-web-install-button manifest="/firmware/manifest.json" data-testid="install-button">
                <Button size="lg" slot="activate">
                  <Cpu className="w-4 h-4 mr-2" /> Install PLTS Firmware
                </Button>
                <span slot="unsupported">
                  Browser tidak mendukung Web Serial. Gunakan Chrome/Edge desktop.
                </span>
                <span slot="not-allowed">
                  Halaman ini harus dimuat via HTTPS untuk mengakses Web Serial.
                </span>
              </esp-web-install-button>

              <Button asChild variant="link" size="sm">
                <a
                  href="/firmware/manifest.json"
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs"
                  data-testid="install-manifest-link"
                >
                  Lihat manifest.json <ExternalLink className="w-3 h-3 ml-1 inline" />
                </a>
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Setelah Flashing</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <p>
              1. Sambungkan HP ke SSID <span className="font-mono text-foreground">PLTS-Monitor-Setup-XXXX</span>.
            </p>
            <p>2. Browser otomatis membuka Captive Portal di <code>192.168.4.1</code>.</p>
            <p>3. Masukkan kredensial WiFi + GAS Web App URL + Auth Token yang sama seperti di PWA.</p>
            <p>4. ESP32 reboot dan mulai mengirim telemetri ke Google Sheet Anda.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
