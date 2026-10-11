import { addDays, isYmd, type Ymd } from '@/core/packing';

/** Filter of the História page and its CSV export. */
export interface HistoryFilter {
  from: Ymd;
  to: Ymd;
  listingId?: string;
  actor?: string;
  event?: string;
  page: number;
}

export const HISTORY_PAGE = 100;

/** Dates the filter accepts; keeps the day arithmetic inside four-digit years. */
const MIN_DATE = '2000-01-01';
const MAX_DATE = '2099-12-31';
const accepted = (s: string | null | undefined): s is Ymd => !!s && isYmd(s) && s >= MIN_DATE && s <= MAX_DATE;

/**
 * Reads the filter from the query string (od, do, byt, osoba, udalost, strana).
 * Missing, malformed or out-of-range dates fall back to the last 7 days (or
 * the given defaults); a reversed range is swapped; the page is at least 1.
 */
export function historyFilterFrom(get: (key: string) => string | null | undefined, today: Ymd, defaults: { from?: Ymd; to?: Ymd } = {}): HistoryFilter {
  const od = get('od');
  const d = get('do');
  let from: Ymd = accepted(od) ? od : (defaults.from ?? addDays(today, -7));
  let to: Ymd = accepted(d) ? d : (defaults.to ?? today);
  if (to < from) [from, to] = [to, from];
  const page = parseInt(get('strana') ?? '', 10);
  return {
    from,
    to,
    listingId: get('byt') || undefined,
    actor: get('osoba') || undefined,
    event: get('udalost') || undefined,
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}
