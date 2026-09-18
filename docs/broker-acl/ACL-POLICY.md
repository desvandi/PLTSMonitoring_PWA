# Broker MQTT — Kebijakan ACL & Prosedur Verifikasi (Gate 7 / F8 / F9)

Status: **ACL ENFORCEMENT BELUM TERVERIFIKASI terhadap broker produksi.**
Dokumen ini adalah artefak kebijakan + prosedur verifikasi yang WAJIB
dijalankan terhadap akun HiveMQ Cloud nyata SEBELUM MQTT diaktifkan di
jalur produksi. Sesuai disiplin anti-false-closure: application metadata
(scope marker `viewer:read:plts/#` yang dikembalikan
`/api/mqtt/credentials`) BUKAN bukti broker enforcement.

## 1. Kebijakan broker per-kredensial (audit F8 "Required broker policy")

Topik mengikuti kontrak firmware/PWA: `plts/<deviceId>/...`

### Kredensial perangkat ESP32 (device credential)

| Aksi     | Topik yang DIIZINKAN                                     |
|----------|----------------------------------------------------------|
| PUBLISH  | `plts/<deviceId>/status`                                  |
| PUBLISH  | `plts/<deviceId>/log`                                     |
| PUBLISH  | `plts/<deviceId>/online` (retain + LWT)                   |
| PUBLISH  | `plts/<deviceId>/ack`                                     |
| PUBLISH  | `plts/<deviceId>/ota/event`                               |
| SUBSCRIBE| `plts/<deviceId>/config`                                  |
| SUBSCRIBE| `plts/<deviceId>/ota`                                     |

### Kredensial viewer PWA (read-only)

| Aksi     | Topik yang DIIZINKAN                                     |
|----------|----------------------------------------------------------|
| SUBSCRIBE| `plts/<deviceId>/status`                                  |
| SUBSCRIBE| `plts/<deviceId>/log`                                     |
| SUBSCRIBE| `plts/<deviceId>/online`                                  |

### Dilarang untuk SEMUA kredensial di atas

- viewer melakukan PUBLISH apa pun (termasuk topik miliknya sendiri)
- viewer SUBSCRIBE perangkat lain (`plts/<otherId>/#`)
- viewer SUBSCRIBE wildcard armada (`plts/#`)
- device SUBSCRIBE/PUBLISH topik perangkat lain
- wildcard fleet write dalam bentuk apa pun

## 2. Matriks acceptance (dijalankan otomatis oleh `scripts/broker-acl-test.mjs`)

| ID | Skenario                                        | Ekspektasi |
|----|-------------------------------------------------|------------|
| T0 | CONNECT dengan password salah                   | DITOLAK (auth fail-closed) |
| T1 | viewer SUB `plts/A/{status,log,online}`         | GRANTED (3 topik) |
| T2 | viewer SUB `plts/B/status`                      | DENIED (SUBACK 0x80 / close) |
| T2b| viewer SUB `plts/#`                             | DENIED |
| T3 | viewer PUB canary vs device PUB canary          | canary viewer TIDAK ter-deliver; canary device TER-deliver (kontrol positif) |
| T4 | device SUB `plts/A/{config,ota}`                | GRANTED (2 topik) |
| T5 | device SUB `plts/B/config`                      | DENIED |
| T6 | device PUB `plts/A/{status,log,online}`         | ter-deliver ke viewer; `{ack,ota/event}` tanpa error broker |
| T7 | device PUB `plts/B/status` (cross-device write) | disconnect/error = DENY terkonfirmasi; silent drop = UNCONFIRMED (limitasi observabilitas — butuh kredensial observer device-B; tidak dihitung FAIL) |

Harness sudah divalidasi dua arah (evidence lokal, 2026-09-18):

- **Kontrol positif** — broker yang menerapkan kebijakan F8 secara tepat
  (simulator aedes): 16/16 PASS, exit 0.
- **Kontrol negatif** — broker TANPA otorisasi: harness mendeteksi
  T0/T2/T2b/T3/T5 sebagai FAIL (auth fail-open, kebocoran cross-device read,
  wildcard fleet, viewer write, permukaan command injection), exit 1.
  Kontrol negatif yang gagal-dideteksi membuktikan harness TIDAK BUTA.

## 3. Cara menjalankan

### Lokal (operator dengan akses akun HiveMQ)

```bash
node scripts/broker-acl-test.mjs \
  --url wss://<broker-host>:8884/mqtt \
  --viewer-user <viewer-username> --viewer-pass <viewer-password> \
  --device-user <device-username> --device-pass <device-password> \
  --device-id <deviceId> [--other-device-id <deviceIdLain>]
```

Skema yang didukung: `wss://` (443/8884), `mqtts://` (8883), `mqtt://`
(hanya untuk pengujian lokal). Exit 0 = matriks lolos.

### CI (GitHub Actions, workflow_dispatch)

Workflow `broker-acl-live` menjalankan matriks yang sama terhadap broker
nyata. Provision secrets repo berikut, lalu dispatch:

| Secret | Isi |
|--------|-----|
| `BROKER_ACL_TEST_URL` | URL broker (mis. `wss://...:8884/mqtt`) |
| `BROKER_ACL_VIEWER_USER` / `BROKER_ACL_VIEWER_PASS` | kredensial viewer device-A |
| `BROKER_ACL_DEVICE_USER` / `BROKER_ACL_DEVICE_PASS` | kredensial device-A |

Jika secrets belum diprovision, job GAGAL dengan pesan eksplisit (keadaan
jujur), bukan silently skipped.

## 4. Konfigurasi HiveMQ Cloud

- **Serverless**: aktifkan RBAC, buat satu user per perangkat + satu user
  viewer per perangkat; terapkan allow-list persis tabel §1 (TANPA wildcard
  kecuali yang tercantum). Catatan: Serverless TIDAK mendukung JWT/mTLS.
- **Starter ke atas**: gunakan advanced authorization / role-based policy
  dengan prinsip yang sama; JWT/mTLS diaktifkan bila tersedia.

## 5. Tier broker (audit F9 — keputusan migrasi)

| Fase | Tier | Syarat |
|------|------|--------|
| Development | HiveMQ Serverless Free | memadai |
| Pilot / controlled field test | Serverless Free | <100 koneksi konkuren, ACL ketat (§1 terverifikasi §2), konsekuensi rendah, tanpa kebutuhan SLA |
| **Produksi (target audit)** | **HiveMQ Cloud Starter minimum** | 10.000 koneksi, HA/clustering, advanced RBAC, JWT, client certificate, SLA 99,95% |

Peningkatan tier memerlukan pemilik akun HiveMQ (di luar kendali repositori)
— dicatat sebagai item terbuka pada Gate 7 sampai dieksekusi.

## 6. Limitasi jujur

1. T7 (cross-device write deny) hanya punya bukti langsung bila broker
   memutus koneksi/mengembalikan error; silent-drop memerlukan kredensial
   observer sisi perangkat-B untuk dibuktikan non-delivery-nya.
2. Peningkatan tier (F9) adalah tindakan operator, bukan perubahan kode.
3. Deployment produksi saat ini berjalan dengan `mqttBrokerConfigured=false`
   (fail-closed) — MQTT belum aktif di jalur produksi hingga §2 hijau
   terhadap broker produksi dan keputusan tier §5 diambil.
