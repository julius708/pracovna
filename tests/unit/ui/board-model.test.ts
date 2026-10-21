import { describe, expect, it } from 'vitest';
import type { BoardPackage } from '@/app/_lib/board';
import { computePackage, DEFAULT_SETTINGS, parseLaundry, type PackageInput } from '@/core/packing';
import { angelikaNumbers, applyCleaner, cleanerOptions, counts, dayJobs, summaryLines, syncState, visibleJobs, searchPackages } from '@/ui/board-model';

const D0 = '2026-10-05';
let n = 0;

function pkg(over: Partial<BoardPackage> & { people?: number; sameDay?: boolean; laundry?: string; children?: number } = {}): BoardPackage {
  n++;
  const input: PackageInput = {
    date: over.date ?? D0,
    listing: { guestyId: `L${n}`, name: over.listing_name ?? `Byt ${n}`, beds: { KING_BED: 1, SOFA_BED: 1 }, accommodates: 4, bathrooms: 1, laundry: over.laundry ? parseLaundry(over.laundry) : null },
    outgoing: { guestyId: `R${n}`, listingId: `L${n}`, checkInDate: '2026-10-01', checkOutDate: over.date ?? D0, guests: 2 },
    next: over.sameDay ? { guestyId: `N${n}`, listingId: `L${n}`, checkInDate: over.date ?? D0, checkOutDate: '2026-10-09', guests: over.people ?? 2, children: over.children ?? 0 } : null,
    calendar: {},
    settings: DEFAULT_SETTINGS,
  };
  const r = computePackage(input);
  return {
    id: `p${n}`,
    listing_id: `L${n}`,
    listing_name: over.listing_name ?? `Byt ${n}`,
    date: over.date ?? D0,
    status: over.status ?? 'todo',
    hidden: over.hidden ?? false,
    cancel_reason: null,
    same_day: r.sameDay,
    target_people: r.people,
    incoming_reservation_id: null,
    computed_items: r,
    computed_hash: 'h',
    warnings: r.warnings,
    note: '',
    note_by_name: null,
    note_at: null,
    checklist: { items: [], checked: {} },
    packed_by_name: over.status === 'packed' ? 'Angelika' : null,
    packed_at: over.status === 'packed' ? '2026-10-05T07:00:00Z' : null,
    packed_hash: null,
  };
}

describe('board model', () => {
  it('a day shows its non-hidden cards; cancelled hidden ones disappear', () => {
    const a = pkg();
    const b = pkg({ date: '2026-10-06' });
    const c = pkg({ status: 'cancelled', hidden: true });
    const d = pkg({ status: 'cancelled', hidden: false });
    expect(dayJobs([a, b, c, d], D0).map((p) => p.id)).toEqual([a.id, d.id]);
  });

  it('counts exclude cancelled cards from the total', () => {
    const jobs = [pkg(), pkg({ status: 'packed' }), pkg({ status: 'cancelled' })];
    expect(counts(jobs)).toEqual({ todo: 1, packed: 1, cancelled: 1, total: 2 });
  });

  it('cleaner chips appear only when a card has a company, with "Bez služby" for the rest', () => {
    const a = pkg();
    const b = pkg();
    const cleaners = { [a.listing_id]: 'Čistá s.r.o.', [b.listing_id]: null };
    expect(cleanerOptions([a, b], {}, { all: 'Všetky služby', none: 'Bez služby' })).toEqual([]);
    expect(cleanerOptions([a, b], cleaners, { all: 'Všetky služby', none: 'Bez služby' })).toEqual([
      { key: '', label: 'Všetky služby', n: 2 },
      { key: 'Čistá s.r.o.', label: 'Čistá s.r.o.', n: 1 },
      { key: '_none', label: 'Bez služby', n: 1 },
    ]);
    expect(applyCleaner([a, b], cleaners, 'Čistá s.r.o.')).toEqual([a]);
    expect(applyCleaner([a, b], cleaners, '_none')).toEqual([b]);
  });

  it('summary totals: remaining counts to-pack cards, whole day counts packed too, cancelled never', () => {
    const jobs = [pkg({ sameDay: true, people: 2 }), pkg({ sameDay: true, people: 3, status: 'packed' }), pkg({ status: 'cancelled' })];
    const lines = summaryLines(jobs, { generic: 'Kapsule do kávy', typed: (t) => `Kapsule ${t}`, unsure: 'u', missing: 'm' });
    const towels = lines.find((l) => l.id === 'osuskaV')!;
    expect(towels).toMatchObject({ rem: 2, all: 5, consumable: false });
    const tp = lines.find((l) => l.id === 'toaletak')!;
    expect(tp).toMatchObject({ rem: 3, all: 7, consumable: true }); // people + 1 per card
    const caps = lines.find((l) => l.id === 'kapsule|missing')!;
    expect(caps).toMatchObject({ label: 'Kapsule do kávy', note: 'm', rem: 2, all: 5 });
    expect(lines.findIndex((l) => l.consumable)).toBeGreaterThan(lines.filter((l) => !l.consumable).length - 1);
  });

  it('private linen counts in the linen totals like any other, with its consumables and capsules (Martina, 2026-10-21)', () => {
    const jobs = [
      pkg({ sameDay: true, people: 2, laundry: 'Paplón veľký: 1\nKapsule: Tchibo Cafissimo' }),
      pkg({ sameDay: true, people: 2, laundry: 'Prádlo: súkromné\nPaplón veľký: 1\nKapsule: Tchibo Cafissimo' }),
    ];
    expect((jobs[1].computed_items as { private: boolean }).private).toBe(true);
    expect(jobs[1].computed_items.linen.length).toBeGreaterThan(0); // the card itself shows the linen
    const lines = summaryLines(jobs, { generic: 'g', typed: (t) => `Kapsule ${t}`, unsure: 'u', missing: 'm' });
    expect(lines.find((l) => l.id === 'paplonV')).toMatchObject({ rem: 2, all: 2 });
    expect(lines.find((l) => l.id === 'osuskaV')).toMatchObject({ rem: 4, all: 4 });
    expect(lines.find((l) => l.id === 'toaletak')).toMatchObject({ rem: 6, all: 6 });
    expect(lines.find((l) => l.id.startsWith('kapsule|'))).toMatchObject({ rem: 4, all: 4 });
  });

  it('capsule totals group per type and carry the photo', () => {
    const jobs = [pkg({ sameDay: true, people: 2, laundry: 'Kapsule: Tchibo Cafissimo' }), pkg({ sameDay: true, people: 3, laundry: 'Kapsule: TCHIBO cafissimo' })];
    const lines = summaryLines(jobs, { generic: 'g', typed: (t) => `Kapsule ${t}`, unsure: 'u', missing: 'm' });
    const caps = lines.filter((l) => l.id.startsWith('kapsule|'));
    expect(caps).toHaveLength(1);
    expect(caps[0]).toMatchObject({ rem: 5, all: 5, photo: 'kapsula-tchibo-cafissimo.png' });
  });

  it("Angelika's numbers count to-pack cards only", () => {
    const jobs = [pkg({ sameDay: true, children: 1 }), pkg({ sameDay: true, status: 'packed', children: 2 }), pkg(), pkg({ status: 'cancelled' })];
    expect(angelikaNumbers(jobs)).toEqual({ total: 3, todo: 2, rush: 1, kids: 1 });
  });

  it('visible cards: not-packed first, Slovak alphabetical, just-packed kept in place', () => {
    const z = pkg({ listing_name: 'Žilinská' });
    const c = pkg({ listing_name: 'Chalupkova' });
    const h = pkg({ listing_name: 'Hlavatého' });
    const packed = pkg({ listing_name: 'Baštová', status: 'packed' });
    const cancelled = pkg({ listing_name: 'Adlerova', status: 'cancelled' });
    const all = [z, c, h, packed, cancelled];
    expect(visibleJobs(all, 'todo', new Set()).map((p) => p.listing_name)).toEqual(['Hlavatého', 'Chalupkova', 'Žilinská']);
    expect(visibleJobs(all, 'todo', new Set([packed.id])).map((p) => p.listing_name)).toEqual(['Baštová', 'Hlavatého', 'Chalupkova', 'Žilinská']);
    expect(visibleJobs(all, 'packed', new Set()).map((p) => p.listing_name)).toEqual(['Baštová']);
    expect(visibleJobs(all, 'all', new Set()).map((p) => p.listing_name)).toEqual(['Hlavatého', 'Chalupkova', 'Žilinská', 'Baštová', 'Adlerova']);
  });

  it('finds an apartment without accents and keeps packing totals unchanged', () => {
    const jobs = [pkg({ listing_name: 'Žilinská 12' }), pkg({ listing_name: 'Žilinská 8', status: 'packed' }), pkg({ listing_name: 'Baštová 12' })];
    const before = counts(jobs);
    expect(searchPackages(jobs, '12 zilinska')).toEqual([jobs[0]]);
    expect(searchPackages(visibleJobs(jobs, 'packed', new Set()), 'zilinska')).toEqual([jobs[1]]);
    expect(searchPackages(jobs, 'missing')).toEqual([]);
    expect(searchPackages(jobs, '  ')).toEqual(jobs);
    expect(counts(jobs)).toEqual(before);
  });

  it('the sync badge turns stale after 30 minutes', () => {
    const now = new Date('2026-10-05T10:00:00Z');
    expect(syncState('2026-10-05T09:31:00Z', now)).toEqual({ stale: false, ageMinutes: 29 });
    expect(syncState('2026-10-05T09:29:00Z', now).stale).toBe(true);
    expect(syncState(null, now)).toEqual({ stale: false, ageMinutes: null });
  });
});
