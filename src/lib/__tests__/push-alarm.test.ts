// =============================================================================
// Unit test push-alarm (integrasi Web Push ke aplikasi Next.js utama).
// -----------------------------------------------------------------------------
// Menguji modul murni src/lib/push-alarm/shared.ts (dipakai halaman + SW),
// guard view store untuk deep-link, dan REGRESI STRUKTURAL src/sw.ts:
// handler push/notificationclick/pushsubscriptionchange wajib terpasang —
// tanpa itu alarm saat aplikasi tertutup mati senyap (kontrak K4/K6).
// =============================================================================

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  ALARM_VIEW_TARGET,
  alarmTitleOf,
  buildAlarmNotificationOptions,
  decodeVapidPublicKey,
  isValidGasWebAppUrl,
  urlBase64ToUint8Array,
  validatePushAlarmConfig,
  type AlarmNotificationContext,
} from '@/lib/push-alarm/shared';
import { isViewKey, VIEW_KEYS } from '@/lib/store';

const CTX: AlarmNotificationContext = {
  apiBase: 'https://script.google.com/macros/s/TESTID/exec',
  iconUrl: '/icon-192.png',
  badgeUrl: '/favicon-32.png',
  targetUrl: ALARM_VIEW_TARGET,
};

/** Bandingkan dengan decoder resmi Node (Buffer) sebagai orakel. */
function nodeBase64(s: string): Uint8Array {
  const normalized = s.replace(/-/g, '+').replace(/_/g, '/');
  return new Uint8Array(Buffer.from(normalized, 'base64'));
}

function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

describe('urlBase64ToUint8Array', () => {
  it('decode base64url tanpa padding identik dengan decoder Node', () => {
    const raw = new Uint8Array([0x04, ...Array.from({ length: 64 }, (_, i) => (i * 7 + 3) & 0xff)]);
    const encoded = toBase64Url(raw);
    expect(urlBase64ToUint8Array(encoded)).toEqual(nodeBase64(encoded));
  });

  it('menangani base64 standar (+, /) dan padding', () => {
    const raw = new Uint8Array([1, 2, 3, 4, 5, 250, 251, 252]);
    const stdB64 = Buffer.from(raw).toString('base64'); // bisa mengandung +, /, =
    expect(urlBase64ToUint8Array(stdB64)).toEqual(raw);
  });

  it('string kosong menghasilkan array kosong', () => {
    expect(urlBase64ToUint8Array('').length).toBe(0);
  });

  it('fuzz: 300 vektor acak identik dengan decoder Node (panjang & byte acak)', () => {
    // Regresi: polyfill pernah membuang karakter base64url '-'/'_' (byte hilang
    // diam-diam) dan meluapkan akumulator 32-bit. Orakel Buffer menangkap keduanya.
    let seed = 42;
    const rand = (): number => {
      // PRNG deterministik (mulberry32) — hasil uji stabil antar-run.
      seed = (seed + 0x6d2b79f5) | 0;
      let t = seed;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    for (let iter = 0; iter < 300; iter++) {
      const len = Math.floor(rand() * 100);
      const raw = new Uint8Array(len);
      for (let i = 0; i < len; i++) raw[i] = Math.floor(rand() * 256);
      const encoded = toBase64Url(raw);
      const decoded = urlBase64ToUint8Array(encoded);
      expect(decoded.length).toBe(len);
      expect(Array.from(decoded)).toEqual(Array.from(raw));
    }
  });
});

describe('decodeVapidPublicKey', () => {
  it('menerima kunci 65 byte prefiks 0x04 (titik P-256 tak terkompresi)', () => {
    const key = new Uint8Array(65);
    key[0] = 0x04;
    expect(decodeVapidPublicKey(toBase64Url(key))).toEqual(key);
  });

  it('menolak panjang salah (64/66 byte)', () => {
    const short = new Uint8Array(64);
    short[0] = 0x04;
    const long = new Uint8Array(66);
    long[0] = 0x04;
    expect(decodeVapidPublicKey(toBase64Url(short))).toBeNull();
    expect(decodeVapidPublicKey(toBase64Url(long))).toBeNull();
  });

  it('menolak prefiks bukan 0x04 (terkompresi/terformat salah)', () => {
    const compressed = new Uint8Array(65);
    compressed[0] = 0x02;
    expect(decodeVapidPublicKey(toBase64Url(compressed))).toBeNull();
  });

  it('menolak input kosong/bukan string', () => {
    expect(decodeVapidPublicKey('')).toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(decodeVapidPublicKey(null as any)).toBeNull();
  });
});

describe('isValidGasWebAppUrl', () => {
  it('menerima URL Web App GAS valid', () => {
    expect(isValidGasWebAppUrl('https://script.google.com/macros/s/AKfycbxABC123_-/exec')).toBe(true);
    expect(isValidGasWebAppUrl('  https://script.google.com/macros/s/AKfycbxABC123_-/exec ')).toBe(true);
  });

  it('menolak http, host salah, tanpa /exec, dan googleusercontent', () => {
    expect(isValidGasWebAppUrl('http://script.google.com/macros/s/AKfycbxABC/exec')).toBe(false);
    expect(isValidGasWebAppUrl('https://evil.example.com/macros/s/AKfycbxABC/exec')).toBe(false);
    expect(isValidGasWebAppUrl('https://script.google.com/macros/s/AKfycbxABC/dev')).toBe(false);
    expect(isValidGasWebAppUrl('https://script.googleusercontent.com/macros/s/x/exec')).toBe(false);
    expect(isValidGasWebAppUrl('')).toBe(false);
  });
});

describe('validatePushAlarmConfig', () => {
  const key = (() => {
    const k = new Uint8Array(65);
    k[0] = 0x04;
    return toBase64Url(k);
  })();

  it('konfigurasi valid lolos', () => {
    const res = validatePushAlarmConfig({
      apiBase: 'https://script.google.com/macros/s/AKfycbxABC/exec',
      vapidPublicKey: key,
    });
    expect(res.ok).toBe(true);
  });

  it('URL salah dilaporkan pada field apiBase', () => {
    const res = validatePushAlarmConfig({ apiBase: 'https://contoh.com/exec', vapidPublicKey: key });
    expect(res.ok).toBe(false);
    expect(res.field).toBe('apiBase');
  });

  it('kunci salah dilaporkan pada field vapidPublicKey', () => {
    const res = validatePushAlarmConfig({
      apiBase: 'https://script.google.com/macros/s/AKfycbxABC/exec',
      vapidPublicKey: 'bukan-kunci',
    });
    expect(res.ok).toBe(false);
    expect(res.field).toBe('vapidPublicKey');
  });
});

describe('buildAlarmNotificationOptions', () => {
  it('severity critical: renotify + requireInteraction + vibrate panjang + ackUrl', () => {
    const opts = buildAlarmNotificationOptions(
      { id: 'ALM-1', title: 'Suhu tinggi', body: '41.2 C', severity: 'critical', tag: 'alarm-suhu', timestamp: 1724900000000 },
      CTX,
    );
    expect(opts.renotify).toBe(true);
    expect(opts.requireInteraction).toBe(true);
    expect(opts.vibrate).toEqual([300, 150, 300, 150, 300]);
    expect(opts.tag).toBe('alarm-suhu');
    expect(opts.data.alarmId).toBe('ALM-1');
    expect(opts.data.ackUrl).toBe(CTX.apiBase);
    expect(opts.data.url).toBe(ALARM_VIEW_TARGET);
    expect(opts.data.severity).toBe('critical');
    expect(opts.actions.map((a) => a.action)).toEqual(['view', 'ack']);
    expect(opts.timestamp).toBe(1724900000000);
  });

  it('severity warning: tanpa renotify/requireInteraction, vibrate pendek', () => {
    const opts = buildAlarmNotificationOptions({ id: 'W1', severity: 'warning' }, CTX);
    expect(opts.renotify).toBe(false);
    expect(opts.requireInteraction).toBe(false);
    expect(opts.vibrate).toEqual([200]);
    expect(opts.data.severity).toBe('warning');
  });

  it('severity tak dikenal dinormalisasi ke info; tag & alarmId default aman', () => {
    const opts = buildAlarmNotificationOptions({ severity: 'SEVERE-BANGET', id: 12345 }, CTX);
    expect(opts.data.severity).toBe('info');
    expect(opts.data.alarmId).toBe('12345'); // id numerik GAS dikonversi string
    expect(opts.tag.startsWith('alarm-')).toBe(true);
  });

  it('payload kosong/null tidak melempar; timestamp jatuh ke Date.now()', () => {
    const before = Date.now();
    const opts = buildAlarmNotificationOptions({}, CTX);
    expect(opts.body).toBe('');
    expect(opts.data.alarmId).toBeNull();
    expect(opts.timestamp).toBeGreaterThanOrEqual(before);
  });

  it('timestamp tidak valid (NaN/string aneh) fallback Date.now()', () => {
    const opts = buildAlarmNotificationOptions({ timestamp: 'bukan-angka' }, CTX);
    expect(Number.isFinite(opts.timestamp)).toBe(true);
  });

  it('requireInteraction eksplisit dipertahankan untuk severity non-critical', () => {
    const opts = buildAlarmNotificationOptions({ severity: 'warning', requireInteraction: true }, CTX);
    expect(opts.requireInteraction).toBe(true);
  });
});

describe('alarmTitleOf', () => {
  it('memakai judul payload bila ada', () => {
    expect(alarmTitleOf({ title: 'Alarm Suhu' }, 'fallback')).toBe('Alarm Suhu');
  });
  it('fallback untuk null/kosong/whitespace', () => {
    expect(alarmTitleOf(null, 'fallback')).toBe('fallback');
    expect(alarmTitleOf({ title: '   ' }, 'fallback')).toBe('fallback');
  });
});

describe('deep-link view (store guard)', () => {
  it('alarms terdaftar sebagai view valid', () => {
    expect(VIEW_KEYS).toContain('alarms');
    expect(isViewKey('alarms')).toBe(true);
  });
  it('isViewKey menolak nilai asing (anti inject parameter URL)', () => {
    expect(isViewKey('constructor')).toBe(false);
    expect(isViewKey('__proto__')).toBe(false);
    expect(isViewKey(null)).toBe(false);
    expect(isViewKey(123)).toBe(false);
  });
});

describe('regresi struktural service worker (src/sw.ts)', () => {
  const swSource = readFileSync(path.resolve(process.cwd(), 'src/sw.ts'), 'utf8');

  it('mendaftarkan handler push', () => {
    expect(swSource).toMatch(/addEventListener\(\s*["']push["']/);
  });

  it('mendaftarkan handler notificationclick', () => {
    expect(swSource).toMatch(/addEventListener\(\s*["']notificationclick["']/);
  });

  it('mendaftarkan handler pushsubscriptionchange', () => {
    expect(swSource).toMatch(/addEventListener\(\s*["']pushsubscriptionchange["']/);
  });

  it('menerima konfigurasi runtime via pesan PLTS_PUSH_ALARM_CONFIG', () => {
    expect(swSource).toContain('PLTS_PUSH_ALARM_CONFIG');
  });

  it('deep-link notifikasi menuju view alarms', () => {
    expect(swSource).toContain('PLTS_PUSH_ALARM_OPEN');
    expect(swSource).toContain('view=alarms');
  });

  it('ACK notification dikirim sebagai action ackAlarm ke GAS', () => {
    expect(swSource).toContain('ackAlarm');
  });
});
