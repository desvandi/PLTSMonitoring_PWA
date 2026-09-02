import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
// [WAVE-7 / PW7-2] SerwistProvider mendaftarkan /sw.js (build @serwist/next).
// Tanpa komponen ini sw.js TIDAK PERNAH teregistrasi: tidak ada dukungan
// offline, dan navigator.serviceWorker.ready menggantung selamanya (mematikan
// notifikasi baterai rendah — lihat useLowBatteryNotifier).
import { SerwistProvider } from "@serwist/next/react";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { LanguageProvider } from "@/components/providers/language-provider";
import { QueryProvider } from "@/components/providers/query-provider";
import { AuthProvider } from "@/components/providers/auth-provider";
import { MqttProvider } from "@/components/providers/mqtt-provider";
import { SysConfigProvider } from "@/components/providers/sys-config-provider";
import { ConfigGuard } from "@/components/providers/config-guard";
import { SwLegacyCleanup } from "@/components/providers/sw-legacy-cleanup";
import { PushAlarmBridge } from "@/components/providers/push-alarm-bridge";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "PLTS Monitor — 48V LiFePO4 Solar Monitoring",
  description:
    "Progressive Web App for monitoring a 48V LiFePO4 PLTS (solar) system — INA219 battery current, ESP32 ADC voltage, ACS712 AC current, SHT31 ambient T/H. Monitoring-only: no relays, no actuators.",
  keywords: [
    "PLTS",
    "48V",
    "LiFePO4",
    "Solar",
    "Battery Monitor",
    "ESP32",
    "INA219",
    "ACS712",
    "SHT31",
    "PWA",
    "IoT",
  ],
  authors: [{ name: "PLTS Monitor" }],
  manifest: "/manifest.webmanifest",
  applicationName: "PLTS Monitor",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "PLTS Monitor",
  },
  icons: {
    icon: [
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16.png", sizes: "16x16", type: "image/png" },
      { url: "/icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  openGraph: {
    title: "PLTS Monitor — 48V LiFePO4 Solar Monitoring",
    description: "PWA for monitoring a 48V LiFePO4 PLTS system (monitoring-only)",
    type: "website",
  },
};

// CRITICAL FIX (vs reference): userScalable: true (WCAG 1.4.4 — allow zoom).
// Reference had userScalable: false which violates accessibility.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F8FAFC" },
    { media: "(prefers-color-scheme: dark)", color: "#0A0F1A" },
  ],
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id" suppressHydrationWarning>
      <head>
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <ThemeProvider>
          <LanguageProvider>
            <QueryProvider>
              {/* [AUDIT 2026-08-28 F9] SysConfigProvider must wrap AuthProvider —
                  the auth layer now reads PLTS_SYS_CONFIG to grant the GAS
                  cloud viewer session in zero-touch deployments. */}
              <SysConfigProvider>
                <MqttProvider>
                  <AuthProvider>
                    <ConfigGuard>
                      {children}
                    </ConfigGuard>
                    <Toaster />
                    <SonnerToaster position="top-right" richColors closeButton />
                  </AuthProvider>
                </MqttProvider>
              </SysConfigProvider>
            </QueryProvider>
          </LanguageProvider>
        </ThemeProvider>
        {/* Vercel Web Analytics + Speed Insights (gratis, privacy-friendly,
            auto-enabled saat komponen ini aktif di production). */}
        <Analytics />
        <SpeedInsights />
        {/* [WAVE-7 / PW7-2] Registrasi service worker serwist (/sw.js).
            - type "classic": artefak webpack @serwist/next adalah script
              klasik (bukan ES module) — kompatibilitas browser terluas.
            - disable di dev (selaras next.config.ts), kecuali SERWIST_DEV.
            - SwLegacyCleanup menyembuhkan klien yang membawa SW era PWA
              statis (cache-first yang bisa membajak navigasi "/"). */}
        <SerwistProvider
          swUrl="/sw.js"
          disable={process.env.NODE_ENV === "development" && !process.env.SERWIST_DEV}
          options={{ type: "classic" }}
        />
        <SwLegacyCleanup />
        {/* Push-alarm: sinkron konfigurasi runtime ke SW + deep-link ?view=alarms
            dari notificationclick (handler push ada di src/sw.ts). */}
        <PushAlarmBridge />
      </body>
    </html>
  );
}
