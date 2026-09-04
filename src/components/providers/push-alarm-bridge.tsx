'use client';

// =============================================================================
// PushAlarmBridge — jembatan push-alarm <-> aplikasi Next.js.
// -----------------------------------------------------------------------------
// Berjalan sekali per load (best-effort, null-render), tiga tugas:
//   1. Sinkronkan konfigurasi push-alarm efektif ke service worker
//      (IndexedDB + postMessage) agar handler push punya URL GAS terbaru.
//   2. Deep-link dari URL: /?view=alarms&from=push (dibuka service worker
//      saat tidak ada jendela aplikasi yang bisa difokuskan).
//   3. Navigasi via pesan SW: notificationclick memfokus jendela yang ada
//      lalu mengirim PLTS_PUSH_ALARM_OPEN — view dikelola zustand (bukan
//      URL), jadi navigasi lintas-jendela harus lewat postMessage.
// =============================================================================

import { useEffect } from 'react';
import { isViewKey, useUiStore } from '@/lib/store';
import { syncPushAlarmConfigToServiceWorker } from '@/lib/push-alarm/client';

interface SwBridgeMessage {
  type?: string;
  view?: unknown;
}

export function PushAlarmBridge(): null {
  const setView = useUiStore((s) => s.setView);

  useEffect(() => {
    // 1) Sinkronkan konfigurasi ke SW (SW mungkin baru mengambil alih halaman).
    void syncPushAlarmConfigToServiceWorker();

    // 2) Deep-link URL ?view=... (dari notifikasi / bookmark operator).
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get('view');
    if (isViewKey(fromUrl)) {
      setView(fromUrl);
    }

    // 3) Navigasi dari service worker (notificationclick pada jendela aktif).
    const onMessage = (event: MessageEvent<SwBridgeMessage>): void => {
      const data = event.data;
      if (data && data.type === 'PLTS_PUSH_ALARM_OPEN' && isViewKey(data.view)) {
        setView(data.view);
      }
    };
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', onMessage);
    }

    return () => {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener('message', onMessage);
      }
    };
  }, [setView]);

  return null;
}
