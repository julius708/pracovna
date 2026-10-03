import { describe, expect, it } from 'vitest';
import type { BoardPackage } from '@/app/_lib/board';
import { boardNotices, noteNotices } from '@/ui/board-model';

function pkg(over: Partial<BoardPackage> & { id: string; listing_name: string }): BoardPackage {
  return {
    listing_id: `L-${over.id}`,
    date: '2026-10-02',
    status: 'todo',
    hidden: false,
    cancel_reason: null,
    same_day: false,
    target_people: 2,
    incoming_reservation_id: null,
    computed_items: {} as BoardPackage['computed_items'],
    computed_hash: 'h1',
    warnings: [],
    note: '',
    note_by_name: null,
    note_at: null,
    checklist: { items: [], checked: {} },
    packed_by_name: null,
    packed_at: null,
    packed_hash: null,
    ...over,
  };
}

const day = (d: string) => (d === '2026-10-02' ? 'Dnes' : d === '2026-10-03' ? 'Zajtra' : 'ne');
const none = new Set<string>();

describe('boardNotices', () => {
  const a = pkg({ id: 'a', listing_name: 'Bajkalská, Luxe' });
  const b = pkg({ id: 'b', listing_name: 'Dunajská, 2' });

  it('tells who packed or undid a card on another device', () => {
    const packed = { ...a, status: 'packed' as const, packed_by_name: 'Eva', packed_at: 'x' };
    expect(boardNotices([a, b], [packed, b], 'Julius', none, day)).toEqual(['Eva zabalil(a) Bajkalská, Luxe']);
    expect(boardNotices([packed, b], [a, b], 'Julius', none, day)).toEqual(['Bajkalská, Luxe je späť na balenie']);
  });

  it("stays silent about this device's own optimistic changes", () => {
    const packed = { ...a, status: 'packed' as const, packed_by_name: 'Julius', packed_at: 'x' };
    expect(boardNotices([a, b], [packed, b], 'Julius', none, day)).toEqual([]);
    expect(boardNotices([packed, b], [a, b], 'Julius', new Set(['a']), day)).toEqual([]);
  });

  it('reports Guesty changes: new, recomputed and cancelled packages', () => {
    const c = pkg({ id: 'c', listing_name: 'Obchodná B', date: '2026-10-03' });
    expect(boardNotices([a, b], [a, b, c], 'Julius', none, day)).toEqual(['Nový balíček z Guesty: Obchodná B (Zajtra)']);
    expect(boardNotices([a, b], [{ ...a, computed_hash: 'h2' }, b], 'Julius', none, day)).toEqual(['Zmena z Guesty: Bajkalská, Luxe']);
    expect(boardNotices([a, b], [{ ...a, status: 'cancelled' }, b], 'Julius', none, day)).toEqual(['Zrušené z Guesty: Bajkalská, Luxe']);
    // hidden rows (cancelled before packing) and the very first load produce nothing
    expect(boardNotices([a, b], [a, b, { ...c, hidden: true }], 'Julius', none, day)).toEqual([]);
    expect(boardNotices([], [a, b], 'Julius', none, day)).toEqual([]);
  });

  it('collapses a burst of Guesty changes into one line and keeps up to two staff notices', () => {
    const many = ['c', 'd', 'e', 'f'].map((id) => pkg({ id, listing_name: `Byt ${id}` }));
    const packed = { ...a, status: 'packed' as const, packed_by_name: 'Eva', packed_at: 'x' };
    expect(boardNotices([a, b], [packed, b, ...many], 'Julius', none, day)).toEqual(['Zmeny z Guesty: 4 balíčky', 'Eva zabalil(a) Bajkalská, Luxe']);
    expect(boardNotices([a, b], [a, b, ...many, pkg({ id: 'g', listing_name: 'Byt g' })], 'Julius', none, day)).toEqual(['Zmeny z Guesty: 5 balíčkov']);
  });
});

describe('noteNotices', () => {
  const n = (id: string, author_name: string) => ({ id, text: 'x', date: '2026-10-04', author: null, author_name, created_at: '2026-10-03T10:00:00Z' });
  const dayOf = (d: string) => (d === '2026-10-04' ? 'Zajtra 4.10.' : d);
  it('announces notes by others that are new since the last read, with their day, never own ones', () => {
    expect(noteNotices([n('1', 'Eva')], [n('2', 'Max'), n('1', 'Eva')], 'Julius', dayOf)).toEqual(['📌 Nové dôležité info od Max · Zajtra 4.10.']);
    expect(noteNotices([], [n('1', 'Julius')], 'Julius', dayOf)).toEqual([]);
    expect(noteNotices([n('1', 'Eva')], [n('1', 'Eva')], 'Julius', dayOf)).toEqual([]);
    expect(noteNotices([n('1', 'Eva')], [], 'Julius', dayOf)).toEqual([]);
  });
});
