// =============================================================================
// Push Alarm — persistensi konfigurasi runtime untuk service worker.
// -----------------------------------------------------------------------------
// Service worker TIDAK BISA membaca localStorage halaman, sementara URL GAS
// Push + kunci publik VAPID bersifat runtime (pola zero-touch: tiap operator
// menempel konfigurasinya sendiri, lihat PLTS_SYS_CONFIG). Solusi: konfigurasi
// disalin ke IndexedDB yang bisa dibaca dari konteks SW maupun halaman.
//
// Halaman  : writePushAlarmConfig() / PushAlarmBridge  -> savePushAlarmRuntimeConfig()
// SW       : resolvePushAlarmConfig() di src/sw.ts     <- loadPushAlarmRuntimeConfig()
// Pesan postMessage PLTS_PUSH_ALARM_CONFIG hanya memperbarui cache memori;
// IndexedDB tetap sumber kebenaran yang bertahan restart SW.
// =============================================================================

import type { PushAlarmConfig } from "./shared";

const DB_NAME = "plts-push-alarm";
const DB_VERSION = 1;
const STORE_NAME = "config";
const RECORD_KEY = "runtime";

function isIndexedDbAvailable(): boolean {
  return typeof indexedDB !== "undefined" && indexedDB !== null;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!isIndexedDbAvailable()) {
      reject(new Error("IndexedDB tidak tersedia di konteks ini"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Gagal membuka IndexedDB"));
    req.onblocked = () => reject(new Error("IndexedDB diblokir tab lain"));
  });
}

function requestToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Operasi IndexedDB gagal"));
  });
}

function sanitize(raw: unknown): PushAlarmConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const apiBase = typeof obj.apiBase === "string" ? obj.apiBase : "";
  const vapidPublicKey = typeof obj.vapidPublicKey === "string" ? obj.vapidPublicKey : "";
  if (!apiBase && !vapidPublicKey) return null;
  return { apiBase, vapidPublicKey };
}

/** Simpan konfigurasi runtime push-alarm (dipanggil dari halaman/SW). */
export async function savePushAlarmRuntimeConfig(config: PushAlarmConfig): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(
        { apiBase: String(config.apiBase || ""), vapidPublicKey: String(config.vapidPublicKey || "") },
        RECORD_KEY,
      );
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Gagal menyimpan konfigurasi push-alarm"));
      tx.onabort = () => reject(tx.error ?? new Error("Transeksi dibatalkan"));
    });
  } finally {
    db.close();
  }
}

/** Ambil konfigurasi runtime push-alarm (dipanggil dari halaman/SW). */
export async function loadPushAlarmRuntimeConfig(): Promise<PushAlarmConfig | null> {
  const db = await openDb();
  try {
    const value = await new Promise<unknown>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(RECORD_KEY);
      void requestToPromise(req).then(resolve, reject);
    });
    return sanitize(value);
  } catch {
    return null;
  } finally {
    db.close();
  }
}

/** Hapus konfigurasi runtime (dipakai saat operator mereset konfigurasi). */
export async function clearPushAlarmRuntimeConfig(): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(RECORD_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Gagal menghapus konfigurasi push-alarm"));
      tx.onabort = () => reject(tx.error ?? new Error("Transeksi dibatalkan"));
    });
  } finally {
    db.close();
  }
}
