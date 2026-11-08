import { describe, expect, it } from 'vitest';
import { KEYS, keyRow } from '@/core/keys';

describe('USPORIADANIE KLUCOV (Martina, 2026-11-08)', () => {
  it('holds the 96 flats in the office order, first and last as given (Dunajska 66 = Dunajská A, removed 2026-11-08)', () => {
    expect(KEYS).toHaveLength(96);
    expect(KEYS.some((k) => k.code === 'C105')).toBe(false);
    expect(KEYS[0]).toMatchObject({ name: '29. Augusta, Grand', code: 'A10' });
    expect(KEYS[20]).toMatchObject({ name: 'Ivanská, Airport', code: 'B93' });
    expect(KEYS[95]).toMatchObject({ name: 'Zochova, Vintage', code: 'A138' });
  });

  it('every code is a hook row A-D with a number, and no code repeats', () => {
    for (const k of KEYS) expect(k.code).toMatch(/^[ABCD]\d+$/);
    expect(new Set(KEYS.map((k) => k.code)).size).toBe(KEYS.length);
  });

  it('the row letter decides the colour', () => {
    expect(['A10', 'B93', 'C105', 'D124', 'x1'].map(keyRow)).toEqual(['A', 'B', 'C', 'D', null]);
  });
});

describe('USPORIADANIE KĽÚČOV – Guesty names and addresses', () => {
  it('matched flats carry their street, known flat numbers stay, the question marks stay', () => {
    const by = (name: string) => KEYS.find((k) => k.name === name);
    expect(by('Poštová, Heart')).toEqual({ name: 'Poštová, Heart', code: 'B90', address: 'Poštová 1', detail: 'č. bytu 606' });
    expect(by('Obchodná B, Romantic')?.address).toBe('Obchodná 4');
    expect(KEYS.filter((k) => k.name.endsWith('?')).map((k) => k.name)).toEqual(['Jarabinková A, Pan.?', 'Jarabinková B,Bright?', 'Pionierska?']);
  });
});

describe('USPORIADANIE KĽÚČOV – Skypark towers (Martina, 2026-11-08)', () => {
  it('each Skypark flat shows its tower, floor and apartment', () => {
    expect(KEYS.find((k) => k.code === 'D61')).toMatchObject({ name: 'Skypark, Elegant', address: 'Čulenova 5', detail: 'Tower 1 · 10. poschodie · apartmán 089' });
    expect(KEYS.find((k) => k.code === 'D62')?.detail).toBe('Tower 4 · 17. poschodie · apartmán 159');
    expect(KEYS.filter((k) => k.name.startsWith('Skypark') && k.detail?.startsWith('Tower'))).toHaveLength(9);
  });
});
