import type { GuestyHttp, QueryValue } from '../http';
import { extractHasMore, extractResults, parseMany, reservationSchema, type ParsedReservation } from '../schemas';

export interface ReservationSearch {
  /** Localized YYYY-MM-DD bounds (the v3 search compares against the localized dates). */
  checkOutGte?: string;
  checkOutLte?: string;
  checkInGte?: string;
  checkInLt?: string;
  listingIds?: string[];
  status?: string | string[];
  sort?: '_id' | 'checkIn' | 'checkOut' | 'createdAt' | '-checkIn' | '-checkOut';
  pageSize?: number;
  maxPages?: number;
  /** Return true to stop paging early (e.g. every listing already has its first hit). */
  stopWhen?: (all: ParsedReservation[]) => boolean;
  onParseError?: (issue: string, item: unknown) => void;
}

export interface ReservationSearchResult {
  results: ParsedReservation[];
  /** True when paging stopped (maxPages or stopWhen) while Guesty still had more. */
  truncated: boolean;
  pages: number;
}

/** GET /reservations-v3/search with bracket filters, paged by pagination.hasMore. */
export async function searchReservations(http: GuestyHttp, p: ReservationSearch): Promise<ReservationSearchResult> {
  const limit = p.pageSize ?? 100;
  const maxPages = p.maxPages ?? 30;
  const query: Record<string, QueryValue> = {
    'filter[checkOut][gte]': p.checkOutGte,
    'filter[checkOut][lte]': p.checkOutLte,
    'filter[checkIn][gte]': p.checkInGte,
    'filter[checkIn][lt]': p.checkInLt,
    'filter[listingId]': p.listingIds?.length ? p.listingIds : undefined,
    'filter[status]': p.status ? (Array.isArray(p.status) ? p.status : [p.status]) : undefined,
    sort: p.sort ?? 'checkOut',
    limit,
  };
  const results: ParsedReservation[] = [];
  let skip = 0;
  let pages = 0;
  for (;;) {
    const json = await http.get('/reservations-v3/search', { ...query, skip });
    pages++;
    const items = extractResults(json);
    results.push(...parseMany(reservationSchema, items, p.onParseError));
    const hasMore = items.length > 0 && extractHasMore(json, items.length, limit);
    if (!hasMore) return { results, truncated: false, pages };
    if (p.stopWhen?.(results)) return { results, truncated: true, pages };
    if (pages >= maxPages) return { results, truncated: true, pages };
    skip += limit;
  }
}

/** GET /reservations-v3?reservationIds= in chunks of 10 (the documented maximum). */
export async function getReservationsByIds(http: GuestyHttp, ids: string[]): Promise<ParsedReservation[]> {
  const out: ParsedReservation[] = [];
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += 10) {
    const chunk = unique.slice(i, i + 10);
    const json = await http.get('/reservations-v3', { reservationIds: chunk });
    out.push(...parseMany(reservationSchema, extractResults(json)));
  }
  return out;
}

/** The Guesty id of a reservation in either response generation. */
export function reservationId(r: { _id?: string | null; reservationId?: string | null }): string | null {
  return r._id ?? r.reservationId ?? null;
}
