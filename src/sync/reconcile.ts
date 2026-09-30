import { todayInTz, windowDates, type Ymd } from '@/core/packing';
import type { SyncRepo } from '@/db/repo';
import type { ReservationRow } from '@/db/types';
import type { GuestyClient } from '@/guesty/client';
import { GuestyApiError } from '@/guesty/http';
import type { Logger } from '@/guesty/log';
import { silentLogger } from '@/guesty/log';
import { mapReservation } from '@/guesty/mappers';
import { reservationId } from '@/guesty/endpoints/reservations';
import type { ParsedReservation } from '@/guesty/schemas';
import { syncListings } from './listings';
import { gapsNeedingCalendar, syncMinNights } from './minNights';
import { recomputeWindow, type RecomputeResult } from './recompute';
import { processWebhookEvent, type WebhookProcessDeps } from './webhook-handler';

export interface ReconcileDeps {
  repo: SyncRepo;
  client: GuestyClient;
  laundryFieldId: string;
  cleanerFieldId?: string | null;
  log?: Logger;
  now?: () => Date;
  /** Force the listing stage even if it ran less than an hour ago. */
  forceListings?: boolean;
  /** Skip the lock (used by the nightly job which holds its own). */
  skipLock?: boolean;
}

export interface ReconcileResult {
  runId: number;
  ok: boolean;
  skipped: boolean;
  partial: string[];
  error: string | null;
  stats: Record<string, unknown>;
  recompute: RecomputeResult | null;
}

export const LISTINGS_TTL_MS = 60 * 60_000;
export const RECONCILE_LOCK_SECONDS = 240;
const ARRIVAL_CHUNK = 20;
const ARRIVAL_MAX_PAGES = 10;
const ABSENCE_MAX_IDS = 30;
const NOT_FOUND_RUNS_TO_DELETE = 2;

class StageError extends Error {
  constructor(
    public readonly stage: string,
    public readonly fatal: boolean,
    cause: unknown,
  ) {
    super(`${stage}: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = 'StageError';
  }
}

/** Confirmed check-outs in the window from Guesty, mapped and stored. Returns the ids seen. */
async function stageCheckouts(deps: ReconcileDeps, dates: Ymd[], fetchedAt: string): Promise<{ seen: Set<string>; rows: ReservationRow[] }> {
  const search = await deps.client.searchReservations({
    checkOutGte: dates[0],
    checkOutLte: dates[2],
    status: 'confirmed',
    sort: 'checkOut',
  });
  const rows = search.results.map((r) => mapReservation(r, fetchedAt)).filter((r): r is ReservationRow => !!r);
  await deps.repo.upsertReservations(rows);
  return { seen: new Set(rows.map((r) => r.guesty_id)), rows };
}

/**
 * Next check-ins for every listing with a check-out in the window: paged per
 * chunk of listing ids until each listing has an arrival beyond the window
 * (sorted by check-in, so everything earlier is already known).
 */
async function stageArrivals(deps: ReconcileDeps, dates: Ymd[], listingIds: string[], fetchedAt: string): Promise<{ rows: ReservationRow[]; truncated: string[] }> {
  const log = deps.log ?? silentLogger;
  const rows: ReservationRow[] = [];
  const unresolved: string[] = [];
  const beyond = (all: ParsedReservation[], ids: string[]) => {
    const done = new Set<string>();
    for (const r of all) {
      const m = mapReservation(r, fetchedAt);
      if (m && m.check_in_date > dates[2]) done.add(m.arrival_listing_id);
    }
    return ids.every((id) => done.has(id));
  };
  const useListingFilter = (await deps.repo.getState<boolean>('listing_filter_supported' as never)) !== false;

  if (useListingFilter) {
    for (let i = 0; i < listingIds.length; i += ARRIVAL_CHUNK) {
      const chunk = listingIds.slice(i, i + ARRIVAL_CHUNK);
      let search;
      try {
        search = await deps.client.searchReservations({
          listingIds: chunk,
          checkInGte: dates[0],
          status: 'confirmed',
          sort: 'checkIn',
          maxPages: ARRIVAL_MAX_PAGES,
          stopWhen: (all) => beyond(all, chunk),
        });
      } catch (e) {
        if (e instanceof GuestyApiError && (e.status === 400 || e.status === 422)) {
          log.warn('arrivals.listing_filter_rejected', { status: e.status });
          await deps.repo.setState('listing_filter_supported' as never, false);
          return stageArrivalsUnfiltered(deps, dates, listingIds, fetchedAt);
        }
        throw e;
      }
      const mapped = search.results.map((r) => mapReservation(r, fetchedAt)).filter((r): r is ReservationRow => !!r);
      rows.push(...mapped);
      if (search.truncated && !beyond(search.results, chunk)) {
        const done = new Set(mapped.filter((m) => m.check_in_date > dates[2]).map((m) => m.arrival_listing_id));
        unresolved.push(...chunk.filter((id) => !done.has(id)));
      }
    }
    for (const id of unresolved) {
      const one = await deps.client.searchReservations({ listingIds: [id], checkInGte: dates[0], status: 'confirmed', sort: 'checkIn', maxPages: 3 });
      rows.push(...one.results.map((r) => mapReservation(r, fetchedAt)).filter((r): r is ReservationRow => !!r));
    }
  } else {
    return stageArrivalsUnfiltered(deps, dates, listingIds, fetchedAt);
  }
  await deps.repo.upsertReservations(rows);
  return { rows, truncated: unresolved };
}

/** Fallback when filter[listingId] is not usable: one account-wide query, matched in code. */
async function stageArrivalsUnfiltered(deps: ReconcileDeps, dates: Ymd[], listingIds: string[], fetchedAt: string) {
  const wanted = new Set(listingIds);
  const search = await deps.client.searchReservations({
    checkInGte: dates[0],
    status: 'confirmed',
    sort: 'checkIn',
    maxPages: 15,
    stopWhen: (all) => {
      const done = new Set<string>();
      for (const r of all) {
        const m = mapReservation(r, fetchedAt);
        if (m && m.check_in_date > dates[2]) done.add(m.arrival_listing_id);
      }
      return [...wanted].every((id) => done.has(id));
    },
  });
  const rows = search.results
    .map((r) => mapReservation(r, fetchedAt))
    .filter((r): r is ReservationRow => !!r && wanted.has(r.arrival_listing_id));
  await deps.repo.upsertReservations(rows);
  return { rows, truncated: search.truncated ? [...wanted] : [] };
}

/**
 * Reservations we hold as confirmed in the window but did not see: fetch by id.
 * A non-confirmed status cancels; not found twice in a row = deleted in Guesty.
 */
async function stageAbsence(deps: ReconcileDeps, dates: Ymd[], seen: Set<string>, fetchedAt: string): Promise<{ checked: number; cancelled: number; deleted: number }> {
  const held = await deps.repo.getReservations({ checkOutGte: dates[0], checkOutLte: dates[2], status: 'confirmed' });
  const missing = held.filter((r) => !seen.has(r.guesty_id)).slice(0, ABSENCE_MAX_IDS);
  if (!missing.length) return { checked: 0, cancelled: 0, deleted: 0 };
  const fetched = await deps.client.getReservationsByIds(missing.map((r) => r.guesty_id));
  const byId = new Map<string, ParsedReservation>();
  for (const f of fetched) {
    const id = reservationId(f);
    if (id) byId.set(id, f);
  }
  let cancelled = 0;
  let deleted = 0;
  const found: string[] = [];
  const notFound: string[] = [];
  const updates: ReservationRow[] = [];
  for (const r of missing) {
    const f = byId.get(r.guesty_id);
    if (f) {
      found.push(r.guesty_id);
      const m = mapReservation(f, fetchedAt);
      if (m) {
        if (m.status !== 'confirmed') cancelled++;
        updates.push(m);
      }
    } else {
      notFound.push(r.guesty_id);
      if (r.not_found_runs + 1 >= NOT_FOUND_RUNS_TO_DELETE) {
        deleted++;
        updates.push({ ...r, status: 'deleted_in_guesty', fetched_at: fetchedAt });
      }
    }
  }
  await deps.repo.upsertReservations(updates);
  await deps.repo.resetNotFound(found);
  await deps.repo.incrementNotFound(notFound);
  return { checked: missing.length, cancelled, deleted };
}

/** The 3-minute reconciliation (spec §3, proposal §5). */
export async function reconcile(deps: ReconcileDeps, trigger: string): Promise<ReconcileResult> {
  const { repo, client } = deps;
  const now = deps.now ?? (() => new Date());
  const log = (deps.log ?? silentLogger).child({ job: 'reconcile', trigger });
  const runId = await repo.startRun('reconcile', trigger);
  const lockId = `reconcile-${runId}`;
  const stats: Record<string, unknown> = {};
  const partial: string[] = [];
  const callsBefore = client.calls();
  const started = now();

  if (!deps.skipLock && !(await repo.acquireLock('reconcile', RECONCILE_LOCK_SECONDS, lockId))) {
    await repo.finishRun(runId, { ok: true, stats: { skipped: 'locked' } });
    log.info('reconcile.skipped_locked');
    return { runId, ok: true, skipped: true, partial, error: null, stats: { skipped: 'locked' }, recompute: null };
  }

  let recompute: RecomputeResult | null = null;
  let fatal: string | null = null;
  try {
    const today = todayInTz(started);
    const dates = windowDates(today);
    const fetchedAt = started.toISOString();

    // 1. listings (hourly)
    const listingsSyncedAt = await repo.getState<string>('listings_synced_at');
    const listingsStale = deps.forceListings || !listingsSyncedAt || started.getTime() - Date.parse(listingsSyncedAt) > LISTINGS_TTL_MS;
    if (listingsStale) {
      try {
        const r = await syncListings({ repo, client, laundryFieldId: deps.laundryFieldId, cleanerFieldId: deps.cleanerFieldId, log, now });
        stats.listings = r;
      } catch (e) {
        partial.push('listings');
        stats.listings_error = String(e);
        log.warn('reconcile.listings_failed', { error: String(e) });
      }
    }

    // 2. check-outs
    let seen: Set<string>;
    let checkouts: ReservationRow[];
    try {
      const r = await stageCheckouts(deps, dates, fetchedAt);
      seen = r.seen;
      checkouts = r.rows;
      stats.checkouts = checkouts.length;
    } catch (e) {
      throw new StageError('checkouts', true, e);
    }

    // 3. next check-ins
    const listings = await repo.getListings();
    const inScope = new Set(listings.filter((l) => l.in_scope).map((l) => l.guesty_id));
    const listingIds = [...new Set(checkouts.map((r) => r.listing_id).filter((id) => inScope.has(id)))];
    let arrivals: ReservationRow[] = [];
    try {
      const r = await stageArrivals(deps, dates, listingIds, fetchedAt);
      arrivals = r.rows;
      stats.arrivals = { rows: r.rows.length, unresolved: r.truncated.length };
    } catch (e) {
      throw new StageError('arrivals', true, e);
    }

    // 4. absence verification
    try {
      stats.absence = await stageAbsence(deps, dates, seen, fetchedAt);
    } catch (e) {
      partial.push('absence');
      stats.absence_error = String(e);
      log.warn('reconcile.absence_failed', { error: String(e) });
    }

    // 5. min-nights for the gaps
    try {
      const held = await repo.getReservations({ checkOutGte: dates[0], checkOutLte: dates[2], status: 'confirmed' });
      const allArrivals = [...arrivals, ...(await repo.getReservations({ checkInGte: dates[0], status: 'confirmed', listingIds }))];
      const needs = gapsNeedingCalendar(held.filter((r) => inScope.has(r.listing_id)), allArrivals);
      stats.min_nights = await syncMinNights({ repo, client, log, now }, needs);
    } catch (e) {
      partial.push('calendar');
      stats.calendar_error = String(e);
      log.warn('reconcile.calendar_failed', { error: String(e) });
    }

    // 6. recompute
    try {
      recompute = await recomputeWindow({ repo, log, now }, trigger === 'cron' ? 'sync' : trigger, today);
      stats.recompute = recompute;
    } catch (e) {
      throw new StageError('recompute', true, e);
    }

    // 7. retry stuck webhook events
    try {
      const stuck = await repo.getWebhookEventsToRetry(60, 3);
      let retried = 0;
      for (const ev of stuck) {
        const pd: WebhookProcessDeps = { repo, client, laundryFieldId: deps.laundryFieldId, cleanerFieldId: deps.cleanerFieldId, log, now };
        await processWebhookEvent(pd, ev);
        retried++;
      }
      if (retried) stats.webhook_retries = retried;
    } catch (e) {
      log.warn('reconcile.webhook_retry_failed', { error: String(e) });
    }
  } catch (e) {
    fatal = e instanceof Error ? e.message : String(e);
    log.error('reconcile.failed', { error: fatal });
  } finally {
    if (!deps.skipLock) await repo.releaseLock('reconcile', lockId);
  }

  const ok = fatal === null;
  const guestyCalls = client.calls() - callsBefore;
  stats.duration_ms = now().getTime() - started.getTime();
  await repo.finishRun(runId, { ok, partial, error: fatal, guesty_calls: guestyCalls, stats });

  const failures = (await repo.getState<number>('consecutive_failures')) ?? 0;
  if (ok) {
    await repo.setState('last_ok_sync_at', now().toISOString());
    await repo.setState('consecutive_failures', 0);
    const partialRuns = (await repo.getState<number>('partial_runs')) ?? 0;
    await repo.setState('partial_runs', partial.length ? partialRuns + 1 : 0);
  } else {
    await repo.setState('consecutive_failures', failures + 1);
  }
  log.info('reconcile.done', { ok, partial, guesty_calls: guestyCalls, duration_ms: stats.duration_ms });
  return { runId, ok, skipped: false, partial, error: fatal, stats, recompute };
}
