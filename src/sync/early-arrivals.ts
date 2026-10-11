import { EARLY_ARRIVAL_BEFORE, type Ymd } from '@/core/packing';
import type { SyncRepo } from '@/db/repo';
import type { EarlyArrivalInsert, EarlyArrivalRow, ListingRow, ReservationRow } from '@/db/types';
import type { Logger } from '@/guesty/log';
import { silentLogger } from '@/guesty/log';

/** The author name the sync writes on the rows it derives from Guesty. */
export const GUESTY_AUTHOR = 'Guesty';

export interface EarlyArrivalPlan {
  add: EarlyArrivalInsert[];
  remove: EarlyArrivalRow[];
  kept: number;
}

/**
 * Which early arrivals the board should show for `dates`, from the confirmed
 * reservations we hold (owner, 2026-10-11: early check-ins come from Guesty,
 * nothing is typed in by hand). A reservation counts when its planned arrival
 * (Guesty's check-in clock time) is before EARLY_ARRIVAL_BEFORE and the flat is
 * in scope; one row per flat and day, the earliest time when two reservations
 * meet. Rows already there stay; a changed time or a vanished reservation
 * removes the old row (a new one is added for the new time).
 */
export function planEarlyArrivals(reservations: ReservationRow[], listings: Map<string, ListingRow>, existing: EarlyArrivalRow[], dates: readonly Ymd[]): EarlyArrivalPlan {
  const window = new Set(dates);
  const wanted = new Map<string, EarlyArrivalInsert>();
  for (const r of reservations) {
    if (r.status !== 'confirmed' || !r.arrival_time || r.arrival_time >= EARLY_ARRIVAL_BEFORE) continue;
    if (!window.has(r.check_in_date)) continue;
    const listingId = r.arrival_listing_id || r.listing_id;
    const listing = listings.get(listingId);
    if (!listing || !listing.in_scope) continue;
    const key = `${listingId}|${r.check_in_date}`;
    const cur = wanted.get(key);
    if (cur && cur.arrival <= r.arrival_time) continue;
    wanted.set(key, {
      listing_id: listingId,
      listing_name: listing.name,
      date: r.check_in_date,
      arrival: r.arrival_time,
      note: '',
      author_name: GUESTY_AUTHOR,
      source: 'guesty',
      reservation_id: r.guesty_id,
    });
  }
  const remove: EarlyArrivalRow[] = [];
  let kept = 0;
  for (const row of existing) {
    if (row.removed_at || row.source !== 'guesty') continue;
    const key = `${row.listing_id}|${row.date}`;
    const want = wanted.get(key);
    if (want && want.arrival === row.arrival && want.reservation_id === row.reservation_id) {
      wanted.delete(key);
      kept++;
    } else {
      remove.push(row);
    }
  }
  return { add: [...wanted.values()], remove, kept };
}

export interface EarlyArrivalsSyncResult {
  added: number;
  removed: number;
  kept: number;
}

export interface EarlyArrivalsSyncOutcome extends EarlyArrivalsSyncResult {
  /** The rows just written: what the push notifications announce. */
  addedRows: EarlyArrivalInsert[];
}

/** Brings the early_arrivals table in line with the reservations for the board days (see planEarlyArrivals). */
export async function syncEarlyArrivals(repo: SyncRepo, dates: readonly Ymd[], log: Logger = silentLogger): Promise<EarlyArrivalsSyncOutcome> {
  const last = dates[dates.length - 1];
  const [reservations, listingRows, existing] = await Promise.all([repo.getReservations({ checkInGte: dates[0], status: 'confirmed' }), repo.getListings(), repo.getEarlyArrivals(dates)]);
  const listings = new Map(listingRows.map((l) => [l.guesty_id, l]));
  const plan = planEarlyArrivals(
    reservations.filter((r) => r.check_in_date <= last),
    listings,
    existing,
    dates,
  );
  if (plan.remove.length) await repo.removeEarlyArrivals(plan.remove.map((r) => r.id), GUESTY_AUTHOR);
  if (plan.add.length) await repo.insertEarlyArrivals(plan.add);
  const res = { added: plan.add.length, removed: plan.remove.length, kept: plan.kept };
  if (res.added || res.removed) log.info('early_arrivals.synced', res);
  return { ...res, addedRows: plan.add };
}
