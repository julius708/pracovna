import { addDays, diffDays, GAP_MAX_NIGHTS, type Ymd } from '@/core/packing';
import type { SyncRepo } from '@/db/repo';
import type { CalendarRow, ReservationRow } from '@/db/types';
import type { GuestyClient } from '@/guesty/client';
import type { Logger } from '@/guesty/log';
import { silentLogger } from '@/guesty/log';
import { findNextArrival } from './recompute';

export interface GapNeed {
  listingId: string;
  from: Ymd;
  /** Last arrival day of the gap (inclusive). */
  to: Ymd;
}

/** Listings and day ranges whose calendar the gap rule needs (gaps of 1..14 nights). */
export function gapsNeedingCalendar(outgoing: ReservationRow[], arrivals: ReservationRow[]): GapNeed[] {
  const out: GapNeed[] = [];
  for (const r of outgoing) {
    if (r.status !== 'confirmed') continue;
    const next = findNextArrival(arrivals, r.listing_id, r.check_out_date, r.guesty_id);
    if (!next) continue;
    const nights = diffDays(r.check_out_date, next.check_in_date);
    if (nights < 1 || nights > GAP_MAX_NIGHTS) continue;
    out.push({ listingId: r.listing_id, from: r.check_out_date, to: addDays(next.check_in_date, -1) });
  }
  return out;
}

export interface MinNightsSyncDeps {
  repo: SyncRepo;
  client: GuestyClient;
  log?: Logger;
  now?: () => Date;
}

/** Fetches the calendar for the needed gaps in one batched call and stores minNights/status/cta per day. */
export async function syncMinNights(deps: MinNightsSyncDeps, needs: GapNeed[]): Promise<{ listings: number; days: number }> {
  if (!needs.length) return { listings: 0, days: 0 };
  const log = (deps.log ?? silentLogger).child({ job: 'min_nights' });
  const listingIds = [...new Set(needs.map((n) => n.listingId))];
  const from = needs.map((n) => n.from).sort()[0];
  const to = needs.map((n) => n.to).sort().at(-1)!;
  const fetchedAt = (deps.now ?? (() => new Date()))().toISOString();
  const days = await deps.client.getCalendarDays(listingIds, from, to);
  const rows: CalendarRow[] = [];
  for (const d of days) {
    const listingId = d.listingId ?? (listingIds.length === 1 ? listingIds[0] : null);
    if (!listingId || !/^\d{4}-\d{2}-\d{2}/.test(d.date)) continue;
    rows.push({
      listing_id: listingId,
      date: d.date.slice(0, 10),
      min_nights: d.minNights ?? null,
      status: d.status ?? null,
      cta: d.cta ?? null,
      source: 'guesty',
      fetched_at: fetchedAt,
    });
  }
  await deps.repo.upsertCalendar(rows);
  log.info('min_nights.synced', { listings: listingIds.length, days: rows.length, from, to });
  return { listings: listingIds.length, days: rows.length };
}
