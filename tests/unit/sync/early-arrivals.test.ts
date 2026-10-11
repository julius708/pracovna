import { describe, expect, it } from 'vitest';
import { EARLY_ARRIVAL_BEFORE } from '@/core/packing';
import { MemoryRepo } from '@/db/memory-repo';
import type { EarlyArrivalRow, ListingRow, ReservationRow } from '@/db/types';
import { arrivalClock, mapReservation } from '@/guesty/mappers';
import { GUESTY_AUTHOR, planEarlyArrivals, syncEarlyArrivals } from '@/sync/early-arrivals';

const DATES = ['2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17'];

function listing(id: string, name: string, inScope = true): ListingRow {
  return { guesty_id: id, name, title: null, city: 'Bratislava', active: true, accommodates: 2, bedrooms: 1, bathrooms: 1, beds: { KING_BED: 1 }, beds_source: 'listingRooms', tags: [], laundry_raw: null, laundry: null, cleaner: null, owner_cleans: false, in_scope: inScope, exclusion_reason: null, fetched_at: '2026-10-11T06:00:00Z' };
}

function reservation(id: string, listingId: string, checkIn: string, arrival: string | null, over: Partial<ReservationRow> = {}): ReservationRow {
  return {
    guesty_id: id,
    listing_id: listingId,
    arrival_listing_id: listingId,
    status: 'confirmed',
    check_in_date: checkIn,
    check_out_date: '2026-10-20',
    guests: 2,
    adults: 2,
    children: 0,
    infants: 0,
    confirmation_code: `C-${id}`,
    source: 'airbnb2',
    multi_stay: false,
    not_found_runs: 0,
    fetched_at: '2026-10-11T06:00:00Z',
    arrival_time: arrival,
    ...over,
  };
}

const existingRow = (over: Partial<EarlyArrivalRow>): EarlyArrivalRow => ({
  id: over.id ?? 'e1',
  listing_id: over.listing_id ?? 'L1',
  listing_name: over.listing_name ?? 'Poštová, Heart',
  date: over.date ?? '2026-10-12',
  arrival: over.arrival ?? '13:00',
  note: '',
  author: null,
  author_name: GUESTY_AUTHOR,
  created_at: '2026-10-11T06:00:00Z',
  removed_at: null,
  removed_by: null,
  removed_by_name: null,
  client_action_id: null,
  source: 'guesty',
  reservation_id: over.reservation_id ?? 'R1',
});

describe("planned arrival from Guesty's check-in timestamp", () => {
  it('is the clock part as written, whatever zone suffix Guesty attaches', () => {
    expect(arrivalClock('2026-10-03T13:00:00.000Z')).toBe('13:00');
    expect(arrivalClock('2026-10-01T16:00:00+00:00')).toBe('16:00');
    expect(arrivalClock('2026-10-01T09:30:00')).toBe('09:30');
    expect(arrivalClock('2026-10-01')).toBeNull();
    expect(arrivalClock(null)).toBeNull();
    expect(EARLY_ARRIVAL_BEFORE).toBe('16:00');
  });

  it('the mapper stores it on the reservation row (first stay segment first)', () => {
    const row = mapReservation(
      {
        _id: 'R1',
        status: 'confirmed',
        listingId: 'L1',
        checkIn: '2026-10-03T13:00:00.000Z',
        checkInDateLocalized: '2026-10-03',
        checkOutDateLocalized: '2026-10-05',
        guestsCount: 2,
        stay: [{ listingId: 'L1', checkIn: '2026-10-03T12:00:00.000Z', checkInDateLocalized: '2026-10-03', checkOutDateLocalized: '2026-10-05', guestsCount: 2 }],
      },
      '2026-10-11T06:00:00Z',
    );
    expect(row?.arrival_time).toBe('12:00');
    const plain = mapReservation({ _id: 'R2', status: 'confirmed', listingId: 'L1', checkInDateLocalized: '2026-10-03', checkOutDateLocalized: '2026-10-05' }, '2026-10-11T06:00:00Z');
    expect(plain?.arrival_time).toBeNull();
  });
});

describe('planEarlyArrivals', () => {
  const listings = new Map([
    ['L1', listing('L1', 'Poštová, Heart')],
    ['L2', listing('L2', 'Mestská, Modern')],
    ['L3', listing('L3', 'Šustekova, Sky', false)],
  ]);

  it('wants one row per flat and day for confirmed reservations arriving before the standard time, in-scope flats only', () => {
    const plan = planEarlyArrivals(
      [
        reservation('R1', 'L1', '2026-10-12', '13:00'),
        reservation('R2', 'L2', '2026-10-12', '16:00'), // standard time: not early
        reservation('R3', 'L2', '2026-10-13', '12:00', { status: 'canceled' }),
        reservation('R4', 'L3', '2026-10-13', '12:00'), // out of scope
        reservation('R5', 'L1', '2026-10-20', '12:00'), // outside the board window
        reservation('R6', 'L2', '2026-10-14', null), // unknown time
        reservation('R7', 'L2', '2026-10-14', '15:30'),
      ],
      listings,
      [],
      DATES,
    );
    expect(plan.remove).toEqual([]);
    expect(plan.add.map((a) => [a.listing_name, a.date, a.arrival, a.reservation_id, a.author_name, a.source])).toEqual([
      ['Poštová, Heart', '2026-10-12', '13:00', 'R1', GUESTY_AUTHOR, 'guesty'],
      ['Mestská, Modern', '2026-10-14', '15:30', 'R7', GUESTY_AUTHOR, 'guesty'],
    ]);
  });

  it('keeps rows that still match, replaces a changed time, removes a vanished one; two reservations one day keep the earlier time', () => {
    const existing = [existingRow({ id: 'keep', listing_id: 'L1', date: '2026-10-12', arrival: '13:00', reservation_id: 'R1' }), existingRow({ id: 'old', listing_id: 'L2', date: '2026-10-13', arrival: '12:00', reservation_id: 'R3' }), existingRow({ id: 'gone', listing_id: 'L2', date: '2026-10-15', arrival: '11:00', reservation_id: 'R9' })];
    const plan = planEarlyArrivals(
      [reservation('R1', 'L1', '2026-10-12', '13:00'), reservation('R3', 'L2', '2026-10-13', '14:00'), reservation('R8', 'L1', '2026-10-16', '15:00'), reservation('R8b', 'L1', '2026-10-16', '12:00')],
      listings,
      existing,
      DATES,
    );
    expect(plan.kept).toBe(1);
    expect(plan.remove.map((r) => r.id)).toEqual(['old', 'gone']);
    expect(plan.add.map((a) => [a.date, a.arrival, a.reservation_id])).toEqual([
      ['2026-10-13', '14:00', 'R3'],
      ['2026-10-16', '12:00', 'R8b'],
    ]);
  });

  it('the arrival flat of a multi-stay reservation is the one that counts', () => {
    const plan = planEarlyArrivals([reservation('R1', 'L2', '2026-10-12', '13:00', { arrival_listing_id: 'L1' })], listings, [], DATES);
    expect(plan.add.map((a) => a.listing_id)).toEqual(['L1']);
  });
});

describe('syncEarlyArrivals on the memory repo', () => {
  it('writes, keeps and removes rows so the board shows what Guesty says', async () => {
    const repo = new MemoryRepo();
    repo.now = () => new Date('2026-10-11T07:00:00Z');
    await repo.upsertListings([listing('L1', 'Poštová, Heart'), listing('L2', 'Mestská, Modern')]);
    await repo.upsertReservations([reservation('R1', 'L1', '2026-10-12', '13:00'), reservation('R2', 'L2', '2026-10-13', '16:00')]);
    expect(await syncEarlyArrivals(repo, DATES)).toEqual({ added: 1, removed: 0, kept: 0 });
    let rows = await repo.getEarlyArrivals(DATES);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ listing_id: 'L1', listing_name: 'Poštová, Heart', date: '2026-10-12', arrival: '13:00', author_name: GUESTY_AUTHOR, source: 'guesty', reservation_id: 'R1', removed_at: null });
    // a second run changes nothing
    expect(await syncEarlyArrivals(repo, DATES)).toEqual({ added: 0, removed: 0, kept: 1 });
    // Guesty moves the arrival to 12:00 and the Mestská guest buys an early check-in
    await repo.upsertReservations([reservation('R1', 'L1', '2026-10-12', '12:00', { fetched_at: '2026-10-11T08:00:00Z' }), reservation('R2', 'L2', '2026-10-13', '14:00', { fetched_at: '2026-10-11T08:00:00Z' })]);
    expect(await syncEarlyArrivals(repo, DATES)).toEqual({ added: 2, removed: 1, kept: 0 });
    rows = await repo.getEarlyArrivals(DATES);
    expect(rows.map((r) => [r.listing_id, r.arrival])).toEqual([
      ['L1', '12:00'],
      ['L2', '14:00'],
    ]);
    const removed = repo.earlyArrivals.find((r) => r.removed_at);
    expect(removed).toMatchObject({ arrival: '13:00', removed_by_name: GUESTY_AUTHOR });
    // the reservation is cancelled: the row goes
    await repo.upsertReservations([reservation('R1', 'L1', '2026-10-12', '12:00', { status: 'canceled', fetched_at: '2026-10-11T09:00:00Z' })]);
    expect(await syncEarlyArrivals(repo, DATES)).toEqual({ added: 0, removed: 1, kept: 1 });
    expect((await repo.getEarlyArrivals(DATES)).map((r) => r.listing_id)).toEqual(['L2']);
  });
});
