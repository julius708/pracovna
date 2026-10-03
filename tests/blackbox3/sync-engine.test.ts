/**
 * Black-box tests of the sync engine (step 3): recompute, reconcile, min-nights
 * needs, nightly retention / webhook health and alerts. Every fixture is built
 * by hand so each expectation is explicit. Binding: spec §3, proposal §4–§6, §8.
 */
import { describe, expect, it } from 'vitest';
import { LAUNDRY_FIELD_ID, addDays, windowDates } from '@/core/packing';
import type { PackingResult } from '@/core/packing';
import { MemoryRepo } from '@/db/memory-repo';
import type { CalendarRow, ListingRow, PackageRow, ReservationRow } from '@/db/types';
import { createFakeGuestyClient, type FakeGuestyData } from '@/guesty/fake-client';
import { GuestyApiError } from '@/guesty/http';
import { silentLogger } from '@/guesty/log';
import type { ParsedCalendarDay, ParsedListing, ParsedReservation } from '@/guesty/schemas';
import { ALERT_TEXT, evaluateAlerts, type AlertKind, type AlertState } from '@/sync/alerts';
import { gapsNeedingCalendar } from '@/sync/minNights';
import { checkWebhookHealth, nightly } from '@/sync/nightly';
import { CANCEL_REASONS, diffComputed, findNextArrival, recomputeWindow } from '@/sync/recompute';
import { reconcile } from '@/sync/reconcile';

const D0 = '2026-10-05';
const [, D1, D2] = windowDates(D0);
const D3 = addDays(D0, 3);
// 06:00 Bratislava, written in UTC because stored instants are always toISOString() output
const NOW_ISO = `${D0}T04:00:00.000Z`;
const H = 3_600_000;
const DAY = 24 * H;
const at = (iso: string) => () => new Date(iso);
const shift = (ms: number) => new Date(new Date(NOW_ISO).getTime() + ms).toISOString();

// ---------- repo-level fixtures (recompute reads database state only) ----------

function listingRow(id: string, over: Partial<ListingRow> = {}): ListingRow {
  return {
    guesty_id: id,
    name: `Byt ${id}`,
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
    owner_cleans: false,
    in_scope: true,
    exclusion_reason: null,
    fetched_at: NOW_ISO,
    ...over,
  };
}

function resRow(id: string, listingId: string, checkIn: string, checkOut: string, guests = 2, over: Partial<ReservationRow> = {}): ReservationRow {
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
    fetched_at: NOW_ISO,
    ...over,
  };
}

function calRow(listingId: string, date: string, minNights: number | null, status = 'available', cta: boolean | null = false): CalendarRow {
  return { listing_id: listingId, date, min_nights: minNights, status, cta, source: 'guesty', fetched_at: NOW_ISO };
}

function pkgOf(repo: MemoryRepo, reservationId: string): PackageRow {
  const p = [...repo.packages.values()].find((x) => x.outgoing_reservation_id === reservationId);
  if (!p) throw new Error(`no package for ${reservationId}`);
  return p;
}

function count(r: PackingResult, key: string): number {
  return [...r.linen, ...r.consumables].find((l) => l.key === key)?.n ?? 0;
}

function newRepo(now = NOW_ISO) {
  const repo = new MemoryRepo();
  repo.now = at(now);
  return repo;
}

function rdeps(repo: MemoryRepo, now: () => Date = at(NOW_ISO)) {
  return { repo, log: silentLogger, now };
}

// ---------- Guesty-level fixtures (reconcile talks to the fake client) ----------

function fakeListing(id: string, over: Partial<ParsedListing> = {}): ParsedListing {
  return {
    _id: id,
    nickname: `Byt ${id}`,
    title: `Byt ${id}`,
    active: true,
    isListed: true,
    address: { city: 'Bratislava' },
    accommodates: 4,
    bedrooms: 1,
    bathrooms: 1,
    listingRooms: [{ beds: [{ type: 'KING_BED', quantity: 1 }, { type: 'SOFA_BED', quantity: 1 }] }],
    customFields: [{ fieldId: LAUNDRY_FIELD_ID, value: 'Paplóny: veľké\nKapsule: nedávať' }],
    ...over,
  };
}

function fakeRes(id: string, listingId: string, checkIn: string, checkOut: string, guests = 2, status = 'confirmed'): ParsedReservation {
  return {
    _id: id,
    status,
    listingId,
    checkInDateLocalized: checkIn,
    checkOutDateLocalized: checkOut,
    guestsCount: guests,
    stay: [{ listingId, checkInDateLocalized: checkIn, checkOutDateLocalized: checkOut, guestsCount: guests, numberOfGuests: { numberOfAdults: guests } }],
  };
}

function fakeData(listings: ParsedListing[], reservations: ParsedReservation[], calendar: Record<string, ParsedCalendarDay[]> = {}): FakeGuestyData {
  return { listings, reservations, calendar };
}

type FakeClient = ReturnType<typeof createFakeGuestyClient>;
type SearchParams = Parameters<FakeClient['searchReservations']>[0];

function cdeps(repo: MemoryRepo, client: FakeClient | (Omit<FakeClient, 'searchReservations'> & Pick<FakeClient, 'searchReservations'>), now: () => Date = at(NOW_ISO), extra: Record<string, unknown> = {}) {
  return { repo, client, laundryFieldId: LAUNDRY_FIELD_ID, log: silentLogger, now, ...extra };
}

const ids = (n: number, prefix = 'L') => Array.from({ length: n }, (_, i) => `${prefix}${String(i + 1).padStart(2, '0')}`);

// =====================================================================
describe('recomputeWindow – package creation and the next arrival', () => {
  it('creates one todo package per confirmed in-scope check-out in D0..D2 and nothing for the rest', async () => {
    const repo = newRepo();
    await repo.upsertListings([listingRow('L1'), listingRow('L2'), listingRow('L3', { in_scope: false, exclusion_reason: 'city' })]);
    await repo.upsertReservations([
      resRow('R1', 'L1', addDays(D0, -3), D0),
      resRow('R2', 'L2', addDays(D0, -1), D2),
      resRow('R3', 'L1', D2, D3), // check-out after the window
      resRow('R4', 'L3', addDays(D0, -2), D1), // listing out of scope
      resRow('R5', 'L2', addDays(D0, -4), D1, 2, { status: 'canceled' }), // not confirmed
      resRow('R6', 'L1', addDays(D0, -9), addDays(D0, -1)), // yesterday
    ]);
    const r = await recomputeWindow(rdeps(repo), 'test');
    expect(r.created).toBe(2);
    expect(r.cancelled).toBe(0);
    const pkgs = await repo.getPackagesInWindow(windowDates(D0));
    expect(pkgs.map((p) => p.outgoing_reservation_id).sort()).toEqual(['R1', 'R2']);
    expect(pkgs.every((p) => p.status === 'todo' && !p.hidden)).toBe(true);
    expect(pkgOf(repo, 'R1').date).toBe(D0);
    expect(pkgOf(repo, 'R2').date).toBe(D2);
    expect(pkgOf(repo, 'R2').listing_name).toBe('Byt L2');
    expect(repo.events.filter((e) => e.event === 'created').length).toBe(2);
  });

  it('same-day check-in packs for the arriving guests; the outgoing reservation itself is never the next arrival', async () => {
    const repo = newRepo();
    await repo.upsertListings([listingRow('L1')]);
    await repo.upsertReservations([
      resRow('R1', 'L1', addDays(D0, -3), D0, 4), // outgoing, full house
      resRow('R2', 'L1', D0, D2, 3), // arrives the same day, 3 guests; also checks out on D2
      resRow('R3', 'L1', D3, addDays(D0, 6), 1), // later arrival
    ]);
    await recomputeWindow(rdeps(repo), 'test');
    const p1 = pkgOf(repo, 'R1');
    expect(p1.same_day).toBe(true);
    expect(p1.incoming_reservation_id).toBe('R2');
    expect(p1.people_source).toBe('same_day');
    expect(p1.target_people).toBe(3);
    expect(p1.computed_items.next?.reservationId).toBe('R2');
    // R2's own package (check-out D2): its next arrival is R3, never R2
    const p2 = pkgOf(repo, 'R2');
    expect(p2.date).toBe(D2);
    expect(p2.incoming_reservation_id).toBe('R3');
    expect(p2.same_day).toBe(false);
    expect(p2.gap_nights).toBe(1);
  });

  it('findNextArrival: excludes the outgoing id, ignores other listings and earlier arrivals, picks the earliest', () => {
    const out = resRow('OUT', 'L1', D0, D0); // degenerate 0-night row that also "arrives" on D0
    const sameDay = resRow('A0', 'L1', D0, D2, 3);
    const later = resRow('A1', 'L1', D1, D3, 1);
    const other = resRow('X', 'L2', D0, D1, 5);
    const before = resRow('B', 'L1', addDays(D0, -1), D1, 5);
    expect(findNextArrival([out, later, other, before, sameDay], 'L1', D0, 'OUT')?.guesty_id).toBe('A0');
    expect(findNextArrival([out], 'L1', D0, 'OUT')).toBeNull();
    expect(findNextArrival([later, other], 'L1', D0, 'OUT')?.guesty_id).toBe('A1');
    expect(findNextArrival([], 'L1', D0, 'OUT')).toBeNull();
  });

  it('two check-outs of one listing on one day give two packages, both with double_checkout', async () => {
    const repo = newRepo();
    await repo.upsertListings([listingRow('L1')]);
    await repo.upsertReservations([
      resRow('R1', 'L1', addDays(D0, -2), D0),
      resRow('R2', 'L1', addDays(D0, -5), D0),
      resRow('R3', 'L1', D1, D2), // a third package on another day
    ]);
    const r = await recomputeWindow(rdeps(repo), 'test');
    expect(r.created).toBe(3);
    expect(pkgOf(repo, 'R1').warnings).toContain('double_checkout');
    expect(pkgOf(repo, 'R2').warnings).toContain('double_checkout');
    expect(pkgOf(repo, 'R3').warnings).not.toContain('double_checkout');
    expect((await repo.getPackagesInWindow([D0])).length).toBe(2);
  });
});

// =====================================================================
describe('recomputeWindow – settings, calendar, moves, scope, cancellation', () => {
  it('a linen-table change alters counts and logs settings_recompute when the trigger is settings', async () => {
    const repo = newRepo();
    // one double bed, no sofa, capacity 2 → exactly one "dvoj" set per package
    const twoBed = { beds: { KING_BED: 1 }, accommodates: 2 };
    await repo.upsertListings([listingRow('L1', twoBed), listingRow('L2', twoBed)]);
    await repo.upsertReservations([resRow('R1', 'L1', addDays(D0, -2), D0), resRow('R2', 'L2', addDays(D0, -2), D1)]);
    await recomputeWindow(rdeps(repo), 'cron');
    expect(count(pkgOf(repo, 'R1').computed_items, 'vankus')).toBe(2); // 1 double bed
    const eventsBefore = repo.events.length;

    repo.settings.set('linen_table', { beds: { dvoj: { vankus: 4 } } });
    const r = await recomputeWindow(rdeps(repo), 'settings');
    expect(r.updated).toBe(2);
    expect(count(pkgOf(repo, 'R1').computed_items, 'vankus')).toBe(4);
    expect(count(pkgOf(repo, 'R2').computed_items, 'vankus')).toBe(4);
    const newEvents = repo.events.slice(eventsBefore);
    expect(newEvents.length).toBe(2);
    expect(newEvents.every((e) => e.event === 'settings_recompute')).toBe(true);

    // duvet type per apartment (Settings, lowest precedence) – listing has no duvet info
    repo.settings.set('duvet_types', { L1: 'male' });
    await recomputeWindow(rdeps(repo), 'settings');
    const p1 = pkgOf(repo, 'R1');
    expect(p1.computed_items.duvetSource).toBe('setting');
    expect(count(p1.computed_items, 'paplonM')).toBe(2);
    expect(count(p1.computed_items, 'paplonV')).toBe(0);
    expect(count(pkgOf(repo, 'R2').computed_items, 'paplonV')).toBe(1);
  });

  it('a change that is not from Settings is logged as recomputed, and an unchanged run writes nothing', async () => {
    const repo = newRepo();
    await repo.upsertListings([listingRow('L1')]);
    await repo.upsertReservations([resRow('R1', 'L1', addDays(D0, -2), D0, 4), resRow('R2', 'L1', D0, D2, 3)]);
    await recomputeWindow(rdeps(repo), 'cron');
    const n = repo.events.length;
    const again = await recomputeWindow(rdeps(repo), 'cron');
    expect(again).toMatchObject({ created: 0, updated: 0, moved: 0, cancelled: 0, restored: 0, unchanged: 2 });
    expect(repo.events.length).toBe(n);

    await repo.upsertReservations([resRow('R2', 'L1', D0, D2, 2, { fetched_at: shift(H) })]);
    const r = await recomputeWindow(rdeps(repo, at(shift(H))), 'cron');
    expect(r.updated).toBe(1);
    expect(pkgOf(repo, 'R1').target_people).toBe(2);
    const ev = repo.events.slice(n);
    expect(ev.length).toBe(1);
    expect(ev[0].event).toBe('recomputed');
    expect(JSON.stringify(ev[0].data)).toContain('3');
  });

  it('calendar: an unavailable day blocks the gap, min nights block it, a missing day is min_nights_unknown and packs for capacity', async () => {
    const repo = newRepo();
    await repo.upsertListings([listingRow('L1'), listingRow('L2'), listingRow('L3')]);
    await repo.upsertReservations([
      resRow('R1', 'L1', addDays(D0, -2), D0, 4),
      resRow('A1', 'L1', D1, D3, 2),
      resRow('R2', 'L2', addDays(D0, -2), D0, 4),
      resRow('A2', 'L2', D1, D3, 2),
      resRow('R3', 'L3', addDays(D0, -2), D0, 4),
      resRow('A3', 'L3', D1, D3, 2),
    ]);
    await repo.upsertCalendar([
      calRow('L1', D0, 1, 'unavailable'), // blocked in the calendar although min nights would allow it
      calRow('L2', D0, 2, 'available'), // 1 free night, min stay 2
      // L3: no calendar row at all
    ]);
    await recomputeWindow(rdeps(repo), 'cron');

    const p1 = pkgOf(repo, 'R1');
    expect(p1.gap_nights).toBe(1);
    expect(p1.gap_blocked).toBe(true);
    expect(p1.computed_items.gap?.reason).toBe('calendar_blocked');
    expect(p1.people_source).toBe('gap');
    expect(p1.target_people).toBe(2);

    const p2 = pkgOf(repo, 'R2');
    expect(p2.gap_blocked).toBe(true);
    expect(p2.computed_items.gap?.reason).toBe('min_nights');
    expect(p2.target_people).toBe(2);

    const p3 = pkgOf(repo, 'R3');
    expect(p3.warnings).toContain('min_nights_unknown');
    expect(p3.gap_blocked).toBeNull();
    expect(p3.people_source).toBe('capacity');
    expect(p3.target_people).toBe(4);
    expect(p3.incoming_reservation_id).toBe('A3');
  });

  it('a check-out moved beyond the window moves the package (date follows, status kept), it is not cancelled', async () => {
    const repo = newRepo();
    await repo.upsertListings([listingRow('L1')]);
    await repo.upsertReservations([resRow('R1', 'L1', addDays(D0, -2), D1)]);
    await recomputeWindow(rdeps(repo), 'cron');
    const p = pkgOf(repo, 'R1');
    const row = repo.packages.get(p.id)!;
    row.status = 'packed';
    row.packed_at = NOW_ISO;
    row.packed_by_name = 'Angelika';

    const far = addDays(D0, 7);
    await repo.upsertReservations([resRow('R1', 'L1', addDays(D0, -2), far, 2, { fetched_at: shift(H) })]);
    const r = await recomputeWindow(rdeps(repo, at(shift(H))), 'cron');
    expect(r.moved).toBe(1);
    expect(r.cancelled).toBe(0);
    const moved = repo.packages.get(p.id)!;
    expect(moved.date).toBe(far);
    expect(moved.status).toBe('packed');
    expect(moved.hidden).toBe(false);
    expect(moved.packed_by_name).toBe('Angelika');
    expect(repo.events.some((e) => e.event === 'moved' && e.package_id === p.id)).toBe(true);
    expect(repo.events.some((e) => e.event === 'cancelled' && e.package_id === p.id)).toBe(false);
    expect((await repo.getPackagesInWindow(windowDates(D0))).length).toBe(0);

    // and back into the window: same package, date follows again
    await repo.upsertReservations([resRow('R1', 'L1', addDays(D0, -2), D2, 2, { fetched_at: shift(2 * H) })]);
    await recomputeWindow(rdeps(repo, at(shift(2 * H))), 'cron');
    expect(repo.packages.size).toBe(1);
    expect(repo.packages.get(p.id)!.date).toBe(D2);
    expect(repo.packages.get(p.id)!.status).toBe('packed');
  });

  it('a listing that leaves scope cancels its packages with listing_out_of_scope; packed stays visible, todo is hidden; back in scope restores', async () => {
    const repo = newRepo();
    await repo.upsertListings([listingRow('L1'), listingRow('L2')]);
    await repo.upsertReservations([resRow('R1', 'L1', addDays(D0, -2), D0), resRow('R2', 'L2', addDays(D0, -2), D0)]);
    await recomputeWindow(rdeps(repo), 'cron');
    const packed = repo.packages.get(pkgOf(repo, 'R2').id)!;
    packed.status = 'packed';
    packed.packed_at = NOW_ISO;
    packed.packed_by_name = 'Angelika';

    await repo.upsertListings([
      listingRow('L1', { in_scope: false, exclusion_reason: 'inactive', active: false, fetched_at: shift(H) }),
      listingRow('L2', { in_scope: false, exclusion_reason: 'owner_cleans', owner_cleans: true, fetched_at: shift(H) }),
    ]);
    const r = await recomputeWindow(rdeps(repo, at(shift(H))), 'cron');
    expect(r.cancelled).toBe(2);
    const p1 = pkgOf(repo, 'R1');
    expect(p1.status).toBe('cancelled');
    expect(p1.cancel_reason).toBe(CANCEL_REASONS.outOfScope);
    expect(p1.cancel_reason).toBe('listing_out_of_scope');
    expect(p1.hidden).toBe(true);
    const p2 = pkgOf(repo, 'R2');
    expect(p2.status).toBe('cancelled');
    expect(p2.hidden).toBe(false);
    expect(p2.packed_by_name).toBe('Angelika');
    expect(repo.events.filter((e) => e.event === 'cancelled').length).toBe(2);

    await repo.upsertListings([listingRow('L1', { fetched_at: shift(2 * H) }), listingRow('L2', { fetched_at: shift(2 * H) })]);
    const r2 = await recomputeWindow(rdeps(repo, at(shift(2 * H))), 'cron');
    expect(r2.restored).toBe(2);
    expect(pkgOf(repo, 'R1').status).toBe('todo');
    expect(pkgOf(repo, 'R1').hidden).toBe(false);
    expect(pkgOf(repo, 'R2').status).toBe('packed');
    expect(repo.events.filter((e) => e.event === 'restored').length).toBe(2);
  });

  it('cancellation: never packed → hidden; packed → stays as Zrušené; re-confirmed → restored with the old status', async () => {
    const repo = newRepo();
    await repo.upsertListings([listingRow('L1'), listingRow('L2')]);
    await repo.upsertReservations([resRow('R1', 'L1', addDays(D0, -2), D0), resRow('R2', 'L2', addDays(D0, -2), D1)]);
    await recomputeWindow(rdeps(repo), 'cron');
    const packed = repo.packages.get(pkgOf(repo, 'R2').id)!;
    packed.status = 'packed';
    packed.packed_at = NOW_ISO;
    packed.packed_by_name = 'Angelika';
    packed.note = 'kľúče v schránke';

    await repo.upsertReservations([
      resRow('R1', 'L1', addDays(D0, -2), D0, 2, { status: 'canceled', fetched_at: shift(H) }),
      resRow('R2', 'L2', addDays(D0, -2), D1, 2, { status: 'canceled', fetched_at: shift(H) }),
    ]);
    const r = await recomputeWindow(rdeps(repo, at(shift(H))), 'cron');
    expect(r.cancelled).toBe(2);
    expect(pkgOf(repo, 'R1')).toMatchObject({ status: 'cancelled', hidden: true });
    expect(pkgOf(repo, 'R2')).toMatchObject({ status: 'cancelled', hidden: false, packed_by_name: 'Angelika', note: 'kľúče v schránke' });
    expect(pkgOf(repo, 'R2').cancelled_at).toBeTruthy();

    // a second cancelled run is a no-op (no duplicate events)
    const n = repo.events.length;
    await recomputeWindow(rdeps(repo, at(shift(H))), 'cron');
    expect(repo.events.length).toBe(n);

    // re-confirmed, R2 on a new date: restored with the old status, the date follows
    await repo.upsertReservations([
      resRow('R1', 'L1', addDays(D0, -2), D0, 2, { fetched_at: shift(2 * H) }),
      resRow('R2', 'L2', addDays(D0, -2), D2, 2, { fetched_at: shift(2 * H) }),
    ]);
    const r2 = await recomputeWindow(rdeps(repo, at(shift(2 * H))), 'cron');
    expect(r2.restored).toBe(2);
    expect(pkgOf(repo, 'R1')).toMatchObject({ status: 'todo', hidden: false, cancel_reason: null });
    expect(pkgOf(repo, 'R2')).toMatchObject({ status: 'packed', hidden: false, date: D2, packed_by_name: 'Angelika' });
    expect(repo.packages.size).toBe(2);
  });

  it('recompute never overwrites the staff columns', async () => {
    const repo = newRepo();
    await repo.upsertListings([listingRow('L1')]);
    await repo.upsertReservations([resRow('R1', 'L1', addDays(D0, -2), D0, 4), resRow('A1', 'L1', D0, D3, 3)]); // A1 checks out after the window
    await recomputeWindow(rdeps(repo), 'cron');
    expect(repo.packages.size).toBe(1);
    const row = repo.packages.get(pkgOf(repo, 'R1').id)!;
    row.status = 'packed';
    row.packed_by = 'u1';
    row.packed_by_name = 'Angelika';
    row.packed_at = NOW_ISO;
    row.note = 'poznámka';
    row.note_by_name = 'Angelika';
    row.checklist = { items: ['kľúče'], checked: { kľúče: true } };
    const before = { ...row, computed_items: undefined };

    // inputs change after packing (guests 3 → 1, per-guest table changes)
    await repo.upsertReservations([resRow('A1', 'L1', D0, D2, 1, { fetched_at: shift(H) })]);
    repo.settings.set('linen_table', { perGuest: { osuskaV: 2, uterakM: 2 } });
    const r = await recomputeWindow(rdeps(repo, at(shift(H))), 'cron');
    expect(r.updated).toBe(1);
    const after = repo.packages.get(row.id)!;
    expect(after.target_people).toBe(1);
    expect(count(after.computed_items, 'osuskaV')).toBe(2);
    for (const k of ['status', 'packed_by', 'packed_by_name', 'packed_at', 'note', 'note_by_name', 'checklist', 'id', 'created_at'] as const) {
      expect(after[k], k).toEqual(before[k]);
    }
  });

  it('diffComputed names the people change and every item whose count changed', async () => {
    const repo = newRepo();
    await repo.upsertListings([listingRow('L1')]);
    await repo.upsertReservations([resRow('R1', 'L1', addDays(D0, -2), D0, 4), resRow('A1', 'L1', D0, D2, 3)]);
    await recomputeWindow(rdeps(repo), 'cron');
    const before = { ...pkgOf(repo, 'R1') };
    await repo.upsertReservations([resRow('A1', 'L1', D0, D2, 1, { fetched_at: shift(H) })]);
    await recomputeWindow(rdeps(repo, at(shift(H))), 'cron');
    const after = pkgOf(repo, 'R1');
    const diff = JSON.stringify(diffComputed(before, after));
    expect(diff).toContain('people 3→1');
    expect(diff).toContain('osuskaV');
    expect(diff).toContain('toaletak'); // max(2, people): 3 → 2
    expect(diff).toContain('vankus 4→2'); // the sofa is no longer needed for 1 person
    expect(diff).not.toContain('utierky'); // per apartment, unchanged
    expect(JSON.stringify(diffComputed(after, after))).not.toContain('people');
  });

  it('diffComputed names a changed bed plan and never logs an empty diff for a changed hash', async () => {
    const repo = newRepo();
    await repo.upsertListings([listingRow('L1')]);
    await repo.upsertReservations([resRow('R1', 'L1', addDays(D0, -2), D0, 4), resRow('A1', 'L1', D0, D2, 3)]);
    await recomputeWindow(rdeps(repo), 'cron');
    const before = { ...pkgOf(repo, 'R1') };
    await repo.upsertReservations([resRow('A1', 'L1', D0, D2, 1, { fetched_at: shift(H) })]);
    await recomputeWindow(rdeps(repo, at(shift(H))), 'cron');
    const after = pkgOf(repo, 'R1');
    expect((diffComputed(before, after).changed as string[]).some((c) => c.startsWith('postele '))).toBe(true);
    // only the hash differs (e.g. a private-linen flat whose bed plan changed): the diff still says something
    const ghost = { ...after, computed_hash: 'other', computed_items: { ...after.computed_items, beds: before.computed_items.beds } };
    const d = diffComputed(after, { ...after, computed_hash: 'other' });
    expect(d.changed).toEqual(['iné (texty / plán postelí)']);
    expect((diffComputed(after, ghost).changed as string[]).length).toBeGreaterThan(0);
  });
});

// =====================================================================
describe('reconcile – arrivals paging and fallbacks', () => {
  function pagingData(perBusy: number, farDay: number) {
    const listings = ids(25).map((id) => fakeListing(id));
    const reservations: ParsedReservation[] = [];
    for (const l of listings) reservations.push(fakeRes(`out-${l._id}`, l._id, addDays(D0, -3), D0, 2));
    for (const busy of ['L01', 'L02', 'L03']) {
      for (let k = 0; k < perBusy; k++) reservations.push(fakeRes(`arr-${busy}-${k}`, busy, addDays(D0, k), addDays(D0, k + 1), 2));
    }
    for (const l of listings.slice(3)) reservations.push(fakeRes(`arr-${l._id}`, l._id, addDays(D0, farDay), addDays(D0, farDay + 2), 3));
    return fakeData(listings, reservations);
  }

  it('page 1 dominated by three busy listings: every other listing still gets its next arrival', async () => {
    const repo = newRepo();
    const client = createFakeGuestyClient(pagingData(40, 45)); // 120 busy rows come before the 22 others
    const r = await reconcile(cdeps(repo, client), 'cron');
    expect(r.ok, r.error ?? '').toBe(true);
    expect(r.skipped).toBe(false);
    for (const id of ids(25).slice(3)) {
      const p = pkgOf(repo, `out-${id}`);
      expect(p.incoming_reservation_id, id).toBe(`arr-${id}`);
      expect(p.computed_items.next?.guests, id).toBe(3);
    }
    expect(pkgOf(repo, 'out-L01').incoming_reservation_id).toBe('arr-L01-0');
    expect(pkgOf(repo, 'out-L01').same_day).toBe(true);
  });

  it('busy listings beyond the page cap: the unresolved listings are still resolved (fallback), none is silently left without its arrival', async () => {
    const repo = newRepo();
    const client = createFakeGuestyClient(pagingData(400, 450)); // 1200 busy rows before the others
    const r = await reconcile(cdeps(repo, client), 'cron');
    expect(r.ok, r.error ?? '').toBe(true);
    for (const id of ids(25).slice(3)) {
      expect(pkgOf(repo, `out-${id}`).incoming_reservation_id, id).toBe(`arr-${id}`);
    }
  });

  it('Guesty rejecting filter[listingId] with 400 falls back to an unfiltered query and still resolves arrivals', async () => {
    const repo = newRepo();
    const data = fakeData(
      [fakeListing('L1'), fakeListing('L2'), fakeListing('L3')],
      [
        fakeRes('R1', 'L1', addDays(D0, -3), D0, 4),
        fakeRes('A1', 'L1', D0, D2, 3), // same day
        fakeRes('R2', 'L2', addDays(D0, -3), D0, 4),
        fakeRes('A2', 'L2', D1, D3, 1), // 1-night gap, min stay 2
        fakeRes('R3', 'L3', addDays(D0, -3), D1, 4), // no next
        fakeRes('Z', 'L9', D0, D2, 2), // unknown listing must be ignored
      ],
      { L2: [{ date: D0, minNights: 2, status: 'available', cta: false }] },
    );
    const base = createFakeGuestyClient(data);
    let rejected = 0;
    const client = {
      ...base,
      searchReservations: (p: SearchParams) => {
        if (p.listingIds?.length) {
          rejected++;
          return Promise.reject(new GuestyApiError(400, '/reservations-v3/search', { message: 'filter[listingId] is not supported' }));
        }
        return base.searchReservations(p);
      },
    };
    const r = await reconcile(cdeps(repo, client), 'cron');
    expect(r.ok, r.error ?? '').toBe(true);
    expect(rejected).toBeGreaterThan(0);
    expect(pkgOf(repo, 'R1')).toMatchObject({ same_day: true, incoming_reservation_id: 'A1', target_people: 3 });
    expect(pkgOf(repo, 'R2')).toMatchObject({ incoming_reservation_id: 'A2', people_source: 'gap', target_people: 1 });
    expect(pkgOf(repo, 'R3').incoming_reservation_id).toBeNull();
    expect(pkgOf(repo, 'R3').people_source).toBe('capacity');
    expect([...repo.packages.values()].some((p) => p.listing_id === 'L9')).toBe(false);
    // 422 behaves the same on the next run
    const client422 = {
      ...base,
      searchReservations: (p: SearchParams) =>
        p.listingIds?.length ? Promise.reject(new GuestyApiError(422, '/reservations-v3/search', {})) : base.searchReservations(p),
    };
    const r2 = await reconcile(cdeps(repo, client422, at(shift(3 * 60_000))), 'cron');
    expect(r2.ok, r2.error ?? '').toBe(true);
    expect(pkgOf(repo, 'R1').incoming_reservation_id).toBe('A1');
  });
});

// =====================================================================
describe('reconcile – absence verification', () => {
  function manyData(n: number) {
    const listings = ids(n).map((id) => fakeListing(id));
    const reservations = listings.map((l, i) => fakeRes(`R-${l._id}`, l._id, addDays(D0, -3), addDays(D0, i % 3), 2));
    return fakeData(listings, reservations);
  }

  it('35 reservations cancelled in Guesty are all cancelled within two runs (ids verified ≤ 10 per call, capped per run)', async () => {
    const repo = newRepo();
    const client = createFakeGuestyClient(manyData(35));
    const r1 = await reconcile(cdeps(repo, client), 'cron');
    expect(r1.ok, r1.error ?? '').toBe(true);
    expect(repo.packages.size).toBe(35);
    for (const res of client.data.reservations) res.status = 'canceled';

    let cancelled = 0;
    let runs = 0;
    for (let i = 1; i <= 4 && cancelled < 35; i++) {
      const r = await reconcile(cdeps(repo, client, at(shift(i * 3 * 60_000))), 'cron');
      runs++;
      expect(r.ok, r.error ?? '').toBe(true);
      cancelled = [...repo.packages.values()].filter((p) => p.status === 'cancelled').length;
      if (i === 1) expect(cancelled).toBeGreaterThan(0);
    }
    expect(cancelled).toBe(35);
    expect(runs).toBeLessThanOrEqual(2);
    expect([...repo.packages.values()].every((p) => p.cancel_reason === CANCEL_REASONS.not_confirmed && p.hidden)).toBe(true);
    expect(repo.events.filter((e) => e.event === 'cancelled').length).toBe(35);
  });

  it('reservations that vanished from Guesty are cancelled as deleted only after two consecutive not-found runs', async () => {
    const repo = newRepo();
    const client = createFakeGuestyClient(manyData(35));
    await reconcile(cdeps(repo, client), 'cron');
    client.data.reservations = [];

    const r2 = await reconcile(cdeps(repo, client, at(shift(3 * 60_000))), 'cron');
    expect(r2.ok, r2.error ?? '').toBe(true);
    expect([...repo.packages.values()].filter((p) => p.status === 'cancelled').length).toBe(0);
    const flagged = [...repo.reservations.values()].filter((x) => x.not_found_runs === 1).length;
    expect(flagged).toBeGreaterThan(0);
    expect([...repo.reservations.values()].every((x) => x.not_found_runs <= 1)).toBe(true);

    let cancelled = 0;
    for (let i = 2; i <= 7 && cancelled < 35; i++) {
      await reconcile(cdeps(repo, client, at(shift(i * 3 * 60_000))), 'cron');
      cancelled = [...repo.packages.values()].filter((p) => p.status === 'cancelled').length;
    }
    expect(cancelled).toBe(35);
    expect([...repo.packages.values()].every((p) => p.cancel_reason === CANCEL_REASONS.deleted)).toBe(true);
  });

  it('a transient error in the absence check leaves packages untouched and marks the run partial', async () => {
    const repo = newRepo();
    const base = createFakeGuestyClient(manyData(3));
    await reconcile(cdeps(repo, base), 'cron');
    base.data.reservations = [];
    const client = { ...base, getReservationsByIds: async () => Promise.reject(new GuestyApiError(503, '/reservations-v3', null)) };
    const r = await reconcile(cdeps(repo, client, at(shift(3 * 60_000))), 'cron');
    expect(r.ok).toBe(true);
    expect(r.partial).toContain('absence');
    expect([...repo.packages.values()].every((p) => p.status === 'todo' && !p.hidden)).toBe(true);
    expect([...repo.reservations.values()].every((x) => x.not_found_runs === 0)).toBe(true);
  });

  // Proposal §5 step 4: "not found on two consecutive runs → treated as deleted". A reservation that
  // reappears in the check-out search must therefore start counting from zero again.
  it('a reservation seen again after one not-found run has its counter reset', async () => {
    const repo = newRepo();
    const client = createFakeGuestyClient(manyData(2));
    await reconcile(cdeps(repo, client), 'cron');
    const keep = client.data.reservations;
    client.data.reservations = [];
    await reconcile(cdeps(repo, client, at(shift(3 * 60_000))), 'cron');
    expect(repo.reservations.get('R-L01')!.not_found_runs).toBe(1);
    client.data.reservations = keep;
    await reconcile(cdeps(repo, client, at(shift(6 * 60_000))), 'cron');
    expect(repo.reservations.get('R-L01')!.not_found_runs).toBe(0);
    client.data.reservations = [];
    await reconcile(cdeps(repo, client, at(shift(9 * 60_000))), 'cron');
    expect(pkgOf(repo, 'R-L01').status).toBe('todo'); // only one not-found run since it was last seen
  });
});

// =====================================================================
describe('reconcile – partial vs failed runs, counters, listings', () => {
  function smallData() {
    return fakeData(
      [fakeListing('L1'), fakeListing('L2')],
      [fakeRes('R1', 'L1', addDays(D0, -3), D0, 4), fakeRes('A1', 'L1', D1, D3, 2), fakeRes('R2', 'L2', addDays(D0, -3), D1, 4)],
      { L1: [{ date: D0, minNights: 2, status: 'available', cta: false }] },
    );
  }

  it('calendar failure is partial (ok, packages written, partial_runs counted); check-outs failure is failed (consecutive_failures); a clean run resets both', async () => {
    const repo = newRepo();
    const base = createFakeGuestyClient(smallData());
    const noCal = { ...base, getCalendarDays: async () => Promise.reject(new GuestyApiError(422, '/availability-pricing/api/calendar/listings', {})) };
    const rA = await reconcile(cdeps(repo, noCal), 'cron');
    expect(rA.ok).toBe(true);
    expect(rA.partial).toEqual(['calendar']);
    expect(repo.packages.size).toBe(2);
    expect(pkgOf(repo, 'R1').warnings).toContain('min_nights_unknown');
    expect(await repo.getState('partial_runs')).toBe(1);
    expect(await repo.getState('consecutive_failures')).toBe(0);
    expect(await repo.getState('last_ok_sync_at')).toBeTruthy();

    const rA2 = await reconcile(cdeps(repo, noCal, at(shift(3 * 60_000))), 'cron');
    expect(rA2.partial).toEqual(['calendar']);
    expect(await repo.getState('partial_runs')).toBe(2);
    const okAt = await repo.getState<string>('last_ok_sync_at'); // a partial run still counts as a successful sync
    expect(okAt).toBe(shift(3 * 60_000));

    const broken = { ...base, searchReservations: async () => Promise.reject(new GuestyApiError(500, '/reservations-v3/search', null)) };
    const rB = await reconcile(cdeps(repo, broken, at(shift(6 * 60_000))), 'cron');
    expect(rB.ok).toBe(false);
    expect(rB.error).toBeTruthy();
    expect(await repo.getState('consecutive_failures')).toBe(1);
    expect(await repo.getState('last_ok_sync_at')).toBe(okAt);
    // failed run must not touch the packages
    expect(pkgOf(repo, 'R1').status).toBe('todo');
    const rB2 = await reconcile(cdeps(repo, broken, at(shift(9 * 60_000))), 'cron');
    expect(rB2.ok).toBe(false);
    expect(await repo.getState('consecutive_failures')).toBe(2);

    const rC = await reconcile(cdeps(repo, base, at(shift(12 * 60_000))), 'cron');
    expect(rC.ok).toBe(true);
    expect(rC.partial).toEqual([]);
    expect(await repo.getState('consecutive_failures')).toBe(0);
    expect(await repo.getState('partial_runs')).toBe(0);
    expect(await repo.getState('last_ok_sync_at')).not.toBe(okAt);
    expect(pkgOf(repo, 'R1').warnings).not.toContain('min_nights_unknown');
    expect(pkgOf(repo, 'R1').people_source).toBe('gap');
  });

  it('a listings failure on a later run is partial: the previous listings stay, packages still recompute', async () => {
    const repo = newRepo();
    const base = createFakeGuestyClient(smallData());
    await reconcile(cdeps(repo, base), 'cron');
    const noListings = { ...base, listListings: async () => Promise.reject(new GuestyApiError(500, '/listings', null)) };
    base.data.reservations.push(fakeRes('R9', 'L2', addDays(D0, -1), D2, 2));
    const r = await reconcile(cdeps(repo, noListings, at(shift(3 * 60_000)), { forceListings: true }), 'cron');
    expect(r.ok).toBe(true);
    expect(r.partial).toContain('listings');
    expect((await repo.getListings()).length).toBe(2);
    expect(pkgOf(repo, 'R9').status).toBe('todo');
    expect(repo.packages.size).toBe(3);
  });

  it('listings are fetched at most hourly unless forced', async () => {
    const repo = newRepo();
    const client = createFakeGuestyClient(smallData());
    const r1 = await reconcile(cdeps(repo, client), 'cron');
    expect(r1.stats.listings).toBeDefined();
    const r2 = await reconcile(cdeps(repo, client, at(shift(30 * 60_000))), 'cron');
    expect(r2.stats.listings).toBeUndefined();
    const r3 = await reconcile(cdeps(repo, client, at(shift(61 * 60_000))), 'cron');
    expect(r3.stats.listings).toBeDefined();
    const r4 = await reconcile(cdeps(repo, client, at(shift(64 * 60_000)), { forceListings: true }), 'admin');
    expect(r4.stats.listings).toBeDefined();
  });

  it('a listing deactivated in Guesty takes its package out with listing_out_of_scope; reactivating restores it', async () => {
    const repo = newRepo();
    const client = createFakeGuestyClient(smallData());
    await reconcile(cdeps(repo, client), 'cron');
    client.data.listings.find((l) => l._id === 'L2')!.active = false;
    const r = await reconcile(cdeps(repo, client, at(shift(3 * 60_000)), { forceListings: true }), 'cron');
    expect(r.ok, r.error ?? '').toBe(true);
    expect((await repo.getListing('L2'))!.in_scope).toBe(false);
    expect((await repo.getListing('L2'))!.exclusion_reason).toBe('inactive');
    expect(pkgOf(repo, 'R2')).toMatchObject({ status: 'cancelled', hidden: true, cancel_reason: 'listing_out_of_scope' });
    expect(pkgOf(repo, 'R1').status).toBe('todo');

    client.data.listings.find((l) => l._id === 'L2')!.active = true;
    await reconcile(cdeps(repo, client, at(shift(6 * 60_000)), { forceListings: true }), 'cron');
    expect(pkgOf(repo, 'R2')).toMatchObject({ status: 'todo', hidden: false, cancel_reason: null });
  });

  it('every run leaves a sync_runs row with trigger, ok, partial, guesty_calls and stats', async () => {
    const repo = newRepo();
    const base = createFakeGuestyClient(smallData());
    const noCal = { ...base, getCalendarDays: async () => Promise.reject(new Error('boom')) };
    const r = await reconcile(cdeps(repo, noCal), 'admin');
    const runs = await repo.getRecentRuns('reconcile', 10);
    expect(runs.length).toBe(1);
    expect(runs[0].id).toBe(r.runId);
    expect(runs[0]).toMatchObject({ job: 'reconcile', trigger: 'admin', ok: true, partial: ['calendar'] });
    expect(runs[0].finished_at).toBeTruthy();
    expect(runs[0].guesty_calls).toBeGreaterThan(0);
    expect(runs[0].stats).toMatchObject({ checkouts: 2 });
    expect(r.recompute?.created).toBe(2);
    // the lock is released afterwards: the next run is not skipped
    const r2 = await reconcile(cdeps(repo, base, at(shift(60_000))), 'cron');
    expect(r2.skipped).toBe(false);
  });
});

// =====================================================================
describe('gapsNeedingCalendar', () => {
  const out = (id: string, l: string, checkOut: string) => resRow(id, l, addDays(checkOut, -3), checkOut);
  const arr = (id: string, l: string, checkIn: string) => resRow(id, l, checkIn, addDays(checkIn, 2));

  it('needs the arrival days of gaps of 1..14 nights only', () => {
    expect(gapsNeedingCalendar([out('R1', 'L1', D0)], [arr('A1', 'L1', D1)])).toEqual([{ listingId: 'L1', from: D0, to: D0 }]);
    expect(gapsNeedingCalendar([out('R1', 'L1', D0)], [arr('A1', 'L1', D3)])).toEqual([{ listingId: 'L1', from: D0, to: D2 }]);
    expect(gapsNeedingCalendar([out('R1', 'L1', D0)], [arr('A1', 'L1', addDays(D0, 14))])).toEqual([{ listingId: 'L1', from: D0, to: addDays(D0, 13) }]);
    expect(gapsNeedingCalendar([out('R1', 'L1', D0)], [arr('A1', 'L1', addDays(D0, 15))])).toEqual([]);
  });

  it('same-day check-in, no next arrival, another listing, and the outgoing itself need nothing', () => {
    expect(gapsNeedingCalendar([out('R1', 'L1', D0)], [arr('A1', 'L1', D0)])).toEqual([]);
    expect(gapsNeedingCalendar([out('R1', 'L1', D0)], [])).toEqual([]);
    expect(gapsNeedingCalendar([out('R1', 'L1', D0)], [arr('A1', 'L2', D1)])).toEqual([]);
    const o = out('R1', 'L1', D0);
    expect(gapsNeedingCalendar([o], [o])).toEqual([]);
  });

  it('uses the earliest arrival per check-out and handles several check-outs of one listing', () => {
    const needs = gapsNeedingCalendar([out('R1', 'L1', D0), out('R2', 'L1', D2)], [arr('A2', 'L1', addDays(D0, 5)), arr('A1', 'L1', D1)]);
    expect(needs).toEqual(expect.arrayContaining([{ listingId: 'L1', from: D0, to: D0 }, { listingId: 'L1', from: D2, to: addDays(D0, 4) }]));
    expect(needs.length).toBe(2);
  });
});

// =====================================================================
describe('nightly – retention and webhook health', () => {
  it('retention removes old runs, old webhook events, calendar days before yesterday and unreferenced old reservations; keeps packages and events', async () => {
    const repo = newRepo();
    const day = (n: number) => shift(n * DAY);
    repo.runs.push(
      { id: 1, job: 'reconcile', trigger: 'cron', started_at: day(-31), finished_at: day(-31), ok: true, partial: [], error: null, guesty_calls: 1, stats: {} },
      { id: 2, job: 'reconcile', trigger: 'cron', started_at: day(-10), finished_at: day(-10), ok: true, partial: [], error: null, guesty_calls: 1, stats: {} },
    );
    repo.webhookEvents.push(
      { id: 1, svix_id: 'a', event_id: 'a', event: 'reservation.updated.v2', object_id: 'x', received_at: day(-91), processed_at: day(-91), status: 'processed', attempts: 1, error: null, payload: {} },
      { id: 2, svix_id: 'b', event_id: 'b', event: 'reservation.updated.v2', object_id: 'y', received_at: day(-89), processed_at: day(-89), status: 'processed', attempts: 1, error: null, payload: {} },
    );
    await repo.upsertCalendar([calRow('L1', addDays(D0, -2), 1), calRow('L1', addDays(D0, -1), 1), calRow('L1', D0, 1)]);
    await repo.upsertListings([listingRow('L1')]);
    const old = addDays(D0, -61);
    await repo.upsertReservations([
      resRow('OLD', 'L1', addDays(old, -2), old), // no package → removed
      resRow('REF', 'L1', addDays(old, -5), old), // referenced by a package → kept
      resRow('NEW', 'L1', addDays(D0, -12), addDays(D0, -10)), // recent → kept
    ]);
    // create a package for REF by recomputing "as of" that day, while OLD is hidden from that window
    repo.reservations.get('OLD')!.status = 'canceled';
    await recomputeWindow(rdeps(repo), 'test', old);
    repo.reservations.get('OLD')!.status = 'confirmed';
    expect(pkgOf(repo, 'REF').status).toBe('todo');
    const packagesBefore = repo.packages.size;
    const eventsBefore = repo.events.length;

    const res = await repo.runRetention(new Date(NOW_ISO));
    expect(res).toEqual({ sync_runs: 1, webhook_events: 1, calendar: 1, reservations: 1 });
    expect(repo.runs.map((r) => r.id)).toEqual([2]);
    expect(repo.webhookEvents.map((e) => e.id)).toEqual([2]);
    expect((await repo.getCalendar(['L1'], addDays(D0, -5), D0)).map((c) => c.date).sort()).toEqual([addDays(D0, -1), D0]);
    expect([...repo.reservations.keys()].sort()).toEqual(['NEW', 'REF']);
    expect(repo.packages.size).toBe(packagesBefore);
    expect(repo.events.length).toBe(eventsBefore);
  });

  it('checkWebhookHealth: registered when our URL is listed, null without a URL, silent after 24 h without a delivery', async () => {
    const URL = 'https://pracovna.example/api/guesty/webhook';
    const data = fakeData([fakeListing('L1')], [fakeRes('R1', 'L1', addDays(D0, -3), D0)]);
    data.webhooks = [{ _id: 'wh1', url: URL, events: ['reservation.created.v2', 'reservation.updated.v2', 'listing.new', 'listing.updated', 'listing.removed'] }];
    const repo = newRepo();
    const client = createFakeGuestyClient(data);
    await reconcile(cdeps(repo, client), 'cron'); // there were changes today (packages created)

    await repo.setState('last_webhook_at', shift(-H));
    expect(await checkWebhookHealth({ repo, client, webhookUrl: URL, now: at(NOW_ISO) })).toEqual({ registered: true, lastWebhookAt: shift(-H), silent: false });
    expect((await checkWebhookHealth({ repo, client, webhookUrl: 'https://other.example/api/guesty/webhook', now: at(NOW_ISO) })).registered).toBe(false);
    expect((await checkWebhookHealth({ repo, client, webhookUrl: null, now: at(NOW_ISO) })).registered).toBeNull();

    await repo.setState('last_webhook_at', shift(-25 * H));
    const h = await checkWebhookHealth({ repo, client, webhookUrl: URL, now: at(NOW_ISO) });
    expect(h.registered).toBe(true);
    expect(h.silent).toBe(true);
    // a fresh delivery clears it
    await repo.setState('last_webhook_at', shift(-23 * H));
    expect((await checkWebhookHealth({ repo, client, webhookUrl: URL, now: at(NOW_ISO) })).silent).toBe(false);
  });

  it('nightly runs retention, refreshes listings, checks the webhook and recomputes; it is logged as a nightly run', async () => {
    const URL = 'https://pracovna.example/api/guesty/webhook';
    const data = fakeData([fakeListing('L1'), fakeListing('L2')], [fakeRes('R1', 'L1', addDays(D0, -3), D0), fakeRes('R2', 'L2', addDays(D0, -3), D1)]);
    data.webhooks = [{ _id: 'wh1', url: URL, events: [] }];
    const repo = newRepo();
    const client = createFakeGuestyClient(data);
    await reconcile(cdeps(repo, client), 'cron');
    repo.runs.push({ id: 999, job: 'reconcile', trigger: 'cron', started_at: shift(-40 * DAY), finished_at: shift(-40 * DAY), ok: true, partial: [], error: null, guesty_calls: 1, stats: {} });
    await repo.setState('last_webhook_at', shift(-H));
    data.listings.find((l) => l._id === 'L2')!.active = false;

    const nightNow = at(`${D1}T04:00:00+02:00`);
    repo.now = nightNow;
    const stats = await nightly({ repo, client, laundryFieldId: LAUNDRY_FIELD_ID, webhookUrl: URL, log: silentLogger, now: nightNow });
    expect(JSON.stringify(stats)).toContain('sync_runs');
    expect(repo.runs.some((r) => r.id === 999)).toBe(false);
    const run = repo.runs.find((r) => r.job === 'nightly')!;
    expect(run).toBeTruthy();
    expect(run.ok).toBe(true);
    expect(run.finished_at).toBeTruthy();
    // the full listing refresh took L2 out of scope and its package with it
    expect((await repo.getListing('L2'))!.in_scope).toBe(false);
    expect(pkgOf(repo, 'R2').status).toBe('cancelled');
    expect(pkgOf(repo, 'R1').status).toBe('todo');
  });
});

// =====================================================================
describe('alerts', () => {
  const cond = (over: Partial<Record<AlertKind, boolean>> = {}): Record<AlertKind, boolean> => ({
    sync_failed_twice: false,
    token_quota: false,
    webhook_missing: false,
    webhook_silent: false,
    listing_drop: false,
    ...over,
  });

  function harness() {
    const repo = newRepo();
    const posts: string[] = [];
    let t = new Date(NOW_ISO).getTime();
    const fetchMock = (async (_url: unknown, init?: RequestInit) => {
      posts.push(String(init?.body ?? ''));
      return new Response('ok', { status: 200 });
    }) as unknown as typeof fetch;
    const deps = { repo, webhookUrl: 'https://alerts.example/hook', fetch: fetchMock, log: silentLogger, now: () => new Date(t) };
    return { repo, posts, deps, advance: (ms: number) => (t += ms) };
  }

  it('opens once, does not resend within 6 h, resends after 6 h, resolves once', async () => {
    const { repo, posts, deps, advance } = harness();
    const s1 = await evaluateAlerts(deps, cond({ sync_failed_twice: true }));
    expect(posts.length).toBe(1);
    expect(posts[0]).toContain(ALERT_TEXT.sync_failed_twice);
    expect(s1.open.sync_failed_twice?.since).toBe(new Date(NOW_ISO).toISOString());
    expect((await repo.getState<AlertState>('alert_state'))?.open.sync_failed_twice).toBeTruthy();

    advance(H);
    await evaluateAlerts(deps, cond({ sync_failed_twice: true }));
    expect(posts.length).toBe(1);
    advance(4 * H + 59 * 60_000); // 5 h 59 min after the open
    await evaluateAlerts(deps, cond({ sync_failed_twice: true }));
    expect(posts.length).toBe(1);
    advance(2 * 60_000); // 6 h 01 min after the open
    await evaluateAlerts(deps, cond({ sync_failed_twice: true }));
    expect(posts.length).toBe(2);
    expect(posts[1]).toContain(ALERT_TEXT.sync_failed_twice);
    advance(H);
    await evaluateAlerts(deps, cond({ sync_failed_twice: true }));
    expect(posts.length).toBe(2);
    advance(6 * H);
    await evaluateAlerts(deps, cond({ sync_failed_twice: true }));
    expect(posts.length).toBe(3);

    const resolved = await evaluateAlerts(deps, cond());
    expect(posts.length).toBe(4);
    expect(resolved.open.sync_failed_twice).toBeUndefined();
    expect((await repo.getState<AlertState>('alert_state'))?.open.sync_failed_twice).toBeUndefined();
    await evaluateAlerts(deps, cond());
    expect(posts.length).toBe(4);

    // a new incident opens again
    advance(H);
    await evaluateAlerts(deps, cond({ sync_failed_twice: true }));
    expect(posts.length).toBe(5);
  });

  it('several kinds are tracked independently and a missing webhook URL only tracks state', async () => {
    const { posts, deps, advance } = harness();
    await evaluateAlerts(deps, cond({ webhook_missing: true, listing_drop: true }));
    expect(posts.length).toBe(2);
    expect(posts.join('\n')).toContain(ALERT_TEXT.webhook_missing);
    expect(posts.join('\n')).toContain(ALERT_TEXT.listing_drop);
    advance(H);
    const s = await evaluateAlerts(deps, cond({ webhook_missing: true }));
    expect(posts.length).toBe(3); // listing_drop resolved
    expect(Object.keys(s.open)).toEqual(['webhook_missing']);

    const repo2 = newRepo();
    const s2 = await evaluateAlerts({ repo: repo2, webhookUrl: null, log: silentLogger, now: at(NOW_ISO) }, cond({ token_quota: true }));
    expect(s2.open.token_quota?.since).toBe(new Date(NOW_ISO).toISOString());
    expect((await repo2.getState<AlertState>('alert_state'))?.open.token_quota).toBeTruthy();
  });
});
