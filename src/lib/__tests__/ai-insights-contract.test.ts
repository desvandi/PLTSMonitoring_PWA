// =============================================================================
// [WAVE-7 / PW7-5] Kontrak insight AI — validator isValidInsight kini benar-
// benar dipakai di pipeline (sebelumnya dead code). Test ini mengunci kontrak
// §94-95: hanya insight advisory-only dengan kategori/severity/source sah
// yang boleh sampai ke UI.
// =============================================================================

import { describe, it, expect } from 'vitest';
import { isValidInsight, ALLOWED_CATEGORIES, ALLOWED_SEVERITIES } from '../aiInsights';
import type { AiInsight } from '../types';

const VALID: AiInsight = {
  id: 'ins-1',
  category: 'battery_analysis',
  severity: 'info',
  title: 'Battery looks healthy',
  body: 'Cycle depth is shallow.',
  generatedAt: Date.now(),
  source: 'gemini',
  advisoryOnly: true,
};

describe('isValidInsight (kontrak §94-95)', () => {
  it('menerima insight yang memenuhi seluruh kontrak', () => {
    expect(isValidInsight(VALID)).toBe(true);
  });

  it('menerima sumber mock (label jujur), menolak sumber tak dikenal', () => {
    expect(isValidInsight({ ...VALID, source: 'mock' })).toBe(true);
    expect(isValidInsight({ ...VALID, source: 'gpt' })).toBe(false);
    expect(isValidInsight({ ...VALID, source: 'gemini-pro' })).toBe(false);
  });

  it('MENOLAK insight tanpa advisoryOnly === true (non-advisory = tak boleh tampil)', () => {
    expect(isValidInsight({ ...VALID, advisoryOnly: false })).toBe(false);
    expect(isValidInsight({ ...VALID, advisoryOnly: undefined })).toBe(false);
  });

  it('menolak kategori di luar daftar (payload asing tidak bisa masuk UI)', () => {
    for (const bad of ['command', 'control', 'actuator', '', 'battery_analysis ']) {
      expect(isValidInsight({ ...VALID, category: bad })).toBe(false);
    }
    for (const cat of ALLOWED_CATEGORIES) {
      expect(isValidInsight({ ...VALID, category: cat })).toBe(true);
    }
  });

  it('menolak severity di luar daftar', () => {
    expect(isValidInsight({ ...VALID, severity: 'silent' })).toBe(false);
    expect(isValidInsight({ ...VALID, severity: 'EMERGENCY' })).toBe(false);
    for (const sev of ALLOWED_SEVERITIES) {
      expect(isValidInsight({ ...VALID, severity: sev })).toBe(true);
    }
  });

  it('menolak tipe primitif / null / field kosong', () => {
    expect(isValidInsight(null)).toBe(false);
    expect(isValidInsight(undefined)).toBe(false);
    expect(isValidInsight('insight')).toBe(false);
    expect(isValidInsight(42)).toBe(false);
    expect(isValidInsight({ ...VALID, id: '' })).toBe(false);
    expect(isValidInsight({ ...VALID, title: '' })).toBe(false);
    expect(isValidInsight({ ...VALID, body: '' })).toBe(false);
    expect(isValidInsight({ ...VALID, generatedAt: '2026-08-29' as unknown as number })).toBe(false);
    expect(isValidInsight({ ...VALID, generatedAt: NaN })).toBe(false);
  });

  it('menolak objek dengan field ekstra yang mengubah semantik kontrol', () => {
    // Field asing tidak dilarang eksplisit, tapi advisoryOnly=false + action
    // eksekusi harus tetap ditolak oleh gerbang advisoryOnly.
    const disguised = { ...VALID, advisoryOnly: false, action: 'REBOOT' } as unknown;
    expect(isValidInsight(disguised)).toBe(false);
  });
});
