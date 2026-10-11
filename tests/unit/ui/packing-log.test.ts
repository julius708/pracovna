import { describe, expect, it } from 'vitest';
import { hasSnapshot, isSuperseded, packSnapshot, SNAPSHOT_COLUMNS, snapshotCells, snapshotOf, snapshotText, statusNote } from '@/app/_lib/packing-log';
import { computePackage, DEFAULT_ITEMS, DEFAULT_SETTINGS, parseLaundry, type PackageInput } from '@/core/packing';

const D0 = '2026-10-05';

function result(people: number, laundryText = 'Paplón veľký: 2\nKapsule: Tchibo Cafissimo') {
  const input: PackageInput = {
    date: D0,
    listing: { guestyId: 'L1', name: 'Dunajská, A', beds: { KING_BED: 1, SOFA_BED: 1 }, accommodates: 4, bathrooms: 1, laundry: parseLaundry(laundryText) },
    outgoing: { guestyId: 'R1', listingId: 'L1', checkInDate: '2026-10-01', checkOutDate: D0, guests: 2 },
    next: { guestyId: 'R2', listingId: 'L1', checkInDate: D0, checkOutDate: '2026-10-09', guests: people },
    calendar: {},
    settings: DEFAULT_SETTINGS,
  };
  return computePackage(input);
}

describe('packing history snapshot', () => {
  it('packSnapshot keeps people and the three item lists of the card', () => {
    const r = result(3);
    const s = packSnapshot(r.people, r);
    expect(s.people).toBe(3);
    expect(s.linen).toEqual(r.linen);
    expect(s.consumables).toEqual(r.consumables);
    expect(s.capsules).toEqual(r.capsules);
    expect(s.private).toBe(false);
    expect(packSnapshot(2, null)).toEqual({ people: 2, linen: [], consumables: [], capsules: [], private: false });
  });

  it('snapshotOf reads the event data, falls back to the package for events without it, null when neither exists', () => {
    const r = result(2);
    const stored = packSnapshot(2, r);
    expect(snapshotOf(JSON.parse(JSON.stringify(stored)), null)).toEqual(stored);
    // an event from before migration 0011 has {} as data: the package's current counts stand in
    const later = result(4);
    expect(snapshotOf({}, { target_people: 4, computed_items: later })).toEqual(packSnapshot(4, later));
    expect(snapshotOf(null, null)).toBeNull();
    expect(snapshotOf({ people: 1 }, null)).toBeNull(); // not a snapshot without the lists
  });

  it('snapshotText reads "2× Paplón veľký · 4× Vankúš · …" and labels the capsules', () => {
    const r = result(3);
    const t = snapshotText(packSnapshot(3, r));
    expect(t.linen.startsWith('2× Paplón veľký · 4× Vankúš · 2× Plachta · 3× Osuška veľká')).toBe(true);
    expect(t.consumables.startsWith('4× Toaletný papier · 1× Kuchynské utierky rolka')).toBe(true);
    expect(t.capsules).toBe('3× Kapsule Tchibo Cafissimo');
    const missing = snapshotText(packSnapshot(2, result(2, 'Paplón veľký: 2')));
    expect(missing.capsules).toBe('2× Kapsule do kávy (druh nezadaný v Guesty)');
    expect(snapshotText(null)).toEqual({ linen: '', consumables: '', capsules: '' });
  });

  it('CSV cells: one per item in the table order, empty when not packed, then the capsules', () => {
    const r = result(3);
    const cells = snapshotCells(packSnapshot(3, r));
    expect(cells).toHaveLength(DEFAULT_ITEMS.length + 1);
    expect(SNAPSHOT_COLUMNS).toHaveLength(DEFAULT_ITEMS.length);
    expect(SNAPSHOT_COLUMNS[DEFAULT_ITEMS.findIndex((i) => i.key === 'plachta140')]).toBe('Plachta 140 cm');
    const at = (key: string) => cells[DEFAULT_ITEMS.findIndex((i) => i.key === key)];
    expect(at('paplonV')).toBe(2);
    expect(at('paplonM')).toBe('');
    expect(at('vankus')).toBe(4);
    expect(at('toaletak')).toBe(4);
    expect(at('vreckoV')).toBe(3);
    expect(cells[cells.length - 1]).toBe('3× Kapsule Tchibo Cafissimo');
    expect(snapshotCells(null).every((c, i) => (i === DEFAULT_ITEMS.length ? c === '' : c === ''))).toBe(true);
  });

  it('a row whose packing did not stand says so: unpacked since, packed again later, or cancelled', () => {
    expect(statusNote('packed')).toBeNull();
    expect(statusNote('todo')).toBe('neskôr vrátené na balenie');
    expect(statusNote('cancelled')).toBe('rezervácia zrušená');
    expect(statusNote('packed', true)).toBe('neskôr vrátené a zabalené znova');
    expect(statusNote('cancelled', true)).toBe('rezervácia zrušená');
    expect(statusNote(null)).toBeNull();
  });

  it('a packed event is superseded when the package was packed again clearly later; the same packing is not', () => {
    expect(isSuperseded('2026-10-05T07:00:00.000Z', '2026-10-05T07:00:00.350Z')).toBe(false);
    expect(isSuperseded('2026-10-05T07:00:00.000Z', '2026-10-05T09:12:00.000Z')).toBe(true);
    expect(isSuperseded('2026-10-05T07:00:00.000Z', null)).toBe(false);
    expect(isSuperseded('2026-10-05T07:00:00.000Z', 'nonsense')).toBe(false);
  });

  it('hasSnapshot tells events with the stored counts from older ones', () => {
    expect(hasSnapshot(packSnapshot(2, result(2)))).toBe(true);
    expect(hasSnapshot({})).toBe(false);
    expect(hasSnapshot(null)).toBe(false);
  });
});
