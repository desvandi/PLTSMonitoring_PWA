# PROVISIONING — Push Alarm Standalone (plts-monitor-push-alarm)

> Runbook operasional hasil remediasi audit **P0-1** ("production masih
> placeholder"), **p.493** ("device credential persistent di localStorage"),
> dan **P1 testPush** ("rate limit bukan authorization").

## 1. Status kejujuran deployment

Sejak remediasi ini, deployment **tidak lagi bisa gagal secara diam-diam**:

| Kondisi build | Hasil |
|---|---|
| `PUSH_PROFILE=production` + env kosong/placeholder | **Build GAGAL** (`tools/build-config.js` exit 1) |
| Profil preview / tanpa env | Build sukses, `APP_PROVISIONED=false`, aplikasi menampilkan **layar setup** |
| `PUSH_PROFILE=production` + env valid | `config.js` digenerate dengan nilai nyata, `APP_PROVISIONED=true` |

Tidak ada lagi URL `GANTI_DENGAN...` yang tersaji di production. Jika URL
production masih menampilkan layar setup, berarti memang belum diprovision —
itu keadaan yang jujur, bukan bug.

## 2. Arsitektur kredensial (p.493)

```
FW_DEVICE_TOKEN (firmware → GAS ingest)      ← TIDAK PERNAH masuk browser
PUSH_TOKENS       (browser → GAS subscribe)  ← khusus langganan push
```

- **FW_DEVICE_TOKEN / FW_DEVICE_TOKENS** — kredensial ingest firmware ke GAS.
  Tetap di firmware/GAS Script Properties. Tidak dipakai PWA.
- **PUSH_TOKENS** — JSON array `[{ "deviceId": "...", "token": "..." }]` di
  GAS Script Properties. Kapabilitas TERBATAS: `subscribe`, `unsubscribe`,
  `testPush`. TIDAK bisa `ingest`. Kompromi PWA push ≠ kompromi ingest.
- Penyimpanan di browser: **sessionStorage saja** (hidup selama sesi tab),
  dikirim ke service worker hanya via `postMessage` (memori SW, tidak
  dipersist). localStorage `push.deviceId`/`push.deviceToken` lama
  dimigrasikan sekali lalu dihapus.

## 3. Langkah provisioning produksi

### 3.1 Siapkan backend GAS (push service)

1. Deploy `push-alarm/gas/Code.gs` + `WebPushCore.gs` (repo firmware) ke
   Apps Script — atau gunakan backend **canonical** `code.gs/` yang kini
   memiliki modul push setara (aksi `PUSH_SUBSCRIBE`/`PUSH_UNSUBSCRIBE`/
   `PUSH_ACK`/`PUSH_ALARM_INGEST`, autentikasi HMAC/token, outbox durable).
   Satu trust boundary canonical adalah target arsitektur akhir.
2. Script Properties GAS:
   - `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (hasil
     `tools/generate-vapid-keys.js`)
   - `FW_DEVICE_TOKEN` atau `FW_DEVICE_TOKENS` (ingest firmware — sudah ada)
   - `PUSH_TOKENS` = `[{"deviceId":"<ID>","token":"<token-push-acak>"}]`
     (buat token acak panjang, mis. `openssl rand -hex 32`)
3. Deploy Web App: Execute as **Me**, Access **Anyone** (tetap aman: semua
   mutasi membutuhkan token; `testPush` publik sudah DINONAKTIFKAN default —
   aktif hanya bila `TEST_PUSH_ALLOW_PUBLIC='true'`).

### 3.2 Set environment Vercel (project `plts-monitor-push-alarm`)

```
PUSH_API_BASE          = https://script.google.com/macros/s/<ID>/exec
PUSH_VAPID_PUBLIC_KEY  = <public key base64url 65 byte>
PUSH_PROFILE           = production   (untuk target production)
```

Tanpa env ini, deployment preview tetap jalan dengan layar setup; profil
production akan **gagal build** dengan pesan eksplisit.

### 3.3 Bangun & verifikasi

- Build command project (sudah dikonfigurasi): `node tools/build-config.js`
- Verifikasi pra-deploy: `node tools/verify-deployment.js` (profil mengikuti
  `PUSH_PROFILE`).
- Pasca-deploy, smoke test CI otomatis memeriksa config live: tidak boleh
  ada placeholder; `APP_PROVISIONED` harus konsisten dengan profil.

### 3.4 Provisioning per perangkat operator

Operator membuka PWA → layar setup (atau tombol "Pengaturan / Provisioning")
→ isi URL GAS, VAPID public key, Device ID, push token → simpan. Nilai hidup
selama sesi browser; menutup tab menghapus kredensial (by design, p.493).

## 4. Batasan yang disengaja

- Kredensial hilang saat tab ditutup → operator mengisi ulang di sesi baru.
  Ini trade-off keamanan yang diminta auditor ("session/in-memory only").
- `pushsubscriptionchange` di SW hanya bisa re-registrasi bila halaman pernah
  mengirim kredensial ke SW pada sesi berjalan (SW dingin = batal, jujur).
- CI pada `main` mengizinkan status "not provisioned" (honest setup screen);
  **release gate (tag v\*)** mewajibkan provisioned penuh.
