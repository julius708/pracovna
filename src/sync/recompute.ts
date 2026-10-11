import { syncEarlyArrivals, type EarlyArrivalsSyncResult } from './early-arrivals';
import {
  addDays,
  computePackage,
  GAP_MAX_NIGHTS,
  mergeSettings,
  packageHash,
  todayInTz,
  windowDates,
  type CalendarDay,
  type ListingInput,
  type PackageInput,
  type PackingResult,
  type ReservationInput,
  type Ymd,
} from '@/core/packing';
import { loadSettings, type SyncRepo } from '@/db/repo';
import type { CalendarRow, ListingRow, PackageComputed, PackageEventInsert, PackageRow, ReservationRow } from '@/db/types';
import type { Logger } from '@/guesty/log';
import { silentLogger } from '@/guesty/log';

export interface RecomputeDeps {
  repo: SyncRepo;
  log?: Logger;
  now?: () => Date;
}

export interface RecomputeResult {
  today: Ymd;
  packages: number;
  created: number;
  updated: number;
  moved: number;
  unchanged: number;
  cancelled: number;
  restored: number;
  /** Early arrivals derived from the reservations of the window (src/sync/early-arrivals.ts). */
  earlyArrivals?: EarlyArrivalsSyncResult;
}

export const CANCEL_REASONS = {
  not_confirmed: 'reservation_not_confirmed',
  deleted: 'deleted_in_guesty',
  missing: 'reservation_missing',
  outOfScope: 'listing_out_of_scope',
} as const;

export function toListingInput(l: ListingRow): ListingInput {
  return {
    guestyId: l.guesty_id,
    name: l.name,
    beds: l.beds ?? {},
    accommodates: l.accommodates,
    bathrooms: l.bathrooms === null || l.bathrooms === undefined ? null : Number(l.bathrooms),
    laundry: l.laundry,
    cleaner: l.cleaner,
  };
}

export function toReservationInput(r: ReservationRow): ReservationInput {
  return {
    guestyId: r.guesty_id,
    listingId: r.listing_id,
    checkInDate: r.check_in_date,
    checkOutDate: r.check_out_date,
    guests: r.guests,
    adults: r.adults,
    children: r.children,
    infants: r.infants,
    confirmationCode: r.confirmation_code,
    multiStay: r.multi_stay,
  };
}

export function toCalendarDay(c: CalendarRow): CalendarDay {
  return {
    minNights: c.min_nights,
    available: c.status ? c.status === 'available' : null,
    cta: c.cta,
  };
}

/** The next confirmed arrival of a listing on/after the check-out date, excluding the outgoing reservation. */
export function findNextArrival(arrivals: ReservationRow[], listingId: string, checkOut: Ymd, excludeId: string): ReservationRow | null {
  let best: ReservationRow | null = null;
  for (const a of arrivals) {
    if (a.arrival_listing_id !== listingId || a.guesty_id === excludeId || a.status !== 'confirmed') continue;
    if (a.check_in_date < checkOut) continue;
    if (!best || a.check_in_date < best.check_in_date) best = a;
  }
  return best;
}

function computedFrom(r: ReservationRow, listing: ListingRow, next: ReservationRow | null, result: PackingResult): PackageComputed {
  return {
    outgoing_reservation_id: r.guesty_id,
    listing_id: listing.guesty_id,
    listing_name: listing.name,
    date: r.check_out_date,
    incoming_reservation_id: next?.guesty_id ?? null,
    same_day: result.sameDay,
    gap_nights: result.gap?.nights ?? null,
    gap_blocked: result.gap?.blocked ?? null,
    target_people: result.people,
    people_source: result.peopleSource,
    computed_items: result,
    computed_hash: packageHash(result),
    warnings: result.warnings,
  };
}

/** Small human-readable diff for the audit log. */
export function diffComputed(before: PackageComputed, after: PackageComputed): Record<string, unknown> {
  const changed: string[] = [];
  if (before.target_people !== after.target_people) changed.push(`people ${before.target_people}→${after.target_people}`);
  const lines = (r: PackingResult) => Object.fromEntries([...r.linen, ...r.consumables].map((l) => [l.key, l.n]));
  const a = lines(before.computed_items);
  const b = lines(after.computed_items);
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if ((a[key] ?? 0) !== (b[key] ?? 0)) changed.push(`${key} ${a[key] ?? 0}→${b[key] ?? 0}`);
  }
  const bedsOf = (r: PackingResult) => `${r.beds.usedGroups.filter((g) => g !== 'gauc').length} postelí + ${r.beds.sofasUsed} gauč`;
  if (bedsOf(before.computed_items) !== bedsOf(after.computed_items)) changed.push(`postele ${bedsOf(before.computed_items)}→${bedsOf(after.computed_items)}`);
  const capsA = before.computed_items.capsules.map((c) => `${c.typeKey}:${c.n}`).join(',');
  const capsB = after.computed_items.capsules.map((c) => `${c.typeKey}:${c.n}`).join(',');
  if (capsA !== capsB) changed.push(`kapsule ${capsA || '-'}→${capsB || '-'}`);
  if (before.incoming_reservation_id !== after.incoming_reservation_id) changed.push('next reservation');
  if (JSON.stringify(before.warnings) !== JSON.stringify(after.warnings)) changed.push('warnings');
  // the hash covers more than the lines above (texts, bed types, duvet source): never log an empty diff
  if (!changed.length && before.computed_hash !== after.computed_hash) changed.push('iné (texty / plán postelí)');
  return { changed, from_hash: before.computed_hash, to_hash: after.computed_hash };
}

/**
 * Recomputes every package of the board window (WINDOW_DAYS) from database state only:
 * creates, updates (change-only), moves, cancels and restores packages, and
 * writes one audit event per change. Staff columns are never touched.
 */
export async function recomputeWindow(deps: RecomputeDeps, trigger: string, todayOverride?: Ymd): Promise<RecomputeResult> {
  const { repo } = deps;
  const log = (deps.log ?? silentLogger).child({ job: 'recompute', trigger });
  const now = deps.now ?? (() => new Date());
  const today = todayOverride ?? todayInTz(now());
  const dates = windowDates(today);
  const res: RecomputeResult = { today, packages: 0, created: 0, updated: 0, moved: 0, unchanged: 0, cancelled: 0, restored: 0 };
  const events: PackageEventInsert[] = [];
  const sysEvent = (p: PackageRow | PackageComputed & { id: string }, event: PackageEventInsert['event'], data: Record<string, unknown>) =>
    events.push({
      package_id: p.id,
      package_date: p.date,
      listing_id: p.listing_id,
      listing_name: p.listing_name,
      event,
      actor: null,
      actor_name: trigger,
      data,
    });

  const [listingsAll, loaded] = await Promise.all([repo.getListings(), loadSettings(repo)]);
  const listings = new Map(listingsAll.map((l) => [l.guesty_id, l]));
  const settings = mergeSettings(loaded.linen);

  // Outgoing reservations: every reservation with a check-out in the window (any status),
  // plus the reservations of packages that currently sit in the window (they may have moved).
  const last = dates[dates.length - 1];
  const outgoing = await repo.getReservations({ checkOutGte: dates[0], checkOutLte: last });
  const byId = new Map(outgoing.map((r) => [r.guesty_id, r]));
  const windowPackages = await repo.getPackagesInWindow(dates);
  const missingIds = windowPackages.map((p) => p.outgoing_reservation_id).filter((id) => !byId.has(id));
  for (const r of await repo.getReservationsByIds(missingIds)) byId.set(r.guesty_id, r);
  const existing = new Map<string, PackageRow>();
  for (const p of [...windowPackages, ...(await repo.getPackagesByReservationIds([...byId.keys()]))]) existing.set(p.outgoing_reservation_id, p);

  const listingIds = [...new Set([...byId.values()].map((r) => r.listing_id))];
  const arrivals = await repo.getReservations({ checkInGte: dates[0], status: 'confirmed', listingIds });
  const calendarRows = await repo.getCalendar(listingIds, dates[0], addDays(last, GAP_MAX_NIGHTS));
  const calendar = new Map<string, CalendarRow>();
  for (const c of calendarRows) calendar.set(`${c.listing_id}|${c.date}`, c);

  // two check-outs of one flat on one day
  const checkoutCount = new Map<string, number>();
  for (const r of byId.values()) {
    if (r.status !== 'confirmed') continue;
    const k = `${r.listing_id}|${r.check_out_date}`;
    checkoutCount.set(k, (checkoutCount.get(k) ?? 0) + 1);
  }

  const cancel = async (p: PackageRow, reason: string) => {
    if (p.status === 'cancelled') return;
    const hidden = !p.packed_at;
    await repo.setPackageLifecycle(p.id, { status: 'cancelled', hidden, cancel_reason: reason, cancelled_at: now().toISOString() });
    sysEvent(p, 'cancelled', { reason, was: p.status, hidden });
    res.cancelled++;
  };

  // packages in the window whose reservation vanished from the database
  for (const p of windowPackages) {
    if (!byId.has(p.outgoing_reservation_id)) await cancel(p, CANCEL_REASONS.missing);
  }

  for (const r of byId.values()) {
    const listing = listings.get(r.listing_id) ?? null;
    const p = existing.get(r.guesty_id) ?? null;
    const active = r.status === 'confirmed' && !!listing?.in_scope;
    if (!active) {
      if (p) {
        const reason =
          r.status === 'deleted_in_guesty'
            ? CANCEL_REASONS.deleted
            : r.status !== 'confirmed'
              ? CANCEL_REASONS.not_confirmed
              : CANCEL_REASONS.outOfScope;
        await cancel(p, reason);
      }
      continue;
    }
    if (!listing) continue;

    const next = findNextArrival(arrivals, listing.guesty_id, r.check_out_date, r.guesty_id);
    const calendarForGap: Record<Ymd, CalendarDay> = {};
    if (next && next.check_in_date > r.check_out_date) {
      for (let d = r.check_out_date; d < next.check_in_date; d = addDays(d, 1)) {
        const c = calendar.get(`${listing.guesty_id}|${d}`);
        if (c) calendarForGap[d] = toCalendarDay(c);
      }
    }
    const input: PackageInput = {
      date: r.check_out_date,
      listing: toListingInput(listing),
      outgoing: toReservationInput(r),
      next: next ? toReservationInput(next) : null,
      calendar: calendarForGap,
      settings,
      duvetTypeSetting: loaded.duvetTypes[listing.guesty_id] ?? null,
      doubleCheckout: (checkoutCount.get(`${r.listing_id}|${r.check_out_date}`) ?? 0) > 1,
    };
    const result = computePackage(input);
    const computed = computedFrom(r, listing, next, result);
    res.packages++;

    if (!p) {
      const row = await repo.insertPackage(computed);
      sysEvent(row, 'created', { people: computed.target_people, hash: computed.computed_hash });
      res.created++;
      continue;
    }
    if (p.status === 'cancelled') {
      const status = p.packed_at ? 'packed' : 'todo';
      await repo.setPackageLifecycle(p.id, { status, hidden: false, cancel_reason: null, cancelled_at: null });
      sysEvent(p, 'restored', { status, previous_reason: p.cancel_reason });
      res.restored++;
    }
    const moved = p.date !== computed.date || p.listing_id !== computed.listing_id;
    if (moved || p.computed_hash !== computed.computed_hash) {
      await repo.updatePackageComputed(p.id, computed);
      if (moved) {
        sysEvent({ ...computed, id: p.id }, 'moved', { from: { date: p.date, listing_id: p.listing_id }, to: { date: computed.date, listing_id: computed.listing_id } });
        res.moved++;
      }
      if (p.computed_hash !== computed.computed_hash) {
        sysEvent({ ...computed, id: p.id }, trigger === 'settings' ? 'settings_recompute' : 'recomputed', diffComputed(p, computed));
        res.updated++;
      }
    } else {
      res.unchanged++;
    }
  }

  if (events.length) await repo.insertEvents(events);
  // the "Skoré príchody" box follows the reservations we now hold
  res.earlyArrivals = await syncEarlyArrivals(repo, dates, log);
  log.info('recompute.done', { ...res });
  return res;
}
