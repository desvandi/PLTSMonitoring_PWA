# PLTS Monitor PWA — Dasbor Next.js + Push-Alarm MonitorIoT

**Version:** 1.7.x (E-WAVE/WAVE-7) · **Framework:** Next.js 16 (App Router, output standalone) · **Status:** LIVE di
[`jmsepltsmonitoring.vercel.app`](https://jmsepltsmonitoring.vercel.app) + PWA standalone di
[`plts-monitor-push-alarm.vercel.app`](https://plts-monitor-push-alarm.vercel.app)
· **License:** MIT · **Repositori kembar (backend/firmware):**
[desvandi/plts_monitor_firmware-code.gs-etc](https://github.com/desvandi/plts_monitor_firmware-code.gs-etc)

Frontend PWA production-grade untuk sistem monitoring PLTS 48 V LiFePO4 —
**satu aplikasi dengan dua wajah**:

1. **Aplikasi Next.js utama** (`src/`) — dasbor lengkap: baterai+BMS,
   energi, kalibrasi, alarm, OTA, laporan, AI insights, multi-bahasa,
   offline support — **plus push-alarm natif** (notifikasi alarm GAS tetap
   tampil walau aplikasi ditutup).
2. **PWA alarm standalone** (`pwa-push-alarm/`) — vanilla JS ringan khusus
   menerima alarm (dasbor sensor + Web Push + ACK + deep-link), bisa
   di-hosting terpisah.

Prinsip inti: ***never fabricate certainty*** — setiap pengukuran membawa
value/unit/quality/source/timestamp; sensor gagal → `null` (bukan `0`);
telemetri basi → ditandai STALE (bukan dipretends real-time).

> **Dokumen operasional utama:**
> [`Panduan_Deploy_Production_MonitorIoT.pdf`](Panduan_Deploy_Production_MonitorIoT.pdf)
> (di **akar** repositori ini, Edisi 3, 38 halaman) — kamus klik-demi-klik
> semua parameter/env/kredensial, prosedur deploy GAS → PWA → firmware,
> peran dua proyek Vercel (Bab 2.3), dan peta platform gratis Rp0 (Lampiran A).
> Salinan identik ada di akar repo kembar.

---

## Daftar Isi

1. [Arsitektur Singkat](#1-arsitektur-singkat)
2. [Panduan Deployment](#2-panduan-deployment)
3. [Environment Variables](#3-environment-variables)
4. [Konfigurasi Runtime (Zero-Touch) & Mode Operasi](#4-konfigurasi-runtime-zero-touch--mode-operasi)
5. [Integrasi Push-Alarm Natif](#5-integrasi-push-alarm-natif)
6. [PWA Alarm Standalone (`pwa-push-alarm/`)](#6-pwa-alarm-standalone-pwa-push-alarm)
7. [Struktur Proyek](#7-struktur-proyek)
8. [Fitur Utama](#8-fitur-utama)
9. [Kualitas & Provenance](#9-kualitas--provenance)
10. [Offline Support](#10-offline-support)
11. [Testing & QA](#11-testing--qa)
12. [Honest Disclosure](#12-honest-disclosure)
13. [Panduan Wiring (ringkas)](#13-panduan-wiring-ringkas)
14. [Troubleshooting](#14-troubleshooting)
15. [Kontrol Darurat & Aliran Energi (E-WAVE v1.7)](#15-kontrol-darurat--aliran-energi-e-wave-v17)

---

## 1. Arsitektur Singkat

```
Next.js 16 (App Router, output: standalone)
├── UI — 12 view (dashboard, battery+BMS, AC, energi, kalibrasi, alarm, …)
├── API routes (runtime nodejs) — proxy REST ke ESP32 di LAN/tunnel
├── Serwist service worker — offline shell + telemetri network-first
│   + handler Web Push (sw.ts → public/sw.js)
└── 3 jalur backend (bisa dikombinasikan):
    1. ESP32 REST (LAN / Cloudflare Tunnel) — realtime, config, OTA
    2. Google Apps Script — history, laporan, backup, insights, PUSH ALARM
    3. MQTT broker (wss/TLS) — realtime subscribe (monitoring-only, opsional)
```

PWA **stateless & client-agnostic** — deploy sekali, setiap pengguna
mengonfigurasi sendiri GAS URL + token via wizard `/setup`. Tidak ada env var
wajib untuk mode dasar. Seluruh tumpukan berjalan di platform gratis Rp0
tanpa kartu kredit (Vercel Hobby + GAS + push service peramban + GitHub —
rincian kuota vs beban 2 HP + 1 modul ada di Lampiran A panduan PDF).

**Dua proyek Vercel di akun ini** — keduanya aktif dan punya peran berbeda
(rincian + cara pakai: Bab 2.3 panduan):

| Proyek Vercel | URL | Isi |
| :--- | :--- | :--- |
| `jmseplts_monitoring` | `jmsepltsmonitoring.vercel.app` | **Aplikasi utama** — dasbor PLTS + push-alarm natif (auto-deploy dari repo ini, branch `main`) |
| `plts-monitor-push-alarm` | `plts-monitor-push-alarm.vercel.app` | **PWA standalone** — alarm ringan dari folder `pwa-push-alarm/` |

> **Aturan anti-duplikat:** 1 HP cukup berlangganan notifikasi dari SATU
> aplikasi — backend GAS-nya sama, subscribe ganda = notifikasi dobel.

---

## 2. Panduan Deployment

> ⚠️ **PENTING — jangan deploy folder `public/` saja.** Folder itu hanya
> berisi aset statis (manifest, ikon, `sw.js` hasil build) plus artefak
> firmware untuk halaman `/install`. Aplikasi produksi adalah **aplikasi
> Next.js** yang harus di-build — mem-deploy `public/` berarti kehilangan
> seluruh fitur v1.6 (Alarm Center kanonik, panel BMS, badge provenance
> SOC, API routes, offline caching yang benar).

### 2.1 Prasyarat

| Kebutuhan | Keterangan |
| :--- | :--- |
| Akun Vercel (gratis) **atau** server Node 18+ | hosting |
| Repo GAS sudah ter-deploy | lihat README repo firmware §4.1 |
| (Opsional) broker MQTT wss | untuk realtime produksi |

### 2.2 Opsi 1 — Vercel (direkomendasikan)

1. **Add New Project** → import repo `plts_monitor_PWA_only`.
2. Framework preset: **Next.js** (terdeteksi otomatis). Build command
   `next build`, output standalone ditangani otomatis oleh Vercel.
3. Environment variables: **tidak wajib** untuk mode zero-touch (semua
   konfigurasi runtime via wizard `/setup`, tersimpan di `localStorage`).
   Tambahkan env var sesuai tabel §3 bila ingin MQTT realtime bawaan
   atau mode LAN REST.
4. **Deploy** → buka domain → otomatis redirect ke `/setup`.

**Gerbang verifikasi:** `/setup` terbuka, Test Handshake ke GAS balas
`PONG`, dashboard terbuka tanpa error console.

#### 2.2.1 Optimasi Vercel (aktif sejak 2026-08-28)

Konfigurasi berikut sudah terpasang di repo dan akun Vercel — tidak perlu
langkah manual, tapi penting dipahami saat meng-audit atau pindah project:

| Item | Nilai | Keterangan |
| :--- | :--- | :--- |
| Function region | `sin1` (Singapura) | Di-set di project settings. Default `iad1` (AS) menambah ~200 ms latency untuk pengguna Indonesia |
| Security headers | `vercel.json` | `X-Content-Type-Options`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy`, `Permissions-Policy` (kamera `(self)` untuk scan QR) |
| Cron harian | `0 20 * * *` (03:00 WIB) | Memanggil `GET /api/health` — invocation terlihat di Vercel → *Cron Jobs* / Observability |
| Web Analytics | `@vercel/analytics/next` v2 | Aktif otomatis di production (gratis di plan Hobby). Vercel → tab **Analytics** |
| Speed Insights | `@vercel/speed-insights/next` v2 | Core Web Vitals nyata. Vercel → tab **Speed Insights** |
| Lockfile | `package-lock.json` saja | `yarn.lock` basi dihapus — resolusi dependensi deterministik |
| Cache aset | `vercel.json` | Binary firmware OTA (`/firmware/*`) cache 1 jam + SWR 1 hari; ikon PWA 1 hari; `sw.js` tetap `no-cache` |
| Vercel Firewall | aktif (gratis semua plan) | Lihat 2.2.2 |

**Endpoint `/api/health`** adalah readiness check yang jujur (tanpa
membocorkan secret): melaporkan boolean keberadaan `NEXT_PUBLIC_MQTT_BROKER_URL`,
kredensial MQTT, `NEXT_PUBLIC_GAS_INSIGHTS_URL` (plus ping nyata ke GAS
timeout 8 dtk), dan validitas panjang `JWT_SECRET`. Jika semua `false`,
env var di Vercel memang kosong — mode zero-touch via wizard `/setup` tetap
berfungsi, tetapi MQTT realtime bawaan tidak aktif.

> **Jangan fallback diam-diam**: jika `NEXT_PUBLIC_MQTT_BROKER_URL` kosong,
> `src/lib/mqtt.ts` menolak koneksi dan menampilkan error eksplisit — sistem
> tidak pernah diam-diam memakai broker publik.

#### 2.2.2 Vercel Firewall (gratis di semua plan)

Status diverifikasi di dashboard: **Project → Firewall**.

| Lapisan | Mode | Perilaku |
| :--- | :--- | :--- |
| Custom rule (1 dari 3 slot Hobby) | `challenge` | Request non-browser (UA tanpa `Mozilla`) ke `/api/*` disajikan JS challenge. `/api/health` **dikecualikan** agar Cron tetap berhasil |
| Bot Protection ruleset | `log` | Deteksi bot via heuristik TLS/JA4; mode observasi dulu |
| AI Bots ruleset | `deny` | Crawler AI (GPTBot, ClaudeBot, Bytespider, dll.) ditolak 403 — terverifikasi live |
| Core Ruleset (CRS) | `log` | Deteksi XSS/SQLi/RCE dalam mode log; naikkan ke `deny` bila ada serangan nyata |
| DDoS mitigation + Attack Mode | otomatis / manual | Attack Mode diaktifkan manual via dashboard saat dibutuhkan |

Batas plan Hobby: maksimal **3 custom rules**; rate limiting WAF dan OWASP
CRS berbayar (Pro/Enterprise) — sengaja tidak dipakai. Fitur yang tidak
tersedia di Hobby: Skew Protection (mitigasi gratis: serwist
`reloadOnOnline` + `max-age=0` pada `sw.js` sudah aktif), Speed Insights
Plus, WAF Rate Limiting, OWASP CRS.

### 2.3 Opsi 2 — Self-host (standalone server)

```bash
git clone https://github.com/desvandi/plts_monitor_PWA_only.git
cd plts_monitor_PWA_only
npm install
npm run build          # build + salin static & public ke .next/standalone
PORT=3000 node .next/standalone/server.js   # atau: bun (lihat npm start)
```

Letakkan di balik reverse proxy HTTPS (Caddy/Nginx) — **wajib HTTPS** untuk
service worker + Web Serial (halaman `/install`):

```
plts.domainanda.com {
    reverse_proxy 127.0.0.1:3000
}
```

---

## 3. Environment Variables

Salin `.env.example` → `.env.local` (dev) atau dashboard host (produksi).

| Variabel | Wajib? | Fungsi |
| :--- | :--- | :--- |
| `NEXT_PUBLIC_API_BASE_URL` | — | Base URL REST ESP32 (LAN/tunnel). Kosong = mode MQTT-only |
| `NEXT_PUBLIC_MQTT_BROKER_URL` | — | `wss://broker:8884/mqtt` untuk realtime produksi |
| `NEXT_PUBLIC_MQTT_USERNAME` / `NEXT_PUBLIC_MQTT_PASSWORD` | — | Kredensial broker (terpisah dari ESP32 — isolasi blast-radius) |
| `JWT_SECRET` | hanya mode LAN | Minimal 32 karakter; tanpa ini login LAN = 403 fail-closed |
| `NEXT_PUBLIC_PUSH_API_BASE` | — | Default build-time URL GAS PushService (opsional; isian Settings menimpa) |
| `NEXT_PUBLIC_PUSH_VAPID_PUBLIC_KEY` | — | Default build-time kunci publik VAPID (opsional; isian Settings menimpa) |
| `DEMO_MODE` / `NEXT_PUBLIC_DEMO_MODE` | dev saja | Mock API + kredensial demo. **Dipaksa mati di production** — guard di `src/lib/mockStore.ts` menolak dan mencatat CRITICAL |
| `SERWIST_DEV` | — | Aktifkan SW di dev untuk uji PWA |

Aturan keamanan yang dikodekan (bukan sekadar saran): mode demo dan mock
auth **mustahil aktif** saat `NODE_ENV=production` — percobaan mengaktifkan
memicu warning CRITICAL di log server. Kunci VAPID **publik** aman
diekspos; kunci privat hanya di Script Properties GAS.

### Development lokal

```bash
npm install
npm run dev            # http://localhost:3000 — mode demo otomatis (dev)
DEMO_MODE=true npm run dev   # eksplisit
npm run test           # vitest
npm run typecheck      # tsc --noEmit
npm run lint           # eslint — 0 error
npm run build          # build produksi
```

---

## 4. Konfigurasi Runtime (Zero-Touch) & Mode Operasi

| Route | Fungsi |
| :--- | :--- |
| `/setup` | First-run wizard — GAS URL + Auth Token + Device Key, Test Handshake (PING/PONG), ekspor/impor JSON, scan QR |
| `/install` | Flashing ESP32 via browser (ESP Web Tools) — membaca `/firmware/manifest.json`; label versi dibaca **langsung dari manifest** |
| `/` | Dashboard — dijaga `ConfigGuard`; tanpa `PLTS_SYS_CONFIG` → redirect `/setup` |

Konfigurasi tersimpan di `localStorage` (kunci `PLTS_SYS_CONFIG`, skema di
`src/lib/sysConfig.ts`). Multi-device: satu GAS backend bisa melayani banyak
device — ganti profil dari device switcher.

**Mode operasi (matriks jujur):**

| Mode | Sumber data | Sesi | Yang terlihat |
| :--- | :--- | :--- | :--- |
| **GAS Cloud (Viewer)** — zero-touch default | Fleet view polling `LATEST` tiap 30 dtk (SOC + provenance) | Viewer (badge `GAS Cloud · Viewer`) | Fleet, Reports GAS, alarm baca; view mutasi disembunyikan |
| **GAS + MQTT (produksi, disarankan)** | Realtime broker + history GAS | Viewer saat via MQTT (badge `MQTT`) | Semua view baca; mutasi butuh login operator |
| **LAN REST** | ESP32 langsung (URL LAN/tunnel) | Operator via login (JWT + CSRF) | Semua view termasuk config/kalibrasi/OTA |
| **Demo** | Mock API internal | Operator demo (admin/admin123) | Semua view — HANYA `NODE_ENV=development` (fail-closed di produksi) |

> **Perilaku mode GAS Cloud:** profil GAS tersimpan (URL+token ter-bukti
> lewat handshake) memberi sesi **viewer** — sesi 401 tak lagi menghalangi,
> badge mode tidak pernah bohong "mock", dashboard menunjuk ke Fleet view.
> Kartu realtime (REST/MQTT) di mode ini jujur menampilkan panel penjelas +
> tombol menuju Fleet.

---

## 5. Integrasi Push-Alarm Natif

Notifikasi alarm GAS tetap tampil **walau aplikasi ditutup**. Cara pakai
setelah GAS PushService ter-deploy (prosedur lengkap: Bab 4 panduan PDF):
buka **Settings → Server Push Alarm (GAS PushService)**, tempel URL `/exec`
+ `VAPID_PUBLIC_KEY`, simpan, nyalakan toggle, lalu *Kirim Uji Push*.

Komponen integrasi:

- **Service worker** (`src/sw.ts`, di-build Serwist ke `public/sw.js`):
  handler `push` (payload terenkripsi aes128gcm + fallback
  `?action=latestAlarm`), `notificationclick` (fokus jendela / buka
  `/?view=alarms&from=push`; aksi *Tandai Ditangani* mengirim `ackAlarm`
  ke GAS), dan `pushsubscriptionchange` (berlangganan ulang otomatis +
  pembaruan endpoint di GAS).
- **Panel Settings** (`src/components/settings/push-alarm-panel.tsx`):
  isian URL + kunci publik VAPID (pola zero-touch `PLTS_SYS_CONFIG` —
  localStorage + IndexedDB untuk SW), toggle langganan, tombol *Kirim Uji
  Push* (rate-limit 60 dtk di sisi GAS).
- **Pustaka** (`src/lib/push-alarm/`): `client.ts` (port TS push-manager:
  izin hanya dari gestur, validasi kunci 65-byte 0x04, rollback saat server
  menolak, unsubscribe server-dahulu), `sw-config-store.ts` (konfigurasi
  runtime di IndexedDB — bisa dibaca SW), `shared.ts` (decoder base64url
  murni + builder opsi notifikasi).
- **Deep-link** (`src/components/providers/push-alarm-bridge.tsx`): klik
  notifikasi mengarah ke view Alarms (URL `?view=alarms` untuk jendela
  baru, `postMessage` untuk jendela terbuka — navigasi selalu same-origin).
- **Hook** `src/hooks/usePushAlarm.ts` — state langganan + aksi.
- **Uji**: `src/lib/__tests__/push-alarm.test.ts` (decoder fuzz vs orakel
  Node, validasi konfigurasi, opsi notifikasi, guard deep-link, regresi
  struktural handler SW) — `npm run test`.

---

## 6. PWA Alarm Standalone (`pwa-push-alarm/`)

PWA alarm sensor MonitorIoT versi vanilla (HTML statis) — dasbor status
sensor suhu/kelembapan/tanah, langganan Web Push terenkripsi, notifikasi
saat aplikasi tertutup, ACK, deep-link. Komunikasi hanya ke backend GAS
MonitorIoT. **Backend, firmware, toolkit, dan suite regresi 203 asersi ada
di repo kembar** (folder `push-alarm/`).

```
pwa-push-alarm/
├── index.html          Halaman aplikasi (dasbor + panel notifikasi)
├── manifest.json       Manifest PWA (nama, ikon, display, shortcut)
├── sw.js               Service worker: handler push, notificationclick,
│                       pushsubscriptionchange, periodicsync, cache
├── js/config.js        KONFIGURASI (API_BASE, VAPID_PUBLIC_KEY, dst.)
├── js/push-manager.js  Izin + langganan push + validasi kunci
├── js/app.js           Logika dasbor: polling, render, status koneksi
├── css/style.css       Gaya antarmuka
├── icons/              Ikon PWA (192/512, maskable, badge 72)
├── vercel.json         Header hosting (sw.js no-cache; hanya berlaku bila
│                       folder ini di-deploy sebagai akar proyek Vercel)
└── tools/verify-deployment.js   Gerbang verifikasi sebelum hosting
```

**Penting:**

- Folder ini **tidak ikut di-build Next.js** (statis mandiri, dikecualikan
  dari lint/tsc; `vercel.json` di dalamnya hanya berlaku bila didorong
  sebagai proyek Vercel tersendiri).
- **Konfigurasi (wajib sebelum hosting):** `API_BASE` di `js/config.js`
  **dan** `sw.js` harus identik (URL GAS `/exec`), plus `VAPID_PUBLIC_KEY`
  di `js/config.js`. Jangan edit manual — gunakan injektor 1-perintah dari
  repo kembar:
  ```bash
  node tools/apply-deploy-config.js --pwa-dir <folder-ini> \
       --url "https://script.google.com/macros/s/GANTI_ID_DEPLOYMENT/exec" \
       --out build
  node tools/verify-deployment.js --config build/js/config.js --sw build/sw.js
  ```
  Hasil verifikasi harus **SIAP DEPLOY**. `--out build` menghasilkan salinan
  terpasang (di-gitignore) sehingga templat tetap murni placeholder.
- Konstanta lain `js/config.js` (terkalibrasi): `APP_VERSION` 2.0.0,
  `POLL_INTERVAL_MS` 30000, `FETCH_TIMEOUT_MS` 15000,
  `CONNECTION_BANNER_AFTER_FAILURES` 2.
- Hosting: unggah ISI folder build ke hosting statis HTTPS apa pun
  (Vercel / GitHub Pages / Netlify / Cloudflare Pages).
- iOS/iPadOS: notifikasi butuh iOS 16.4+ dan PWA dipasang ke Layar Utama.
- Keamanan: `VAPID_PUBLIC_KEY` memang dirancang publik; kunci privat hanya
  di Script Properties GAS; payload push maksimum 4096 byte (GAS memotong).
- Uji end-to-end: dari editor GAS jalankan `simulateAlarmPush()` —
  notifikasi harus masuk WALAU PWA tertutup (skenario acceptance lengkap:
  Bab 5 panduan PDF).

---

## 7. Struktur Proyek

```
├── README.md                       # dokumen ini (satu-satunya README)
├── Panduan_Deploy_Production_MonitorIoT.pdf   # panduan go-live (akar)
├── src/
│   ├── app/                        # App Router — halaman + API routes (nodejs)
│   │   ├── page.tsx                # dashboard (ConfigGuard)
│   │   ├── setup/ · install/       # wizard + flashing browser
│   │   └── api/                    # ~20 route: status, alarms, config, ota,
│   │                               #   calibration, factory_reset, insights, …
│   ├── components/                 # 12 view domain + UI kit (shadcn-style)
│   │   ├── battery/                #   + panel BMS + badge provenance SOC
│   │   ├── alarms/                 #   Alarm Center (kontrak {active, history})
│   │   ├── settings/               #   BMS, kalibrasi, OTA signing, push-alarm, …
│   │   └── providers/              #   push-alarm-bridge, auth, mqtt, …
│   ├── lib/                        # store, api, auth/JWT, i18n, mockStore,
│   │   └── push-alarm/             #   client + sw-config-store + shared
│   ├── hooks/                      # useApi, useGasHealth, usePushAlarm, …
│   └── sw.ts                       # service worker source (Serwist + push)
├── public/
│   ├── firmware/                   # artefak ESP Web Tools (bin + manifest)
│   ├── manifest.webmanifest · icon-*.png
│   └── sw.js                       # SW hasil build (jangan edit manual)
├── pwa-push-alarm/                 # PWA alarm standalone (lihat §6)
└── next.config.ts · vercel.json · tailwind · tsconfig · vitest · eslint
```

> Catatan sejarah: sebelum migrasi Next.js, repo ini mengirim PWA statis
> (`public/index.html` + `app.js`) — sisa-sisanya dibersihkan oleh
> `sw-legacy-cleanup.tsx` di sisi klien. Aset `public/` sekarang murni
> pendukung aplikasi.
>
> Dokumentasi arsip historis (folder `docs/remediation-2026-08/`) dihapus
> demi struktur ramping — tersedia di riwayat git (commit sebelum
> restukturisasi 2026-09-01); temuan pentingnya terserap ke dokumen ini.

---

## 8. Fitur Utama

- **Dashboard** — kondisi PLTS dalam 5 detik: health, V/I/P baterai, SOC,
  runtime, arus AC, T/H, alarm aktif, freshness.
- **Battery + BMS eksternal (v1.6.0)** — data langsung dari BMS via
  Pylontech CAN / Modbus RTU / Modbus TCP: pack V/I/T, SOH, cell
  min/max/Δ, CCL/DCL, cycle count, fault flags, mismatch BMS-vs-shunt.
  Kartu hanya muncul saat firmware benar-benar melaporkan blok BMS.
- **Badge provenance SOC (v1.6.0)** — kartu SOC menunjukkan ASAL angka:
  `BMS Direct` (hijau) / `Shunt (Coulomb)` (biru) / `OCV Estimate` (amber) /
  `Unknown Source` (merah). Fallback BMS→shunt selalu terlihat.
- **AC Output** — RMS/puncak/rata-rata, kualitas sinyal, daya estimasi
  (ditandai ESTIMATED).
- **Environment** — T/H/titik embun, risiko kondensasi, berlabel jelas
  ambient/enclosure (BUKAN suhu baterai).
- **Energy Analytics** — charge/discharge/netto Wh + Ah + EFC (tanpa metrik
  PV palsu).
- **Calibration Center** — 3-titik tegangan (LOW/NOMINAL/FULL), zero-cal
  ACS712, offset SHT31.
- **Alarm Center** — Active/Acknowledged/Cleared/History; ACK ≠ CLEAR.
- **Diagnostics** — uptime, heap, RSSI, reconnect, boot count, reset reason,
  sensor health.
- **Reports** — harian/mingguan/bulanan + ekspor CSV/JSON.
- **Settings** — konfigurasi device, protokol BMS/inverter (hot-apply tanpa
  reboot), backend, **push alarm**, danger zone (reboot, factory reset).
- **Push-Alarm natif** — notifikasi Web Push terenkripsi walau aplikasi
  ditutup (lihat §5).

## 9. Kualitas & Provenance (disclosure wajib)

Setiap pengukuran menampilkan kualitasnya: **VALID** (hijau) · **DERIVED**
(biru) · **ESTIMATED** (oranye) · **STALE** (kuning) · **INVALID/SENSOR_ERROR**
(merah, nilai N/A — tidak pernah 0).

Kualitas menjawab *seberapa bisa dipercaya*; provenance menjawab *milik siapa
pengukurannya*. Payload firmware ≥ 1.6.0 membawa `battery.soc.provenance`;
firmware lama / baris GAS pra-1.6 diresolve `UNKNOWN` — PWA tidak pernah
menduga-duga antara shunt dan OCV.

## 10. Offline Support

- Service worker riil (Serwist): app shell cache-first, telemetri network-first.
- Telemetri terakhir > 10 s → "OFFLINE — Last seen: Xs lalu"; > 60 s →
  banner STALE.

## 11. Testing & QA

```bash
npm run test         # vitest (truth-semantics + soc-provenance + sysconfig + push-alarm)
npm run typecheck    # tsc --noEmit — 0 error
npm run build        # next build — sukses (standalone)
npm run lint         # eslint — 0 error
```

**Utang lint react-hooks: LUNAS (audit production-grade 2026-08-28).**
Baseline 13 error (11 `set-state-in-effect` + 2 `exhaustive-deps`)
direstrukturisasi dengan pola resmi React, bukan disable komentar —
*adjust state during render*, derived-state, `useSyncExternalStore`,
deferral macrotask, deps presisi. Aturan `react-hooks/*` tetap `error`;
0 error berarti benar-benar bersih. 31 warning kosmetik tersisa
(non-null assertion di parser lama + `no-console` di worker publik).

## 12. Honest Disclosure

- Hardware Acceptance Tests (HW-001..HW-025) **BELUM DIEKSEKUSI** — butuh
  hardware fisik (prosedur: riwayat git + ringkas di panduan PDF).
- Layer BMS multi-protokol v1.6.0 terverifikasi Level 1-2 (kode + mirror
  test + round-trip GAS). Eksekusi bench Level 3 (baterai riil di
  CAN/RS485) **PENDING**.
- Peta register Modbus default adalah **CONTOH** — verifikasi ke dokumen
  register baterai Anda sebelum produksi.
- Audit independen TIDAK DIKLAIM.
- Riwayat perbaikan audit (ringkas): 2026-08-27 — lint pipeline crash
  diperbaiki; 57 error laten; crash Alarm Center diperbaiki via kontrak
  kanonik `{active, history}`; panel BMS mode demo via `deviceConfigOf()`;
  firmware kompanion v1.6.1 menyamakan `GET /api/alarms`. 2026-08-28
  (pra-bench) — login-wall mode GAS → sesi viewer; parser fleet GAS
  envelope nested (`src/lib/gasEnvelope.ts` + 18 asersi regresi);
  `device_key` dikirim pada `LATEST`; simpan `/setup` mode edit tak lagi
  menghapus fleet multi-device; blokir duplikat device_id; clamp interval.
  2026-08-28 (gelombang 2) — 13 error react-hooks tuntas; pruning
  rate-limiter login; hash OTA terikat file terpilih; sesi MQTT
  derived-state. 2026-09-01 — decoder base64url `push-manager.js`
  menormalkan `-`/`_` (versi lama gagal subscribe untuk ~93% kunci VAPID
  acak; mock `atob` harness dikeraskan + asersi regresi).

## 13. Panduan Wiring (ringkas)

Panduan wiring lengkap (keselamatan, spesifikasi kabel, urutan pemasangan
DC/AC, peta bus I²C, daya, port BMS RS485/CAN, checklist pra-daya P1–P10,
tabel kesalahan umum) ada di repo firmware → **README §8**.

Ringkasnya: pembagi tegangan → GPIO 34 · INA219 (0x40) kelvin-clamp di
shunt, SDA 21/SCL 22 · SHT31 (0x44) & DS3231 (0x68) di bus I²C sama ·
ACS712 di fasa L saja → GPIO 35 · RS485 (MAX3485) TX 16/RX 17/DE 4 · CAN
(SN65HVD230) TX 25/RX 26 — terminator 120 Ω dua ujung untuk bus BMS.

## 14. Troubleshooting

| Gejala | Penyebab umum | Fix |
| :--- | :--- | :--- |
| Redirect terus ke `/setup` | `PLTS_SYS_CONFIG` kosong/korup | Ulangi wizard; atau impor ulang JSON backup |
| Handshake gagal (CORS) | Deployment GAS bukan "Anyone" | Redeploy GAS dengan akses Anyone |
| Login LAN 403 di produksi | `JWT_SECRET` kosong / mock auth fail-closed | Perilaku benar — mode GAS Cloud viewer aktif bila profil GAS tersimpan; untuk mutasi set `NEXT_PUBLIC_API_BASE_URL` + login operator |
| Data realtime tidak muncul | Broker MQTT tidak di-set / ESP32 offline | Cek `NEXT_PUBLIC_MQTT_BROKER_URL` + koneksi device |
| Push alarm tidak masuk saat aplikasi ditutup | Izin notifikasi mati / langganan dari aplikasi lain | Cek izin OS+browser; pastikan subscribe dari SATU aplikasi (Bab 2.3 panduan) |
| Notifikasi alarm dobel | Berlangganan dari Next.js DAN PWA standalone | Berhenti berlangganan dari salah satu |
| Badge SOC "Unknown Source" | Firmware < v1.6.0 (memang jujur) | Upgrade firmware; badge merah bukan bug |
| Fleet semua nilai "—" padahal online | device_key di profil ≠ device_key telemetri | Samakan Device Key di `/setup`; cek baris Telemetry di Sheet |
| Fleet 404 untuk device ke-2 dst | device_key tidak terdaftar di tab `Devices` GAS | Tambahkan baris device di sheet `Devices` |
| Tombol `/install` mati | Browser tanpa Web Serial (iOS/Android/Firefox) | Gunakan Chrome/Edge **desktop** |
| Versi firmware di `/install` "tidak diketahui" | `public/firmware/manifest.json` tak terbaca | Pastikan file ada & valid (label fail-closed) |
| Service worker stale saat dev | Cache Serwist lama | `SERWIST_DEV=true npm run dev` + hard reload |

---

**Monitoring-only.** PWA ini tidak menggerakkan relay/aktuator apa pun —
sesuai brief keamanan proyek.

---

## 15. Kontrol Darurat & Aliran Energi (E-WAVE v1.7)

> **Pembaruan kontrak:** sejak firmware-generic v1.6.0 + Code.gs WAVE-7,
> sistem memiliki SATU aktuator — relay darurat fail-safe. Kalimat
> "monitoring-only" di atas tetap benar untuk seluruh telemetri; satu-satunya
> kontrol adalah pemutus darurat (fail-safe by design: mati = terisolasi).

Menu **Kontrol Darurat** (ikon perisai di sidebar) berisi:

- **Status relay darurat** (RUN / TERISOLASI / TIDAK DIKETAHUI), alasan trip
  terakhir (`VBAT_LOW`, `ESTOP`, `OPERATOR`, `BOOT`, `CRASHLOOP`, ...),
  total trip, dan indikator jalur E-stop fisik. Firmware < 1.6.0 → status
  TIDAK DIKETAHUI (jujur, tidak dinebak RUN).
- **Tombol ARM** — satu klik; perangkat mengeksekusi dalam ±15 detik dan
  BOLEH MENOLAK bila pemicu masih aktif / masa pulih belum lewat /
  crash-chain aktif — alasan penolakan tampil di toast.
- **Tombol EMERGENCY STOP** — wajib konfirmasi **mengetik kata `STOP`**;
  sistem terisolasi total (PV, baterai, jenset, beban AC lepas dari
  inverter). Rilis E-stop fisik TIDAK menyalakan ulang — hanya ARM.
- **Editor ambang pemicu** (semua sensor): VBAT rendah/tinggi + histeresis,
  arus DC/beban/jenset maksimum, debounce, masa pulih, pin GPIO —
  dikirim lewat `EMERGENCY_COMMAND/CONFIG`, divalidasi 3 lapis
  (PWA → GAS → firmware), dipersisten di LittleFS perangkat.
- **Diagram Aliran Energi animasi**: PLTS / Baterai / Jenset / Inverter /
  Beban; kecepatan tepi sebanding daya, arah baterai terbalik saat
  mengisi, kanal tak terukur tampil "?" (bukan 0 W), simpul PLTS
  ditandai *inferensi* (daya PV tidak terukur). Menghormati
  `prefers-reduced-motion`. Logika arah dipatok uji
  (`src/lib/__tests__/energyFlow.test.ts`).

**Otorisasi**: perintah darurat membutuhkan **Admin Token** (rahasia
operator = `Config!ADMIN_TOKEN` di sheet GAS) — isikan di halaman
`/setup` (kolom *Admin Token*). Tanpa token: tombol mematikan diri
sendiri dengan pesan jujur (fail-closed). Token perangkat
(`auth_token`) TIDAK cukup untuk ARM/DISARM — domain kepercayaan
terpisah, sama seperti OTA.

**Komponen baru**: `src/components/emergency/` (panel + diagram SVG),
`src/lib/emergency.ts` (klien GAS + skema 12 field),
`src/lib/energyFlow.ts` (model murni), `src/lib/gasEnvelope.ts`
(parser blok `emergency` + `i_ac_gen`), field `admin_token` per perangkat
di `PLTS_SYS_CONFIG`, dan kartu **Arus Jenset → Inverter** di view AC
(hanya tampil bila firmware melaporkan kanal tersebut).

**Wiring darurat + E-stop + ACS712 ganda**: lihat
`docs/wiring/emergency-relay.png` di repo firmware (atau Gambar 3 §8.2
README firmware) dan Bab 7 dokumen *Audit EMI & Ketahanan Noise*.
