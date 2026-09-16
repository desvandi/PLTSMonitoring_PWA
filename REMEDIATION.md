# REMEDIATION.md — Audit p.477–p.491 (PWA)

> Baseline audit: commit `5c3e2c2` (PR #14). Dokumen ini adalah respons engineer
> eksekutor atas seluruh temuan auditor pada sisi PWA, termasuk dua temuan P1
> baru pada compatibility gate (p.477/p.478) dan residual auth/push/CSP/token
> storage. Setiap perbaikan menyebut titik temu, mekanisme perbaikan, dan
> verifikasi.

## Ringkasan status

| Point | Temuan | Severity | Status | Bukti verifikasi |
|---|---|---|---|---|
| p.477 | Malformed firmware version diterima (compareVersions → 0) | 🔴 P1 | ✅ FIXED | `compatibility.test.ts` (+13 kasus malformed) |
| p.478 | protocolVersion/configSchemaVersion null dianggap kompatibel | 🔴 P1 | ✅ FIXED | `compatibility.test.ts` (null/undefined/unparseable) |
| p.479 | JWT revocation process-local (multi-instance Vercel) | 🟠 P2 | ✅ FIXED (shared store; fallback terdokumentasi) | `revocation-store.ts` + `.env.example` |
| p.480 | admin_token plaintext di body GAS | 🟡 P3 | ✅ MITIGATED (transport ketat; residual platform GAS terdokumentasi) | `gasFetch.ts` |
| p.481 | CSP `unsafe-inline`; XFO SAMEORIGIN; frame-ancestors self | 🟠 P2/P3 | ✅ FIXED script-src (nonce); style-src = residual terdokumentasi | curl produksi lokal: 25 script ber-nonce, 0 tanpa nonce |
| p.482 | Push ACK tanpa autentikasi (alarmId saja) | 🟠 P2 | ✅ FIXED (ackToken HMAC; kontrak GAS di repo firmware) | `verify-ack-token.js` 12/12 PASS |
| p.483 | auth_token di localStorage | 🟡 P3 | ✅ FIXED (sessionStorage + migrasi) | `auth-token-session.test.ts` |
| p.484 | Desktop sidebar bypass role gate; render switch tanpa role check | 🟠 P2 | ✅ FIXED (otorisasi terpusat + render guard) | `view-authorization.test.ts` |
| p.485a | Logout saat MQTT aktif tidak revoke REST session | 🔴 P1 | ✅ FIXED | `auth-provider.tsx` logout() |
| p.485b | Emergency view tidak operator-only | 🟠 P2 | ✅ FIXED (+ role check di command layer) | `view-authorization.test.ts` |
| p.486 | Manual OTA tanpa metadata SHA/signature/version | 🔴 P1 | ✅ FIXED (pipeline identik canonical) | `device-api-guard.test.ts` |
| p.487 | MQTT schema validation dangkal; tanpa binding device-id | 🟠 P2 | ✅ FIXED | `mqtt.ts` validator ketat + binding topik |
| p.488 | Mutation compatibility guard fail-open | 🔴 P1 | ✅ FIXED (assertMutationAllowed) | `device-api-guard.test.ts` (11 mutasi) |
| p.486-old | MQTT credentials di NEXT_PUBLIC bundle | 🟠 P2 | ✅ FIXED (route terautentikasi + fallback terdokumentasi) | `/api/mqtt/credentials` 401 tanpa sesi |
| p.488-old | GAS endpoint dipercaya bebas; redirect:follow ber-credential | 🟠 P2 | ✅ FIXED (allowlist + redirect:error) | `gas-fetch.test.ts` |
| p.490-old | GAS viewer session dari keberadaan config | 🟠 P2 | ✅ FIXED (sesi hanya setelah PING sukses) | `auth-provider.tsx` refresh() |
| p.491-old | SW menerima config runtime tanpa revalidasi | 🟡 P3 | ✅ FIXED (sanitizer ketat di SW boundary) | `sw-config-store.ts` |
| — | PWA production tidak mengikuti kontrak firmware HEAD | 🔴 | ✅ FIXED | `normalizeFirmwareInfo()` + test lintas-layer |

## Perbaikan mendetail

### p.477 + p.478 — Compatibility gate fail-closed (`src/lib/compatibility.ts`)

- `evaluateCompatibility()` sekarang mem-parse versi firmware PERTAMA; string
  rusak/kosong → status `unknown`, `canViewTelemetry=false`,
  `canControlRelays=false`. `compareSemVer()` hanya menerima tuple yang sudah
  ter-parse — "unparsable" tidak pernah dibandingkan "sama dengan" batas lagi
  (bug lama: `compareVersions()` mengembalikan `0` saat parse gagal).
- `protocolVersion`/`configSchemaVersion` bernilai null, undefined, atau tidak
  bisa diparse → `protocol_mismatch`/`config_schema_mismatch` — **"kontrak
  belum terverifikasi" tidak pernah dipromosikan menjadi "kompatibel"**.
  Firmware melaporkan kedua field sejak commit pertama (76b6f7f), jadi
  ketidakhadirannya adalah pelanggaran kontrak, bukan perangkat legacy —
  tidak ada jalur legacy implisit.
- Input protocol/schema kini menerima `number | string` (ArduinoJson
  menserialisasi konstanta versi sebagai STRING `"1"`).

### Kontrak lintas-layer — `normalizeFirmwareInfo()`

Endpoint `/api/version` firmware mengirim kunci `firmwareVersion`/
`configVersion` dengan nilai string; mock PWA memakai `currentVersion`/
`configSchemaVersion` dengan number. `deviceApi.version()` sekarang
menormalisasi KEDUA bentuk sehingga gate mengevaluasi kontrak perangkat
NYATA (temuan pertama auditor: "PWA production belum mengikuti firmware HEAD
terbaru"). `FirmwareInfo.protocolVersion`/`configSchemaVersion` dilebarkan
menjadi `number | null`.

### p.488 — Guard mutasi generik (`src/lib/deviceApi.ts`)

`assertMutationAllowed(operation)` fail-closed pada dua kondisi (snapshot
null = belum terverifikasi; `canViewTelemetry=false` = kontrak tak
kompatibel) dan kini dijalankan SEBELUM `deviceRequest()` oleh SEMUA mutasi:
`updateConfig`, `updateCalibration`, `voltageCalibrationPoint`,
`acs712ZeroCal`, `acknowledgeAlarm`, `reboot`, `factoryResetPrepare`,
`factoryResetConfirm`, `updateDevice`, `changePassword`, `importConfig`,
`otaUpload`. Relay tetap memakai `assertRelayCommandAllowed()` (lebih ketat:
`canControlRelays`). Semua mutasi kini `async` agar guard throw menjadi
rejected promise (aman untuk semua gaya pemanggil).

### p.486 — Manual OTA = standar keamanan tunggal

- `deviceApi.otaUpload()` menolak upload tanpa `meta`
  (X-Expected-SHA256/X-Signature/X-Firmware-Version) sebelum byte pertama
  keluar — kecuali `NEXT_PUBLIC_DEMO_MODE=true` (target mock semata).
- `OtaView`: memilih file .bin → SHA-256 dihitung otomatis; operator wajib
  mengisi versi (strict SemVer) + signature Ed25519 (128 hex, bisa dari file
  .sig). Tombol "Upload (signed)" terkunci sampai metadata valid.

### p.485a — Logout = terminasi sesi SEMUA transport

`logout()` di `auth-provider.tsx` tidak lagi early-return saat MQTT aktif:
`api.logout()` (revoke JWT server-side via shared store) + `setCsrfToken(null)`
SELALU berjalan bila sesi REST operator ada. Skenario audit (REST login →
MQTT connect → logout → refresh → authenticated) tertutup.

### p.484 + p.485b — Otorisasi view terpusat

- `src/lib/view-authorization.ts` = satu sumber kebenaran
  (`OPERATOR_ONLY_VIEWS` kini memuat `emergency`).
- Desktop sidebar memakai gate yang sama dengan mobile (`canOpenView` +
  disabled + title penjelasan).
- `page.tsx` membungkus keenam view operator-only dengan
  `OperatorViewGuard` — **render-level** boundary: viewer yang mencapai
  `currentView` operator (zustand persist, manipulasi store, tab basi)
  mendapat panel ACCESS-DENIED; komponen view tidak pernah mount.
- `EmergencyControlView.runCommand()` menolak membentuk payload darurat untuk
  sesi viewer (defense-in-depth di atas ADMIN_TOKEN).

### p.479 — Revocation shared store (`src/lib/revocation-store.ts`)

- Upstash Redis REST (env `UPSTASH_REDIS_REST_URL`/`_TOKEN`) — tanpa
  dependensi baru (plain fetch), kunci `plts:revoked:<jti>` dengan EXPIRE
  sampai exp JWT. Logout pada instance A berlaku GLOBAL.
- Tanpa env → fallback process-local + warning sekali (semantik
  single-instance, residual terdokumentasi di `.env.example`).
- Kebijakan availabilitas: kegagalan Redis pada jalur BACA fail-open dengan
  error log (window revocation dibatasi SESSION_TTL ≤ 1 jam); kegagalan
  WRITE dicatat jelas.

### p.482 — Push ACK ber-kapabilitas kriptografis

- Payload notifikasi kini membawa `ackToken` =
  HMAC-SHA256(PUSH_ACK_SECRET, alarmId|bucket-6jam) yang diterbitkan GAS
  PushService bersama notifikasi (terenkripsi end-to-end oleh push service).
- `sw.ts` + `pwa-push-alarm/sw.js` mengirim `ackToken` bersama ACK.
- Kontrak GAS (`push-alarm/gas/Code.gs` di repo firmware): `ackAlarm` tanpa
  token valid DITOLAK (fail-closed); escape hatch legacy hanya via Script
  Property `PUSH_ACK_ALLOW_LEGACY='true'`. Verifikasi: 12/12 PASS.
- **Urutan deployment yang aman**: PWA dulu (SW baru mengirim token; GAS lama
  mengabaikan field tambahan), lalu redeploy GAS. Setelah GAS baru aktif,
  ACK tanpa token ditolak.

### p.483 — auth_token pindah ke sessionStorage

`lib/authTokenSession.ts` (pola `adminTokenSession.ts`): `PLTS_SYS_CONFIG` di
localStorage kini bebas token; blob lama dimigrasi otomatis saat dibaca;
tampilan in-memory me-resolve token dari session store (konsumen tidak
berubah). Trade-off terdokumentasi: restart browser → operator mengetik token
sekali per sesi.

### p.488-old + p.480 — Trust boundary GAS (`src/lib/gasFetch.ts`)

- Allowlist ketat: `script.google.com`, `script.googleusercontent.com` (+ env
  `NEXT_PUBLIC_GAS_ALLOWED_HOSTS` untuk mirror self-hosted). Validasi URL
  penuh (new URL), tolak kredensial-tersemat (user:pass@), port non-standar,
  panjang > 2048. localhost http hanya di luar produksi.
- `redirect: 'error'` untuk SEMUA panggilan GAS ber-credential
  (`emergency.ts`, `gasEnvelope.ts`, `useFleetStatus.ts`, OTA_LOG,
  `pingGasEndpoint`) — body ber-token tidak pernah mengikuti redirect
  lintas-origin.
- p.480: token tetap di body (batasan platform GAS — Apps Script tidak bisa
  membaca header kustom), tetapi kini hanya dikirim ke host ter-allowlist,
  tanpa redirect, dan pesan error di-redaksi. Residual terdokumentasi.

### p.487 — Validitas & keaslian MQTT (`src/lib/mqtt.ts`)

- Validator status ketat: timestamp finite + ter-bounds (≥2020, ≤ now+10m);
  `battery.voltage` wajib hadir sebagai objek ber-`value` (value boleh null —
  serializer firmware NaN-safe); `current.value` null/finite; `soc.value`
  0..100. `{timestamp:123456789, battery:{}}` kini ditolak.
- **Binding device-id**: pesan diterima hanya dari topik `plts/<deviceId>/…`
  yang DISUBSCRIBE sesi ini; `deviceId` dalam envelope harus cocok dengan
  deviceId sesi (tolak spoof lintas perangkat).
- `/log` divalidasi (timestamp bounded + type/message string) sebelum cast.

### p.486-old — Kredensial MQTT keluar dari bundle publik

`/api/mqtt/credentials` menyajikan pasangan `MQTT_USERNAME`/`MQTT_PASSWORD`
hanya untuk sesi terautentikasi; `resolveMqttCredentials()` memakainya lebih
dulu dengan fallback ke pasangan `NEXT_PUBLIC_*` (kompatibilitas deployment
viewer-only tanpa login PWA — terdokumentasi sebagai
"PUBLIC BY CONSTRUCTION, wajib read-only ACL").

### p.481 — CSP nonce-based (`src/middleware.ts` + `vercel.json`)

- `script-src 'self' 'nonce-<per-request>' https://va.vercel-scripts.com`
  — `unsafe-inline` HILANG dari script-src. Next menerapkan nonce ke
  bootstrap/flight script-nya sendiri (root layout kini `force-dynamic`
  karena shell statis mustahil membawa nonce per-request); nonce diteruskan
  ke next-themes untuk script anti-FOUC.
- `frame-ancestors 'none'` + `X-Frame-Options: DENY` (tidak ada kebutuhan
  embedding).
- **Residual terdokumentasi (P3)**: `style-src 'unsafe-inline'` dipertahankan
  untuk CSS custom property dinamis pada `chart.tsx` (shadcn chart theming) —
  risiko style-injection jauh lebih rendah dari script-injection; refactor ke
  constructable stylesheet menjadi backlog.

### p.490-old — Semantik sesi GAS viewer

`GAS_CLOUD_SESSION` hanya diberikan setelah `pingGasEndpoint()` sukses saat
refresh — "punya config yang valid" ≠ "terautentikasi ke GAS". Kegagalan PING
meninggalkan pengguna tidak terautentikasi dengan error jujur.

### p.491-old — SW revalidasi konfigurasi

`sanitizePushAlarmConfig()` (GAS URL format ketat + VAPID 65-byte) berjalan
di batas SW sebelum cache/persist/use: rantai kini
input → validate (page) → persist → **SW revalidate** → use.

## Verifikasi

- `npx tsc --noEmit` — clean.
- `npx eslint .` — 0 error (warning pre-existing: non-null assertions).
- `npx vitest run` — **260/260 PASS** (+59 test baru: malformed version,
  null protocol, lintas-layer, 11 guard mutasi, OTA metadata, allowlist GAS,
  otorisasi view, auth-token session).
- `npm run build` — sukses; verifikasi runtime server standalone produksi:
  CSP nonce di respons (25 script ber-nonce, 0 inline tanpa nonce),
  `/api/mqtt/credentials` 401 tanpa sesi, health OK.
- GAS ackToken: harness VM 12/12 PASS (`scripts/verify-ack-token.js` di
  environment engineer; kontrak di `push-alarm/gas/Code.gs` repo firmware).

## Residual (jujur, terdokumentasi)

1. `style-src 'unsafe-inline'` (chart theming) — P3, backlog refactor.
2. Token GAS tetap di body request — batasan platform Apps Script; mitigasi
   allowlist + no-redirect + redaksi error (p.480).
3. Revocation Redis bersifat opsional via env — tanpa Upstash, fallback
   process-local (p.479, satu instance).
4. MQTT fallback `NEXT_PUBLIC_*` untuk mode viewer tanpa login — wajib
   broker ACL read-only (terdokumentasi di `.env.example`/SECURITY).
5. Kredensial MQTT server-side membutuhkan setelan env baru
   (`MQTT_USERNAME`/`MQTT_PASSWORD`) di Vercel oleh operator.

## Catatan deployment operator (Vercel)

- Setelan env baru (opsional namun disarankan): `UPSTASH_REDIS_REST_URL`,
  `UPSTASH_REDIS_REST_TOKEN`, `MQTT_USERNAME`, `MQTT_PASSWORD`.
- Setelah PWA ter-deploy: redeploy GAS PushService (repo firmware,
  `push-alarm/gas/Code.gs`) agar kontrak ackToken aktif — deploy PWA dulu,
  GAS kemudian (kompatibel dua arah selama transisi).

## Self-Audit 2026-09-16 (pra-audit final) — kontrak GAS K-7 pada push-alarm

Ditemukan & diperbaiki SEBELUM auditor masuk: kontrak `subscribe` GAS
(audit-2 K-7) mewajibkan `device.id` + `token`, tetapi registrasi push PWA
tidak mengirimkannya — setelah GAS di-redeploy sesuai catatan operator,
tombol "Aktifkan notifikasi" akan ditolak. Perbaikan menyeluruh:

1. **`src/lib/push-alarm/shared.ts`** — `buildSubscriptionBody()`: pembangun
   payload murni + tipe `PushDeviceCredentials` (unit-testable).
2. **`src/lib/push-alarm/client.ts`** — `resolveActiveDeviceCredentials()`
   (perangkat aktif dari PLTS_SYS_CONFIG + token sesi); payload subscribe/
   unsubscribe membawa `device:{id}` + `token`; `enablePushAlarm()` gagal
   cepat SEBELUM meminta izin notifikasi bila kredensial tidak tersedia.
3. **`src/sw.ts` + bridge** — kredensial diteruskan ke SW via
   `PLTS_PUSH_ALARM_DEVICE_CREDENTIALS` (HANYA memori SW, tidak dipersist —
   postur p.483 dipertahankan); `resubscribePushAlarm()` membawa kredensial,
   dan batal fail-closed saat SW dingin tanpa kredensial (mencegah keadaan
   "berlangganan" palsu yang diam-diam tidak menerima apa pun).
   `authTokenSession` memancarkan `plts:auth-tokens-changed` agar bridge
   mengirim ulang kredensial saat login/logout.
4. **`pwa-push-alarm/` (deployment standalone)** — push-manager.js, sw.js,
   app.js, config.js membawa kontrak yang sama (kredensial via localStorage
   `push.deviceId`/`push.deviceToken` atau `APP_CONFIG.DEVICE_ID/TOKEN`).

Verifikasi: 265/265 vitest (+5 regresi K-7), tsc bersih, eslint 0 error,
audit silang PWA-GAS-FW 164/164 (K-7 positif + negatif: subscribe/unsubscribe
tanpa/salah token DITOLAK).
