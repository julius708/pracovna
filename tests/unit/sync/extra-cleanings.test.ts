/**
 * Extra cleanings in the sync (Martina, 2026-11-18): a board message asking for a
 * cleaning adds a card; removing the message cancels it; a check-out card on the
 * same flat and day wins.
 */
import { describe, expect, it } from 'vitest';
import { addDays, extraPackageKey, type PackingResult } from '@/core/packing';
import { MemoryRepo } from '@/db/memory-repo';
import type { BoardNoteRow, CleaningRequestRow, ListingRow, ReservationRow } from '@/db/types';
import { silentLogger } from '@/guesty/log';
import { CANCEL_REASONS, recomputeWindow } from '@/sync/recompute';

const D0 = '2026-11-18';
const NOW = () => new Date(`${D0}T05:00:00.000Z`);

function listing(id: string, name: string, over: Partial<ListingRow> = {}): ListingRow {
  return {
    guesty_id: id,
    name,
    title: null,
    city: 'Bratislava',
    active: true,
    accommodates: 4,
    bedrooms: 1,
    bathrooms: 1,
    beds: { KING_BED: 1, SOFA_BED: 1 },
    beds_source: 'listingRooms',
    tags: [],
    laundry_raw: null,
    laundry: null,
    cleaner: null,
    cleaning_info: null,
    owner_cleans: false,
    in_scope: true,
    exclusion_reason: null,
    fetched_at: NOW().toISOString(),
    ...over,
  };
}

function res(id: string, listingId: string, checkIn: string, checkOut: string, guests: number, over: Partial<ReservationRow> = {}): ReservationRow {
  return {
    guesty_id: id,
    listing_id: listingId,
    arrival_listing_id: listingId,
    status: 'confirmed',
    check_in_date: checkIn,
    check_out_date: checkOut,
    guests,
    adults: guests,
    children: 0,
    infants: 0,
    confirmation_code: null,
    source: null,
    multi_stay: false,
    not_found_runs: 0,
    fetched_at: NOW().toISOString(),
    ...over,
  };
}

function note(id: string, date: string, text: string, over: Partial<BoardNoteRow> = {}): BoardNoteRow {
  return { id, text, date, author: null, author_name: 'Martina', created_at: NOW().toISOString(), removed_at: null, removed_by: null, removed_by_name: null, client_action_id: null, edited_at: null, parent_id: null, ...over };
}

async function setup() {
  const repo = new MemoryRepo();
  repo.now = NOW;
  await repo.upsertListings([listing('LA', 'Antolská, Studio', { accommodates: 2 }), listing('TA', 'Trnavská A, Fabulous'), listing('TB', 'Trnavská B, Sunny')]);
  return repo;
}
const run = (repo: MemoryRepo) => recomputeWindow({ repo, log: silentLogger, now: NOW }, 'test', D0);
const pkg = (repo: MemoryRepo, key: string) => [...repo.packages.values()].find((p) => p.outgoing_reservation_id === key);

describe('extra cleanings from board messages', () => {
  it('adds a card for the flat and day, packed for the people in the message', async () => {
    const repo = await setup();
    repo.boardNotes.push(note('n1', D0, 'Prosim nachystat tasku Trnavska cesta A - 1 osoba na zajtra - extra upratovanie'));
    await run(repo);
    const p = pkg(repo, extraPackageKey('TA', addDays(D0, 1)));
    expect(p).toBeDefined();
    expect(p!.status).toBe('todo');
    expect(p!.target_people).toBe(1);
    expect(p!.same_day).toBe(false);
    const r = p!.computed_items as PackingResult;
    expect(r.extra).toEqual({ peopleFrom: 'message', texts: ['Prosim nachystat tasku Trnavska cesta A - 1 osoba na zajtra - extra upratovanie'] });
    expect(r.sameDay).toBe(false);
    expect(r.linen.length).toBeGreaterThan(0);
    // nothing for Trnavská B
    expect([...repo.packages.values()].filter((x) => x.listing_id === 'TB')).toHaveLength(0);
  });

  it('without a number: the guests staying, else the next arrival, else the capacity', async () => {
    const repo = await setup();
    await repo.upsertReservations([res('STAY', 'TA', addDays(D0, -5), addDays(D0, 5), 3), res('NEXT', 'TB', addDays(D0, 2), addDays(D0, 4), 2)]);
    repo.boardNotes.push(note('n1', D0, 'Trnavská A prosím upratať tiež (dlhší pobyt)'), note('n2', D0, 'Trnavská B extra upratovanie'), note('n3', D0, 'Antolská extra upratovanie'));
    await run(repo);
    const a = pkg(repo, extraPackageKey('TA', D0))!;
    const b = pkg(repo, extraPackageKey('TB', D0))!;
    const c = pkg(repo, extraPackageKey('LA', D0))!;
    expect([a.target_people, (a.computed_items as PackingResult).extra?.peopleFrom]).toEqual([3, 'stay']);
    expect([b.target_people, (b.computed_items as PackingResult).extra?.peopleFrom]).toEqual([2, 'next']);
    expect([c.target_people, (c.computed_items as PackingResult).extra?.peopleFrom]).toEqual([2, 'capacity']);
  });

  it('reads "Info pre upratovačov" too, with the flat picked in the form', async () => {
    const repo = await setup();
    repo.cleaningRequests.push({
      id: 'c1', date: D0, listing_id: 'LA', listing_name: 'Antolská, Studio', text: 'prosim upratat aj dnes, 1 osoba', author: null, author_name: 'Martina',
      created_at: NOW().toISOString(), parent_id: null, done_at: null, done_by: null, done_by_name: null, removed_at: null, removed_by: null,
    } as CleaningRequestRow);
    await run(repo);
    expect(pkg(repo, extraPackageKey('LA', D0))?.target_people).toBe(1);
  });

  it('no second card when the flat has a check-out that day', async () => {
    const repo = await setup();
    await repo.upsertReservations([res('R1', 'TA', addDays(D0, -2), D0, 2)]);
    repo.boardNotes.push(note('n1', D0, 'Trnavská A extra upratovanie, 1 osoba'));
    await run(repo);
    expect(pkg(repo, 'R1')).toBeDefined();
    expect(pkg(repo, extraPackageKey('TA', D0))).toBeUndefined();
  });

  it('removing the message cancels the card; the next run is stable', async () => {
    const repo = await setup();
    repo.boardNotes.push(note('n1', D0, 'Trnavská A extra upratovanie, 1 osoba'));
    await run(repo);
    const again = await run(repo);
    expect(again.created).toBe(0);
    expect(again.cancelled).toBe(0);
    repo.boardNotes[0].removed_at = NOW().toISOString();
    const r = await run(repo);
    expect(r.cancelled).toBe(1);
    const p = pkg(repo, extraPackageKey('TA', D0))!;
    expect(p.status).toBe('cancelled');
    expect(p.hidden).toBe(true);
    expect(p.cancel_reason).toBe(CANCEL_REASONS.extraGone);
  });

  it('a regular package is not cancelled by the extra step, and replies are ignored', async () => {
    const repo = await setup();
    await repo.upsertReservations([res('R1', 'TB', addDays(D0, -2), addDays(D0, 1), 2)]);
    repo.boardNotes.push(note('n1', D0, 'Trnavská A extra upratovanie'), note('n2', D0, 'Trnavská B prosim upratat', { parent_id: 'n1' }));
    await run(repo);
    expect(pkg(repo, 'R1')?.status).toBe('todo');
    expect(pkg(repo, extraPackageKey('TB', D0))).toBeUndefined();
  });
});
