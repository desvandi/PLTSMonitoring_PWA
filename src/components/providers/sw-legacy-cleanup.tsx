'use client';

// =============================================================================
// SwLegacyCleanup — penyembuh "SW hijack" era PWA statis (WAVE-7 / PW7-2).
// -----------------------------------------------------------------------------
// Sebelum migrasi Next.js, repo ini mengirim PWA statis (public/index.html +
// app.js + service-worker.js). app.js memanggil
// `navigator.serviceWorker.register('/service-worker.js')` — SW lama itu
// cache-first untuk SEMUA GET same-origin TERMASUK navigasi `/`, sehingga
// klien yang pernah membuka /index.html bisa terkunci pada app shell lama
// (update Next.js tidak pernah terlihat sampai cache dihapus manual).
//
// Komponen ini berjalan sekali per load, best-effort, tanpa pernah gagalkan
// render:
//   1. unregister setiap registration SW yang scriptURL-nya `/service-worker.js`
//   2. hapus CacheStorage era lama (`plts-monitor-v*`)
// SW serwist baru (/sw.js) mendaftar via <SerwistProvider> di layout dan
// clientsClaim() mengambil alih kontrol halaman pada load yang sama.
// =============================================================================

import { useEffect } from 'react';

const LEGACY_SW_PATH = '/service-worker.js';
const LEGACY_CACHE_RE = /^plts-monitor-v/;

export function SwLegacyCleanup(): null {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
    let stopped = false;

    void (async () => {
      try {
        const regs = await navigator.serviceWorker.getRegistrations();
        for (const reg of regs) {
          const rawUrl =
            reg.active?.scriptURL ??
            reg.waiting?.scriptURL ??
            reg.installing?.scriptURL ??
            '';
          if (!rawUrl) continue;
          let path = '';
          try {
            path = new URL(rawUrl, window.location.href).pathname;
          } catch {
            continue;
          }
          // Hanya SW lama. SW serwist (/sw.js) dan SW pihak ketiga dibiarkan.
          if (path === LEGACY_SW_PATH && !stopped) {
            await reg.unregister();
          }
        }
        if (!stopped && 'caches' in window) {
          const keys = await caches.keys();
          await Promise.all(
            keys
              .filter((k) => LEGACY_CACHE_RE.test(k))
              .map((k) => caches.delete(k)),
          );
        }
      } catch {
        // Best-effort — kegagalan cleanup tidak boleh mengganggu aplikasi.
      }
    })();

    return () => {
      stopped = true;
    };
  }, []);

  return null;
}
