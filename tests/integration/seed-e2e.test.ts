import { describe, expect, it } from 'vitest';
import { addDays, windowDates } from '@/core/packing';
import { MemoryRepo } from '@/db/memory-repo';
import { createFakeGuestyClient } from '@/guesty/fake-client';
import { silentLogger } from '@/guesty/log';
import { reconcile } from '@/sync/reconcile';
import { createSeedClient, seedListingShapes } from '@/sync/seed';
import { generateSeedData } from '@/sync/seed/generate';
import { LAUNDRY_FIELD_ID } from '@/core/packing';

const TODAY = '2026-10-05';
const at = (iso: string) => () => new Date(iso);

function deps(repo: MemoryRepo, client: ReturnType<typeof createSeedClient>['client'], now = at(`${TODAY}T06:00:00+02:00`)) {
  return { repo, client, laundryFieldId: LAUNDRY_FIELD_ID, log: silentLogger, now };
}

describe('seed mode end to end', () => {
  it('a first reconcile creates a package for every confirmed in-scope check-out of the three days', async () => {
    const repo = new MemoryRepo();
    repo.now = at(`${TODAY}T06:00:00+02:00`);
    const { client, counts } = createSeedClient(TODAY);
    const r = await reconcile(deps(repo, client), 'cron');
    expect(r.ok, r.error ?? '').toBe(true);
    expect(r.skipped).toBe(false);
    expect(r.partial).toEqual([]);

    const listings = await repo.getListings();
    expect(listings.length).toBe(109);
    expect(listings.filter((l) => l.in_scope).length).toBe(102); // 107 real - 5 owner-cleans; KE: and inactive excluded
    expect(listings.find((l) => l.name.startsWith('KE:'))?.exclusion_reason).toBe('city');
    expect(listings.find((l) => l.name === 'Testovacia, Neaktívna')?.exclusion_reason).toBe('inactive');

    const dates = windowDates(TODAY);
    const packages = await repo.getPackagesInWindow(dates);
    const confirmed = client.data.reservations.filter((x) => x.status === 'confirmed' && dates.includes(x.stay?.at(-1)?.checkOutDateLocalized ?? ''));
    const inScope = new Set(listings.filter((l) => l.in_scope).map((l) => l.guesty_id));
    const expected = confirmed.filter((x) => inScope.has(x.stay?.at(-1)?.listingId ?? ''));
    expect(packages.length).toBe(expected.length);
    expect(packages.every((p) => p.status === 'todo' && !p.hidden)).toBe(true);

    // scenario coverage
    const sameDay = packages.filter((p) => p.same_day);
    expect(sameDay.length).toBeGreaterThanOrEqual(counts.sameDay);
    expect(packages.filter((p) => p.people_source === 'gap').length).toBeGreaterThan(0);
    expect(packages.filter((p) => p.people_source === 'capacity').length).toBeGreaterThan(0);
    expect(packages.some((p) => p.warnings.includes('double_checkout'))).toBe(true);
    expect(packages.some((p) => p.warnings.includes('multi_stay'))).toBe(true);
    expect(packages.some((p) => p.computed_items.capsules.some((c) => c.state === 'unsure'))).toBe(true);
    expect(packages.some((p) => p.computed_items.private)).toBe(true);
    // the calendar-blocked gap on day 2 is recognised
    expect(packages.some((p) => p.computed_items.gap?.reason === 'calendar_blocked')).toBe(true);

    // events: one 'created' per package
    expect(repo.events.filter((e) => e.event === 'created').length).toBe(packages.length);
    // run bookkeeping
    expect(await repo.getState('consecutive_failures')).toBe(0);
    expect(await repo.getState('last_ok_sync_at')).toBeTruthy();
    expect(repo.runs[0].guesty_calls).toBeGreaterThan(0);
    expect(repo.runs[0].guesty_calls).toBeLessThan(400);
  });

  it('a second reconcile with unchanged data writes nothing new', async () => {
    const repo = new MemoryRepo();
    repo.now = at(`${TODAY}T06:00:00+02:00`);
    const { client } = createSeedClient(TODAY);
    await reconcile(deps(repo, client), 'cron');
    const events = repo.events.length;
    const r = await reconcile(deps(repo, client, at(`${TODAY}T06:03:00+02:00`)), 'cron');
    expect(r.ok).toBe(true);
    expect(r.recompute?.created).toBe(0);
    expect(r.recompute?.updated).toBe(0);
    expect(r.recompute?.cancelled).toBe(0);
    expect(repo.events.length).toBe(events);
    // listings were not refetched within the hour
    expect((r.stats as { listings?: unknown }).listings).toBeUndefined();
  });

  it('a cancellation in Guesty removes a todo package and keeps a packed one as cancelled', async () => {
    const repo = new MemoryRepo();
    repo.now = at(`${TODAY}T06:00:00+02:00`);
    const { client } = createSeedClient(TODAY);
    await reconcile(deps(repo, client), 'cron');
    const packages = await repo.getPackagesInWindow(windowDates(TODAY));
    const [a, b] = packages;
    // b was packed by staff
    const rowB = repo.packages.get(b.id)!;
    rowB.status = 'packed';
    rowB.packed_at = repo.now().toISOString();
    rowB.packed_by_name = 'Angelika';
    // Guesty cancels both
    for (const id of [a.outgoing_reservation_id, b.outgoing_reservation_id]) {
      const res = client.data.reservations.find((x) => x._id === id)!;
      res.status = 'canceled';
    }
    const r = await reconcile(deps(repo, client, at(`${TODAY}T06:03:00+02:00`)), 'cron');
    expect(r.ok).toBe(true);
    expect((r.stats.absence as { cancelled: number }).cancelled).toBe(2);
    const pa = repo.packages.get(a.id)!;
    const pb = repo.packages.get(b.id)!;
    expect(pa.status).toBe('cancelled');
    expect(pa.hidden).toBe(true);
    expect(pb.status).toBe('cancelled');
    expect(pb.hidden).toBe(false);
    expect(pb.packed_by_name).toBe('Angelika');
    expect(repo.events.filter((e) => e.event === 'cancelled').length).toBe(2);

    // re-confirmed -> restored with the old status
    for (const id of [a.outgoing_reservation_id, b.outgoing_reservation_id]) {
      client.data.reservations.find((x) => x._id === id)!.status = 'confirmed';
    }
    await reconcile(deps(repo, client, at(`${TODAY}T06:06:00+02:00`)), 'cron');
    expect(repo.packages.get(a.id)!.status).toBe('todo');
    expect(repo.packages.get(b.id)!.status).toBe('packed');
    expect(repo.events.filter((e) => e.event === 'restored').length).toBe(2);
  });

  it('a reservation deleted in Guesty is cancelled after two consecutive not-found runs', async () => {
    const repo = new MemoryRepo();
    repo.now = at(`${TODAY}T06:00:00+02:00`);
    const { client } = createSeedClient(TODAY);
    await reconcile(deps(repo, client), 'cron');
    const p = (await repo.getPackagesInWindow(windowDates(TODAY)))[0];
    client.data.reservations = client.data.reservations.filter((x) => x._id !== p.outgoing_reservation_id);
    await reconcile(deps(repo, client, at(`${TODAY}T06:03:00+02:00`)), 'cron');
    expect(repo.packages.get(p.id)!.status).toBe('todo');
    expect(repo.reservations.get(p.outgoing_reservation_id)!.not_found_runs).toBe(1);
    await reconcile(deps(repo, client, at(`${TODAY}T06:06:00+02:00`)), 'cron');
    expect(repo.packages.get(p.id)!.status).toBe('cancelled');
    expect(repo.packages.get(p.id)!.cancel_reason).toBe('deleted_in_guesty');
  });

  it('a check-out moved to another day moves the package and keeps its status', async () => {
    const repo = new MemoryRepo();
    repo.now = at(`${TODAY}T06:00:00+02:00`);
    const { client } = createSeedClient(TODAY);
    await reconcile(deps(repo, client), 'cron');
    const p = (await repo.getPackagesInWindow([TODAY])).find((x) => !x.same_day && !x.warnings.includes('double_checkout'))!;
    repo.packages.get(p.id)!.status = 'packed';
    repo.packages.get(p.id)!.packed_at = repo.now().toISOString();
    const res = client.data.reservations.find((x) => x._id === p.outgoing_reservation_id)!;
    const newOut = addDays(TODAY, 1);
    res.checkOutDateLocalized = newOut;
    res.stay![0].checkOutDateLocalized = newOut;
    await reconcile(deps(repo, client, at(`${TODAY}T06:03:00+02:00`)), 'cron');
    const moved = repo.packages.get(p.id)!;
    expect(moved.date).toBe(newOut);
    expect(moved.status).toBe('packed');
    expect(repo.events.some((e) => e.event === 'moved' && e.package_id === p.id)).toBe(true);
  });

  it('the lock makes an overlapping run skip', async () => {
    const repo = new MemoryRepo();
    repo.now = at(`${TODAY}T06:00:00+02:00`);
    const { client } = createSeedClient(TODAY);
    await repo.acquireLock('reconcile', 240, 'other-run');
    const r = await reconcile(deps(repo, client), 'cron');
    expect(r.skipped).toBe(true);
    expect(repo.packages.size).toBe(0);
  });

  it('a failing Guesty search marks the run failed and counts consecutive failures', async () => {
    const repo = new MemoryRepo();
    repo.now = at(`${TODAY}T06:00:00+02:00`);
    const { client } = createSeedClient(TODAY);
    const broken = { ...client, searchReservations: async () => Promise.reject(new Error('boom')) };
    const r1 = await reconcile(deps(repo, broken), 'cron');
    const r2 = await reconcile(deps(repo, broken), 'cron');
    expect(r1.ok).toBe(false);
    expect(r1.error).toContain('checkouts');
    expect(r2.ok).toBe(false);
    expect(await repo.getState('consecutive_failures')).toBe(2);
    expect(repo.runs.filter((x) => x.ok === false).length).toBe(2);
  });

  it('a failing calendar call is only partial: packages still update, gaps become unknown', async () => {
    const repo = new MemoryRepo();
    repo.now = at(`${TODAY}T06:00:00+02:00`);
    const { client } = createSeedClient(TODAY);
    const noCal = { ...client, getCalendarDays: async () => Promise.reject(new Error('422')) };
    const r = await reconcile(deps(repo, noCal), 'cron');
    expect(r.ok).toBe(true);
    expect(r.partial).toEqual(['calendar']);
    const packages = await repo.getPackagesInWindow(windowDates(TODAY));
    expect(packages.length).toBeGreaterThan(0);
    expect(packages.some((p) => p.warnings.includes('min_nights_unknown'))).toBe(true);
    expect(await repo.getState('partial_runs')).toBe(1);
  });

  it('the seed generator is deterministic for a date', () => {
    const a = generateSeedData(seedListingShapes(), { today: TODAY });
    const b = generateSeedData(seedListingShapes(), { today: TODAY });
    expect(a.data.reservations.map((r) => r._id)).toEqual(b.data.reservations.map((r) => r._id));
    expect(a.counts).toEqual(b.counts);
    const fake = createFakeGuestyClient(a.data);
    expect(fake.kind).toBe('fake');
  });
});
