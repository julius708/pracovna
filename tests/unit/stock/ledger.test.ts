import { describe, expect, it } from 'vitest';
import { bookingTime, closeInventory, onHand, type Movement } from '@/core/stock';

let n = 0;
const mv = (kind: Movement['kind'], qty: number, at: string, over: Partial<Movement> = {}): Movement => ({
  id: String(++n), itemId: 'tp', warehouseId: 'w1', kind, qty, at, uniqueKey: null, sourceType: null, sourceId: null, ...over,
});

describe('stav zásob z knihy pohybov', () => {
  it('bez počiatočného stavu nie je stav známy (nie 0)', () => {
    expect(onHand([mv('issue_package', -5, '2026-11-10T10:00:00Z')], 'tp')).toMatchObject({ verified: false, qty: 0 });
  });
  it('pohyby pred baseline sa nepočítajú, po baseline áno', () => {
    const ms = [mv('issue_package', -50, '2026-11-17T08:00:00Z'), mv('opening_balance', 100, '2026-11-17T09:00:00Z'), mv('issue_package', -10, '2026-11-17T10:00:00Z'), mv('receipt', 30, '2026-11-18T10:00:00Z')];
    expect(onHand(ms, 'tp')).toMatchObject({ qty: 120, verified: true, baselineAt: '2026-11-17T09:00:00Z' });
  });
  it('záporný stav sa zobrazí, nič neblokuje', () => {
    const ms = [mv('opening_balance', 5, '2026-11-17T09:00:00Z'), mv('issue_package', -9, '2026-11-17T10:00:00Z')];
    expect(onHand(ms, 'tp')).toMatchObject({ qty: -4, negative: true });
  });
  it('sklady sa nemiešajú', () => {
    const ms = [mv('opening_balance', 10, '2026-11-17T09:00:00Z'), mv('opening_balance', 7, '2026-11-17T09:00:00Z', { warehouseId: 'w2' })];
    expect(onHand(ms, 'tp', 'w2').qty).toBe(7);
    expect(onHand(ms, 'tp').qty).toBe(17);
  });
});

describe('uzávierka inventúry v presnom čase', () => {
  const base = [mv('opening_balance', 100, '2026-11-17T09:00:00Z'), mv('issue_package', -10, '2026-11-18T10:00:00Z'), mv('issue_package', -4, '2026-11-18T14:00:00Z')];
  it('očakávaný stav sa berie k času uzávierky; pohyb po nej sa nezapočíta', () => {
    const r = closeInventory([{ itemId: 'tp', warehouseId: 'w1', state: 'counted', total: 85 }], base, '2026-11-18T12:00:00Z');
    expect(r.differences).toEqual([{ itemId: 'tp', warehouseId: 'w1', kind: 'inventory_difference', qty: -5, expected: 90, counted: 85 }]);
  });
  it('zhoda nevytvorí pohyb; prvé spočítanie je počiatočný stav', () => {
    expect(closeInventory([{ itemId: 'tp', warehouseId: 'w1', state: 'counted', total: 90 }], base, '2026-11-18T12:00:00Z').differences).toEqual([]);
    const first = closeInventory([{ itemId: 'x', warehouseId: 'w1', state: 'counted', total: 40 }], [], '2026-11-18T12:00:00Z');
    expect(first.differences[0]).toMatchObject({ kind: 'opening_balance', qty: 40 });
  });
  it('overená nula je spočítaná; prázdny riadok sa preskočí a nie je nula', () => {
    const r = closeInventory([{ itemId: 'tp', warehouseId: 'w1', state: 'zero', total: 0 }, { itemId: 'y', warehouseId: 'w1', state: 'unset' }], base, '2026-11-18T12:00:00Z');
    expect(r.differences[0]).toMatchObject({ qty: -90, counted: 0 });
    expect(r.skipped).toEqual([{ itemId: 'y', warehouseId: 'w1' }]);
  });
  it('neoverený prepočet uzávierku zablokuje', () => {
    const r = closeInventory([{ itemId: 'tp', warehouseId: 'w1', state: 'unverified' }], base, '2026-11-18T12:00:00Z');
    expect(r.ok).toBe(false);
    expect(r.blockers).toHaveLength(1);
  });
  it('ručný pohyb s časom pred uzávierkou sa zapíše na uzávierku (minulosť sa nepreráta)', () => {
    expect(bookingTime('2026-11-18T08:00:00Z', '2026-11-18T12:00:00Z')).toEqual({ at: '2026-11-18T12:00:00Z', shifted: true });
    expect(bookingTime('2026-11-18T13:00:00Z', '2026-11-18T12:00:00Z').shifted).toBe(false);
    expect(bookingTime('2026-11-18T13:00:00Z', null).shifted).toBe(false);
  });
});
