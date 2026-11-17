import { describe, expect, it } from 'vitest';
import { issueDelta, planIssue } from '@/core/stock';
import { aliases } from './helpers';

const snap = {
  people: 2,
  consumables: [{ key: 'toaletak', n: 3 }, { key: 'vreckoV', n: 2 }, { key: 'utierky', n: 1 }],
  capsules: [{ type: 'Nespresso Original', typeKey: 'nespresso original', n: 2, state: 'ok' as const }],
  linen: [{ key: 'plachta', size: 'dvoj', n: 2 }],
};

describe('výdaj zo snapshotu zabalenia', () => {
  it('vydá namapované riadky a nenamapované zapíše bokom (nehádá)', () => {
    const p = planIssue(snap, aliases);
    expect(p.lines.map((l) => [l.itemId, l.qty])).toEqual([['cap-nes-orig', 2], ['lin-sheet-d', 2], ['tp', 3], ['bag-l', 2]].sort((a, b) => (a[0] < b[0] ? -1 : 1)));
    expect(p.unmapped).toHaveLength(1);
    expect(p.unmapped[0]).toMatchObject({ sourceKey: 'utierky', n: 1 });
  });

  it('kávové systémy sú oddelené: Original ≠ Vertuo ≠ Tassimo', () => {
    const p = planIssue({ capsules: [
      { type: 'Nespresso Original', typeKey: 'nespresso original', n: 2 },
      { type: 'Nespresso Vertuo', typeKey: 'nespresso vertuo', n: 3 },
      { type: "L'OR Tassimo", typeKey: "l'or tassimo", n: 1 },
    ] }, aliases);
    expect(Object.fromEntries(p.lines.map((l) => [l.itemId, l.qty]))).toEqual({ 'cap-nes-orig': 2, 'cap-nes-vertuo': 3, 'cap-tassimo': 1 });
  });

  it('neurčený alebo neznámy druh kávy sa nevydá z nijakej karty', () => {
    const p = planIssue({ capsules: [
      { type: '', typeKey: '', n: 2, state: 'missing' },
      { type: 'Nespresso', typeKey: 'nespresso', n: 2 }, // bez systému: nie je ani Original, ani Vertuo
      { type: 'Tchibo', typeKey: 'tchibo', n: 2, state: 'unsure' },
    ] }, aliases);
    expect(p.lines).toEqual([]);
    expect(p.unmapped).toHaveLength(3);
  });

  it('veľkosť je súčasťou identity (plachta|dvoj ≠ plachta|jedno)', () => {
    const p = planIssue({ linen: [{ key: 'plachta', size: 'jedno', n: 1 }] }, aliases);
    expect(p.lines).toEqual([]);
    expect(p.unmapped[0].sourceKey).toBe('plachta|jedno');
  });

  it('nulové a záporné počty sa ignorujú', () => {
    expect(planIssue({ consumables: [{ key: 'toaletak', n: 0 }, { key: 'vreckoV', n: -1 }] }, aliases)).toEqual({ lines: [], unmapped: [] });
  });

  it('zmena požiadavky po zabalení: výdaj sa riadi snapshotom, rozdiel sa delí na doplnenie a prebytok', () => {
    const held = planIssue(snap, aliases).lines;
    const changed = planIssue({ ...snap, consumables: [{ key: 'toaletak', n: 5 }, { key: 'vreckoV', n: 1 }] }, aliases).lines;
    expect(issueDelta(held, changed)).toEqual({ extra: [{ itemId: 'tp', qty: 2 }], surplus: [{ itemId: 'bag-l', qty: 1 }] });
    expect(issueDelta(held, held)).toEqual({ extra: [], surplus: [] });
  });
});
