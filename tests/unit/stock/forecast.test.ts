import { describe, expect, it } from 'vitest';
import { calibrate, expectedStays, knownDemand, monthlyConsumption, occupiedFlatNights, sellThrough, type ReportMovement } from '@/core/stock';
import { aliases, item, sku } from './helpers';

describe('predpoveď', () => {
  it('známy dopyt ide cez rovnaký plán výdaja (aj kávové systémy)', () => {
    const k = knownDemand([
      { consumables: [{ key: 'toaletak', n: 3 }], capsules: [{ typeKey: 'nespresso vertuo', n: 2 }] },
      { consumables: [{ key: 'toaletak', n: 2 }], capsules: [{ typeKey: 'nespresso original', n: 2 }, { typeKey: 'neznamy', n: 1 }] },
    ], aliases);
    expect(Object.fromEntries(k.byItem)).toEqual({ tp: 5, 'cap-nes-vertuo': 2, 'cap-nes-orig': 2 });
    expect(k.unmappedRows).toBe(1);
  });

  it('obsadené noci bytov = dostupné noci aktívnych bytov × obsadenosť; opravy a blokácie sa neráta', () => {
    const o = occupiedFlatNights([{ listingId: 'a', city: 'BA', availableNights: 28 }, { listingId: 'b', city: 'BA', availableNights: 14 }, { listingId: 'c', city: 'BA', availableNights: 0 }], { low: 0.5, mid: 0.7, high: 0.9 });
    expect(o.low).toBeCloseTo(21);
    expect(o.mid).toBeCloseTo(29.4);
    expect(expectedStays(29.4, 3)).toBeCloseTo(9.8);
    expect(expectedStays(10, 0)).toBe(0);
  });

  it('potvrdené pobyty sa nepočítajú dvakrát a týždeň sa nenásobí štyrmi', () => {
    const per = new Map([['tp', calibrate('tp', 600, { from: '2026-10-01', to: '2026-11-15', stays: 100 })]]);
    const flats = [{ listingId: 'a', city: 'BA', availableNights: 30 }];
    const out = sellThrough({ flats, occupancy: { low: 0.4, mid: 0.6, high: 0.8 }, avgStayNights: 3, confirmedStays: 4, perStay: per });
    const mid = out.find((s) => s.scenario === 'mid')!;
    expect(mid.additionalStays).toBeCloseTo(30 * 0.6 / 3 - 4); // 6 − 4 = 2
    expect(mid.byItem.get('tp')).toBeCloseTo(2 * 6);
    // veľa potvrdených pobytov: doplnok nikdy záporný
    const full = sellThrough({ flats, occupancy: { low: 0.4, mid: 0.6, high: 0.8 }, avgStayNights: 3, confirmedStays: 50, perStay: per });
    expect(full.every((s) => s.additionalStays === 0)).toBe(true);
    // scenáre sú usporiadané
    expect(out[0].additionalStays).toBeLessThanOrEqual(out[1].additionalStays);
    expect(out[1].additionalStays).toBeLessThanOrEqual(out[2].additionalStays);
  });

  it('kalibrácia z málo pobytov je nepoužiteľná a hlási „nedostatok dát“ namiesto nuly', () => {
    const c = calibrate('tp', 12, { from: '2026-11-10', to: '2026-11-16', stays: 5 });
    expect(c.usable).toBe(false);
    const out = sellThrough({ flats: [{ listingId: 'a', city: 'BA', availableNights: 30 }], occupancy: { low: 0.4, mid: 0.6, high: 0.8 }, avgStayNights: 3, confirmedStays: 0, perStay: new Map([['tp', c]]) });
    expect(out[1].noData).toEqual(['tp']);
    expect(out[1].byItem.has('tp')).toBe(false);
    expect(c).toMatchObject({ from: '2026-11-10', to: '2026-11-16', stays: 5 });
  });
});

describe('mesačný prehľad', () => {
  const items = [item('tp'), item('lin', { kind: 'linen' })];
  const mk = (kind: ReportMovement['kind'], qty: number, over: Partial<ReportMovement> = {}): ReportMovement => ({
    id: Math.random().toString(), itemId: 'tp', warehouseId: 'w1', kind, qty, at: '2026-11-10T10:00:00Z', uniqueKey: null, sourceType: null, sourceId: null, city: 'Bratislava', listingId: 'lst1', ...over,
  });
  it('vydané − vrátené = čistý výdaj; náklad z overeného balenia; posteľná bielizeň nie je spotreba', () => {
    const rows = monthlyConsumption([mk('issue_package', -30), mk('issue_package', -10), mk('return', 5), mk('linen_issue', -4, { itemId: 'lin' }), mk('damage', -3)], items, [sku()]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ month: '2026-11', issued: 40, returned: 5, netIssue: 35, costCents: 1750 });
  });
  it('neoverené balenie = náklad neznámy (null), nie 0', () => {
    expect(monthlyConsumption([mk('issue_package', -30)], items, [sku({ piecesPerPack: null })])[0].costCents).toBeNull();
  });
  it('riadky neobsahujú osobu (nikto sa nehodnotí podľa klikov)', () => {
    const rows = monthlyConsumption([mk('issue_package', -1)], items, [sku()]);
    expect(Object.keys(rows[0]).some((k) => /actor|person|user|name/i.test(k))).toBe(false);
  });
});
