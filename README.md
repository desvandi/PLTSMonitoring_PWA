# PLTS Monitor PWA — Dasbor Next.js + Push-Alarm MonitorIoT

**Framework:** Next.js 16 (App Router, output standalone) · **Status:** LIVE
**Live URL:** [plts-monitoring-pwa.vercel.app](https://plts-monitoring-pwa.vercel.app)
**License:** MIT
**Repositori kembar (firmware/backend):** [desvandi/PLTSMonitoring_Firmware-Backend](https://github.com/desvandi/PLTSMonitoring_Firmware-Backend)

---

## Daftar Isi

1. [Gambaran Proyek](#1-gambaran-proyek)
2. [Arsitektur](#2-arsitektur)
3. [Struktur Proyek](#3-struktur-proyek)
4. [Fitur Utama](#4-fitur-utama)
5. [Panduan Deployment Lengkap](#5-panduan-deployment-lengkap)
6. [Environment Variables](#6-environment-variables)
7. [Konfigurasi Runtime](#7-konfigurasi-runtime)
8. [OTA Update — Push Canonical Release](#8-ota-update--push-canonical-release)
9. [INA219 Dynamic PGA UI](#9-ina219-dynamic-pga-ui)
10. [PWA Alarm Standalone](#10-pwa-alarm-standalone)
11. [Testing & QA](#11-testing--qa)
12. [Troubleshooting](#12-troubleshooting)
13. [Changelog](#13-changelog)

---

## 1. Gambaran Proyek

PWA (Progressive Web App) frontend untuk sistem monitoring PLTS 48V LiFePO4. Dibangun dengan Next.js 16, React 19, Tailwind CSS 4, dan shadcn/ui. **Satu aplikasi dengan dua wajah:**

1. **Aplikasi Next.js utama** (`src/`) — dasbor lengkap: baterai+BMS, energi, kalibrasi, alarm, OTA, laporan, AI insights, multi-bahasa, offline support, push-alarm natif.
2. **PWA alarm standalone** (`pwa-push-alarm/`) — vanilla JS ringan khusus menerima alarm (Web Push + ACK + deep-link), bisa di-hosting terpisah.

### Prinsip Inti

- **Never fabricate certainty** — setiap pengukuran membawa `value/unit/quality/source/timestamp`; sensor gagal → `null` (bukan `0`)
- **Canonical release identity** — PWA TIDAK menjadi source-of-truth firmware; canonical source adalah GitHub Release di firmware repo
- **Production OTA contract** — upload ke device mengirim `X-Expected-SHA256` + `X-Signature` + `X-Firmware-Version` headers

---

## 2. Arsitektur

```
┌─────────────────────────────────────────────────────┐
│                    PWA (Vercel)                      │
│                                                      │
│  ┌─────────────┐  ┌───────────┐  ┌───────────────┐ │
│  │  Dashboard   │  │  Battery  │  │  OTA Update   │ │
│  │  (Realtime)  │  │  + BMS    │  │  (Canonical   │ │
│  │              │  │           │  │   Release)    │ │
│  └──────┬───────┘  └─────┬─────┘  └───────┬───────┘ │
│         │                │                 │         │
│  ┌──────┴──────────────────┴─────────────────┐      │
│  │           API Routes (Next.js)            │      │
│  │  /api/status  /api/ota  /api/alarms  ...  │      │
│  └──────┬──────────────────┬─────────────────┘      │
│         │                  │                         │
└─────────┼──────────────────┼─────────────────────────┘
          │                  │
    ┌─────┴─────┐     ┌──────┴──────┐
    │   HTTPS   │     │  GitHub API │
    │  (proxy)  │     │  (releases) │
    └─────┬─────┘     └──────┬──────┘
          │                  │
    ┌─────┴──────────────────┴─────┐
    │           ESP32              │
    │    (firmware v1.9.3)         │
    └──────────────────────────────┘
```

### Data Flow

```
ESP32 → MQTT/HTTPS → PWA (realtime dashboard)
ESP32 → HTTPS → Google Apps Script → Google Sheets → PWA (history/reports)
GitHub Release → PWA → ESP32 (OTA update)
```

---

## 3. Struktur Proyek

```
PLTSMonitoring_PWA/
├── src/
│   ├── app/                      # Next.js App Router
│   │   ├── page.tsx              #   Main dashboard page
│   │   ├── layout.tsx            #   Root layout (providers, theme)
│   │   ├── api/                  #   API routes (proxy ke ESP32)
│   │   │   ├── status/           #     GET /api/status
│   │   │   ├── ota/              #     POST /api/ota (upload proxy)
│   │   │   ├── ota/check/        #     POST /api/ota/check
│   │   │   ├── ota/history/      #     GET /api/ota/history
│   │   │   ├── alarms/           #     GET/POST /api/alarms
│   │   │   ├── config/           #     GET/POST /api/config
│   │   │   ├── calibration/      #     Calibration endpoints
│   │   │   ├── reports/          #     Report generation
│   │   │   └── ...
│   │   ├── setup/                #   First-run setup page
│   │   ├── install/              #   PWA install page
│   │   ├── error.tsx             #   Error boundary
│   │   └── loading.tsx           #   Loading skeleton
│   │
│   ├── components/
│   │   ├── dashboard/            #   Dashboard view + measurement cards
│   │   ├── battery/              #   Battery + BMS + charts
│   │   ├── ota/                  #   OTA update view (Push Canonical Release)
│   │   ├── relays/               #   8-channel relay control (v1.8.0+)
│   │   ├── alarms/               #   Alarm center
│   │   ├── emergency/            #   E-WAVE emergency control
│   │   ├── energy/               #   Energy analytics
│   │   ├── charts/               #   Recharts components (V/I/P/SOC)
│   │   ├── config/               #   Configuration center
│   │   ├── calibration/          #   Calibration wizard
│   │   ├── diagnostics/          #   System diagnostics
│   │   ├── settings/             #   Settings panels
│   │   ├── ai/                   #   AI insights view
│   │   ├── reports/              #   Report viewer
│   │   ├── fleet/                #   Fleet management
│   │   ├── sensors/              #   Sensor health
│   │   ├── environment/          #   Environment (temp/humidity)
│   │   ├── events/               #   Event log
│   │   ├── ac/                   #   AC output view
│   │   ├── layout/               #   App shell, sidebar, theme toggle
│   │   ├── providers/            #   Auth, MQTT, theme, language providers
│   │   └── ui/                   #   shadcn/ui components (40+)
│   │
│   ├── lib/
│   │   ├── api.ts                #   API client (deviceApi + backendApi)
│   │   ├── deviceApi.ts          #   ESP32 REST client (OTA headers fix)
│   │   ├── backendApi.ts         #   GAS/backend client
│   │   ├── release-identity.ts   #   Canonical release identity (GitHub Releases)
│   │   ├── mqtt.ts               #   MQTT client (realtime)
│   │   ├── types.ts              #   TypeScript types (BatteryTelemetry, dll)
│   │   ├── format.ts             #   Formatters (fmtA, fmtADynamic, fmtV, dll)
│   │   ├── compatibility.ts     #   Firmware version compatibility check
│   │   ├── auth.ts               #   Auth (JWT session, CSRF)
│   │   ├── store.ts              #   Zustand store
│   │   ├── sysConfig.ts          #   System config (multi-device)
│   │   ├── mockStore.ts          #   Demo mode mock data
│   │   └── ...
│   │
│   ├── hooks/                    #   React hooks (useApi, useFleetStatus, dll)
│   ├── sw.ts                     #   Service Worker (Serwist)
│   └── types/                    #   Type declarations
│
├── pwa-push-alarm/               # PWA Alarm Standalone (vanilla JS)
│   ├── index.html
│   ├── manifest.json
│   ├── sw.js
│   ├── css/style.css
│   └── js/
│       ├── app.js
│       ├── push-manager.js
│       └── config.js
│
├── public/
│   ├── firmware/
│   │   └── manifest.json         # ESP Web Tools manifest (v1.9.3)
│   ├── vendor/
│   │   └── esp-web-tools/        # Self-hosted ESP Web Tools (10.4.0)
│   ├── icon-192.png
│   ├── icon-512.png
│   ├── icon-512-maskable.png
│   ├── manifest.webmanifest
│   └── sw.js                     # Compiled service worker
│
├── .github/workflows/
│   └── ci.yml                    # CI: lint + typecheck + test + build + cross-repo sync
│
├── package.json
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json
├── vitest.config.ts
├── eslint.config.mjs
├── components.json               # shadcn/ui config
└── README.md                     # File ini
```

---

## 4. Fitur Utama

### Dashboard
- **Realtime telemetri** — tegangan, arus, daya, SOC, suhu, kelembaban
- **Multi-device** — switch antar device PLTS
- **MQTT live updates** — WebSocket subscription untuk data real-time
- **Compatibility banner** — otomatis detect firmware version mismatch

### Battery & BMS
- **Battery view** — V/I/P/SOC cards + charts + PGA mode indicator (v1.9.2)
- **BMS block** — external BMS data (CAN/Modbus), cell voltages, SOH, CCL/DCL
- **Energy analytics** — charge/discharge Wh, EFC, round-trip efficiency
- **Dynamic precision** — `fmtADynamic()`: 2 desimal <10A, 1 <100A, 0 ≥100A

### OTA Update (v1.9.2+; canonical release identity v1.9.3)
- **Push Canonical Release** — fetch GitHub Release → download binary + sig → verify SHA → upload. Sejak firmware v1.9.3 build-nya reproducible (SHA byte-identik per source commit), sehingga SHA canonical release kini juga identik dengan biner yang diuji di hardware acceptance.
- **Production OTA headers** — `X-Expected-SHA256` + `X-Signature` + `X-Firmware-Version`
- **OTA history** — GAS OTA_LOG integration, lifecycle events (ACCEPTED → ACTIVATED)
- **Manual upload** — development mode .bin file upload

### 8-Channel Relay Control (v1.8.0+)
- **Relay control view** — 8 channels with ON/OFF/PULSE + status badges
- **3-tier state model** — EXECUTED / PENDING / TIMEOUT / UNKNOWN
- **Interlock + maxOnTime** — safety supervisor display
- **E-WAVE cascade** — emergency trip forces all OFF

### Alarm Center
- **Active + history** — alarm lifecycle (RAISED → ACKNOWLEDGED → CLEARED)
- **Telegram integration** — low-battery alerts via GAS → Telegram
- **Severity levels** — Critical / Warning / Info

### Emergency Control (E-WAVE)
- **ARM/DISARM** — relay energize/de-energize
- **E-stop** — emergency trip
- **Energy flow diagram** — visual energy distribution

### Configuration & Calibration
- **System config** — device name, site, timezone, idle threshold
- **3-point voltage calibration** — low/nominal/full
- **ACS712 zero calibration** — offset null
- **BMS comm panel** — protocol selection
- **OTA signing panel** — manifest publish (GAS)

### AI Insights
- **GasAdvisor** — HMAC-signed AI gas safety recommendations
- **Advisory only** — labeled ESTIMATED, never authoritative

### Reports
- **Daily energy records** — charge/discharge Wh per day
- **Export** — JSON download

### Multi-language
- **Indonesian + English** — full i18n (language-provider)
- **Runtime switch** — no page reload

### Offline Support
- **Service Worker** (Serwist) — cache-first for static, network-first for API
- **PWA installable** — standalone mode, maskable icons

---

## 5. Panduan Deployment Lengkap

### Prasyarat

- **Node.js** 20+ (recommend 22+)
- **npm** atau **bun**
- **Vercel account** (gratis)
- **ESP32 device** dengan firmware v1.8.0+ (lihat firmware repo)
- **Google Apps Script backend** (lihat firmware repo `code.gs/`)

### Langkah 1: Clone & Install

```bash
git clone https://github.com/desvandi/PLTSMonitoring_PWA.git
cd PLTSMonitoring_PWA
npm install
```

### Langkah 2: Environment Variables

Buat `.env.local`:

```bash
# ESP32 device URL (direct or via Cloudflare Tunnel)
NEXT_PUBLIC_API_BASE_URL=http://192.168.1.100

# Backend GAS URL
NEXT_PUBLIC_GAS_URL=https://script.google.com/macros/s/AKfycb.../exec

# Demo mode (set "false" in production)
NEXT_PUBLIC_DEMO_MODE=false

# MQTT (optional, for realtime)
NEXT_PUBLIC_MQTT_BROKER=wss://broker.example.com:8884
NEXT_PUBLIC_MQTT_TOPIC=plts/+/status
```

### Langkah 3: Development

```bash
npm run dev
# Buka http://localhost:3000
```

### Langkah 4: Build & Test

```bash
# Typecheck
npm run typecheck

# Lint
npm run lint

# Unit tests
npm test

# Production build
npm run build
```

### Langkah 5: Deploy ke Vercel

#### Opsi A: Via Vercel CLI

```bash
npm install -g vercel
vercel login
vercel --prod
```

#### Opsi B: Via GitHub Integration

1. Buka [vercel.com](https://vercel.com) → New Project
2. Import `desvandi/PLTSMonitoring_PWA`
3. Set Environment Variables (sama dengan `.env.local`)
4. Deploy → otomatis rebuild setiap push ke main

### Langkah 6: Deploy PWA Alarm Standalone (Opsional)

```bash
cd pwa-push-alarm
# Edit js/config.js:
#   const GAS_WEBAPP_URL = 'your-gas-url';
#   const VAPID_PUBLIC_KEY = 'your-vapid-public-key';

# Deploy ke Vercel (terpisah dari main PWA)
vercel --prod
```

### Langkah 7: Verifikasi

1. Buka PWA URL di browser
2. Login dengan AUTH_TOKEN (sama dengan GAS AUTH_TOKEN)
3. Verifikasi dashboard menampilkan telemetri
4. Test OTA: OTA view → "Push Canonical Release" → "Fetch Latest Release"
5. Verifikasi PGA mode indicator muncul di battery view (jika firmware v1.9.2+)

---

## 6. Environment Variables

| Variable | Wajib | Default | Description |
|----------|-------|---------|-------------|
| `NEXT_PUBLIC_API_BASE_URL` | Ya | — | ESP32 device URL (direct atau tunnel) |
| `NEXT_PUBLIC_GAS_URL` | Ya | — | Google Apps Script Web App URL |
| `NEXT_PUBLIC_DEMO_MODE` | Tidak | `false` | Demo mode (mock data, no real device) |
| `NEXT_PUBLIC_MQTT_BROKER` | Tidak | — | MQTT broker URL (`wss://` untuk TLS) |
| `NEXT_PUBLIC_MQTT_TOPIC` | Tidak | `plts/+/status` | MQTT topic pattern |
| `AUTH_TOKEN` | Ya (server) | — | GAS auth token (server-side only) |

---

## 7. Konfigurasi Runtime

### First-Run Setup (Zero-Touch)

1. ESP32 boot → WiFi AP mode ("PLTS-Setup-XXXX")
2. Hubungkan HP ke AP → PWA auto-redirect ke `/setup`
3. Scan QR code atau manual input:
   - WiFi SSID + password
   - GAS URL + AUTH_TOKEN
   - Device name + site name
4. Submit → ESP32 reboot → connect ke WiFi → PWA reload

### Multi-Device Management

- **Device switcher** di sidebar — switch antar device
- **SysConfig store** — per-device config di localStorage
- **Fleet view** — overview semua device

### Demo Mode

Jika `NEXT_PUBLIC_DEMO_MODE=true`, PWA menggunakan mock data (`src/lib/mockStore.ts`):
- Telemetri simulasi (V/I/P/SOC berubah real-time)
- Tidak perlu ESP32 atau GAS
- Berguna untuk development/demo

---

## 8. OTA Update — Push Canonical Release

### Flow (Production OTA)

```
1. User klik "Fetch Latest Release"
   ↓
2. PWA calls getCanonicalRelease()
   → GET https://api.github.com/repos/desvandi/.../releases/latest
   → Find asset "modular-release.json"
   → Parse: version, firmwareSha256, gitCommit, releaseUrl
   ↓
3. PWA displays release info (version, SHA, git commit, URL)
   ↓
4. User klik "Push Release to Device" (contoh: v1.9.3)
   ↓
5. PWA downloads modular-firmware.bin from GitHub Release
   ↓
6. PWA downloads modular-firmware.bin.sig (Ed25519 hex signature)
   ↓
7. PWA computes SHA-256 client-side (crypto.subtle.digest)
   → Verify: computed SHA == canonicalRelease.firmwareSha256
   ↓
8. PWA uploads to ESP32: POST /api/ota
   Headers:
     X-Expected-SHA256: <64 hex chars>
     X-Signature: <128 hex chars (64 bytes Ed25519)>
     X-Firmware-Version: 1.9.3
   ↓
9. ESP32 verifies:
   - Streaming SHA-256 == X-Expected-SHA256
   - Ed25519 signature on raw SHA-256 digest
   - Strict SemVer anti-downgrade
   ↓
10. ESP32 flashes + reboots → ACTIVATED lifecycle event
```

### Manual Upload (Development)

Untuk development tanpa GitHub Release:
1. Buka OTA view → "Upload Binary"
2. Pilih file `.bin` (max 1.5MB)
3. Upload langsung ke ESP32 (tanpa SHA/sig headers)
4. **Catatan:** Production build ESP32 akan menolak upload tanpa headers

---

## 9. INA219 Dynamic PGA UI

### PGA Mode Indicator

Battery view menampilkan card "INA219 PGA" yang menunjukkan mode aktif:
- **"80mV"** — High-res standby (1–100A range)
- **"160mV"** — Peak load mode (100–150A range)

Hanya muncul jika firmware v1.9.2+ mengirim `bat.pgaMode` di telemetry.

### Chart Ranges (v1.9.2)

| Chart | Domain | Keterangan |
|-------|--------|------------|
| CurrentChart | ±200A | + reference lines di ±100A (PGA switch threshold) |
| PowerChart | ±10000W | 150A × 57.5V ≈ 8625W peak |
| SocChart | 0–100% | Standard SOC range |

### Dynamic Precision (`fmtADynamic`)

```typescript
|I| < 10A  → 2 decimals  ("1.25 A" — standby precision)
|I| < 100A → 1 decimal   ("45.3 A" — normal load)
|I| ≥ 100A → 0 decimals  ("125 A"  — peak, no false precision)
```

Ini menyesuaikan dengan INA219 dynamic gain: ±80mV mode punya 10µV resolution (0.013A), sehingga 2 desimal honest. ±160mV mode lebih noisy per-bit, sehingga 0 desimal avoids false precision.

---

## 10. PWA Alarm Standalone

### `pwa-push-alarm/` — Vanilla JS PWA

PWA ringan terpisah khusus menerima alarm Web Push:

- **Service Worker** — `sw.js` (push event handler, aes128gcm decryption)
- **Push Manager** — `js/push-manager.js` (VAPID subscription, notification display)
- **Config** — `js/config.js` (GAS URL, VAPID public key)

### Deploy

```bash
cd pwa-push-alarm
# Edit js/config.js dengan GAS URL + VAPID public key
vercel --prod
```

### Fitur

- **Alarm notifications** — tampil walau PWA tertutup (Web Push API)
- **ACK button** — acknowledge alarm langsung dari notification
- **Deep-link** — klik notification → buka main PWA di alarm yang relevan
- **Sensor dashboard** — dasbor sederhana (V/I/SOC/alarm status)

---

## 11. Testing & QA

### Run Tests

```bash
# Typecheck
npm run typecheck

# Lint
npm run lint

# Unit tests (Vitest)
npm test

# Watch mode
npm run test:watch

# Build
npm run build
```

### CI Pipeline (`.github/workflows/ci.yml`)

| Job | Fungsi |
|-----|--------|
| ESLint | Code quality check |
| TypeScript typecheck | Type safety |
| Vitest unit tests | Unit test suite |
| Next.js production build | Build verification |
| Cross-repo firmware manifest sync | PWA manifest == firmware repo manifest |

### Key Test Files

| File | Fungsi |
|------|--------|
| `src/lib/__tests__/gasEnvelope.test.ts` | Gas envelope parsing |
| `src/lib/__tests__/mqtt.test.ts` | MQTT client |
| `src/lib/__tests__/push-alarm.test.ts` | Push alarm integration |
| `src/lib/__tests__/emergency.test.ts` | Emergency schema |
| `src/lib/__tests__/energyFlow.test.ts` | Energy flow calculation |
| `src/lib/__tests__/soc-provenance.test.ts` | SOC provenance |
| `src/lib/__tests__/truth-semantics.test.ts` | Truth state semantics |
| `src/lib/__tests__/admin-token-session.test.ts` | Admin token session |
| `src/lib/__tests__/ai-insights-contract.test.ts` | AI insights contract |

---

## 12. Troubleshooting

### PWA tidak bisa connect ke ESP32

**Penyebab:** `NEXT_PUBLIC_API_BASE_URL` salah atau ESP32 tidak di LAN yang sama.

**Fix:**
1. Verifikasi URL: `curl http://<ESP32-IP>/api/health`
2. Jika ESP32 di belakang tunnel (Cloudflare), set URL ke tunnel domain
3. Jika development, set `NEXT_PUBLIC_API_BASE_URL=http://localhost:3000` (proxy via Next.js)

### OTA: "OTA upload failed" / HTTP 500

**Penyebab:** ESP32 production build menolak upload tanpa signature headers.

**Fix:**
1. Gunakan "Push Canonical Release" card (bukan manual upload)
2. Klik "Fetch Latest Release" dulu → verifikasi release info muncul
3. Klik "Push Release to Device" → PWA akan download + verify SHA + upload dengan headers

### PGA mode indicator tidak muncul

**Penyebab:** Firmware < v1.9.2 tidak mengirim `bat.pgaMode` field.

**Fix:**
1. Update firmware ke v1.9.2+ (lihat firmware repo)
2. Verifikasi di Serial Monitor: log INA219 config readback `0x0FFF`
3. Cek telemetry JSON: `bat.pgaMode` harus "80mV" atau "160mV"

### Chart current terpotong di 100A

**Penyebab:** PWA lama (sebelum v1.9.2) masih pakai domain auto/100A.

**Fix:**
1. Update PWA ke versi terbaru (commit `9c8510a`+)
2. Verifikasi CurrentChart domain = `[-200, 200]`

### MQTT tidak connect

**Penyebab:** Broker URL salah, TLS issue, atau topic pattern mismatch.

**Fix:**
1. Set `NEXT_PUBLIC_MQTT_BROKER` dengan format `wss://broker:port` (WSS untuk TLS)
2. Verifikasi broker menerima koneksi: `openssl s_client -connect broker:port`
3. Cek topic pattern: `NEXT_PUBLIC_MQTT_TOPIC=plts/+/status`

### Demo mode tidak bisa dimatikan

**Penyebab:** `NEXT_PUBLIC_DEMO_MODE` masih `true` atau environment variable tidak ter-load.

**Fix:**
1. Set `NEXT_PUBLIC_DEMO_MODE=false` di Vercel dashboard (Settings → Environment Variables)
2. Redeploy (push commit atau manual redeploy)
3. Hard refresh browser (Ctrl+Shift+R)

---

## 13. Changelog

### v1.9.3 (Current)
- **Firmware manifest sync** — `public/firmware/manifest.json` version 1.9.3 (parity dengan firmware repo)
- **Reproducible build support** — firmware v1.9.3 embed identitas build deterministik (SOURCE_DATE_EPOCH); SHA-256 canonical release kini stabil per source commit, memperkuat `verifyFirmwareSha256()` (REL-03/REL-04 di repo firmware CLOSED)

### v1.9.2
- **INA219 Dynamic PGA UI** — PGA mode indicator card ("80mV"/"160mV")
- **Chart ranges updated** — CurrentChart ±200A, PowerChart ±10000W
- **Dynamic precision** — `fmtADynamic()`: 2 decimals <10A, 1 <100A, 0 ≥100A
- **PGA mode field** — `BatteryTelemetry.pgaMode` optional field
- **OTA headers fix** — `deviceApi.otaUpload` mengirim `X-Expected-SHA256` + `X-Signature` + `X-Firmware-Version`
- **Push Canonical Release** — full production OTA flow (fetch → download → verify → upload)
- **Firmware manifest sync** — `public/firmware/manifest.json` version 1.9.2

### v1.8.0
- **8-channel relay control** — relay-control-view dengan 3-tier state model
- **Compatibility gate** — firmware version check sebelum relay UI
- **PWA CI** — lint + typecheck + test + build + cross-repo manifest sync

### v1.7.x
- **E-WAVE emergency control** — ARM/DISARM/E-stop + energy flow diagram
- **PZEM-004T AC meter** — real AC meter integration
- **GAS OTA_LOG** — real device-reported OTA events
- **Multi-language** — Indonesian + English
- **Canonical release identity** — `release-identity.ts` (GitHub Releases API)
- **Cross-layer contract tests** — WAVE 7-13 regression

### v1.6.x
- **External BMS** — CAN/Modbus integration
- **SOC provenance** — BMS_DIRECT | SHUNT_COULOMB | OCV_ESTIMATED
- **AI insights** — GasAdvisor HMAC-signed advisory
- **Energy analytics** — charge/discharge Wh, EFC, round-trip efficiency

---

## License

MIT — see [LICENSE](LICENSE)

## Kontak

- **Live URL:** [plts-monitoring-pwa.vercel.app](https://plts-monitoring-pwa.vercel.app)
- **GitHub Issues:** [github.com/desvandi/PLTSMonitoring_PWA/issues](https://github.com/desvandi/PLTSMonitoring_PWA/issues)
- **Firmware Repo:** [github.com/desvandi/PLTSMonitoring_Firmware-Backend](https://github.com/desvandi/PLTSMonitoring_Firmware-Backend)
