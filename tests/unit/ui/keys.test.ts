import { describe, expect, it } from 'vitest';
import { KEYS, keyRow } from '@/core/keys';

describe('USPORIADANIE KLUCOV (Martina, 2026-11-08)', () => {
  it('holds the 97 flats in the office order, first and last as given', () => {
    expect(KEYS).toHaveLength(97);
    expect(KEYS[0]).toEqual({ name: '29. Augusta, Grand', code: 'A10' });
    expect(KEYS[21]).toEqual({ name: 'Ivanská, Airport', code: 'B93' });
    expect(KEYS[96]).toEqual({ name: 'Zochova, Vintage', code: 'A138' });
  });

  it('every code is a hook row A-D with a number, and no code repeats', () => {
    for (const k of KEYS) expect(k.code).toMatch(/^[ABCD]\d+$/);
    expect(new Set(KEYS.map((k) => k.code)).size).toBe(KEYS.length);
  });

  it('the row letter decides the colour', () => {
    expect(['A10', 'B93', 'C105', 'D124', 'x1'].map(keyRow)).toEqual(['A', 'B', 'C', 'D', null]);
  });
});
