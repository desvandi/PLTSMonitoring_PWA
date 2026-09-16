# Vercel Project Matrix — Deployment Governance

> Hasil remediasi audit 2026-09-16 (temuan "3 deployment PWA yang membingungkan"
> + "cleanup obsolete Vercel project").

## Matriks otoritas deployment

| Project Vercel | Fungsi | Root dir | Otoritas production | Status |
|---|---|---|---|---|
| `plts-monitoring-pwa` | Dashboard monitoring canonical (Next.js) | `/` | **YA** — jmse-plts-monitoring.vercel.app | Aktif |
| `plts-monitor-push-alarm` | PWA Push Alarm standalone (statis) | `pwa-push-alarm/` | **YA** — plts-monitor-push-alarm.vercel.app | Aktif (build: `node tools/build-config.js`) |
| ~~`pwa-push-alarm`~~ | ~~Duplikat salah-link (root `/`, men-deploy seluruh Next.js di nama push)~~ | — | **TIDAK** | **DIHAPUS 2026-09-16** (tidak punya domain custom; sisa artefak dari insiden salah-link yang diperbaiki lewat recreate) |

## Alur deployment yang deterministik (satu-satunya jalur)

```
GitHub main (PR + review)
   ↓ CI: lint / typecheck / vitest / lockfile / build
   ↓ CI: production-config gate (a-d) + push-alarm config gate
   ↓ CI: cross-repo firmware manifest sync
   ↓ push ke main → Vercel auto-deploy (kedua project)
   ↓ CI: LIVE deployment smoke test (commit-bound, header, provisioning)
   ↓ tag v* → RELEASE GATE: push alarm WAJIB provisioned penuh
```

Aturan:
- **Tidak ada `vercel deploy` manual dari workstation** untuk production.
  Deployment CLI hanya untuk preview eksperimen (bukan target `production`).
- Environment production diubah HANYA lewat Vercel dashboard/API dengan
  perubahan tercatat (audit trail), bukan lewat file lokal.
- Setiap deployment production harus bisa dibuktikan commit-nya:
  `/api/health` mengekspos `release.commitSha` (VERCEL_GIT_COMMIT_SHA),
  dan `js/config.js` push alarm dicap `APP_BUILD_COMMIT` oleh build.

## Environment variables per project

### plts-monitoring-pwa (Mode B — server-assisted; semua OPTIONAL)

Slot tersedia (saat ini kosong → Mode A browser-configured, dilaporkan
jujur oleh `/api/health` → `deploymentMode.mode`):

- `NEXT_PUBLIC_API_BASE_URL` — URL REST device (Lang/tunnel)
- `NEXT_PUBLIC_MQTT_BROKER_URL` — broker wss:// (TLS wajib, bukan broker publik)
- `NEXT_PUBLIC_MQTT_USERNAME` / `NEXT_PUBLIC_MQTT_PASSWORD`
- `NEXT_PUBLIC_GAS_INSIGHTS_URL` — server-side GAS insights
- `JWT_SECRET` — aktifkan JWT REST mock/demo (non-production saja)
- `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` — revocation store
  global JWT (p.492: tanpa ini, mutasi REST fail-closed di production)

### plts-monitor-push-alarm (WAJIB untuk profil production)

- `PUSH_API_BASE` — URL Web App GAS push (format `/exec`)
- `PUSH_VAPID_PUBLIC_KEY` — kunci publik VAPID (65 byte base64url)
- `PUSH_PROFILE` — `production` | `preview` (default `preview`)

Tanpa env ini + `PUSH_PROFILE=production`, **build gagal** (bukan lagi
artifact placeholder yang tersaji diam-diam). Profil preview menampilkan
layar setup runtime yang jujur.
