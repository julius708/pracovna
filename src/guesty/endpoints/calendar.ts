import { GuestyApiError, type GuestyHttp } from '../http';
import { calendarDaySchema, parseMany, type ParsedCalendarDay } from '../schemas';

const HEX_ID = /^[0-9a-f]{24}$/i;

function isDay(x: unknown): x is Record<string, unknown> {
  return !!x && typeof x === 'object' && typeof (x as Record<string, unknown>).date === 'string';
}

/**
 * The calendar response shape is documented per day object only; the top level
 * may be a flat array, {data: {days}}, {days}, one object per listing
 * ({listingId, days: [...]}) or a map keyed by listing id. This collects every
 * day-like object and attributes the listing id from the enclosing object or
 * key when the day itself does not carry one.
 */
export function extractCalendarDays(json: unknown, depth = 0, parentListingId: string | null = null): unknown[] {
  if (depth > 6 || !json) return [];
  if (Array.isArray(json)) {
    return json.flatMap((x) => (isDay(x) ? [withListing(x, parentListingId)] : extractCalendarDays(x, depth + 1, parentListingId)));
  }
  if (typeof json === 'object') {
    const o = json as Record<string, unknown>;
    if (isDay(o) && ('minNights' in o || 'status' in o)) return [withListing(o, parentListingId)];
    const own = typeof o.listingId === 'string' ? o.listingId : typeof o._id === 'string' && HEX_ID.test(o._id) ? o._id : parentListingId;
    return Object.entries(o).flatMap(([k, v]) => extractCalendarDays(v, depth + 1, HEX_ID.test(k) ? k : own));
  }
  return [];
}

function withListing(day: Record<string, unknown>, listingId: string | null): Record<string, unknown> {
  return typeof day.listingId === 'string' || !listingId ? day : { ...day, listingId };
}

export interface CalendarOptions {
  chunkSize?: number;
  onParseError?: (issue: string, item: unknown) => void;
}

/**
 * Per-day minNights / status / cta for several listings. Uses the multi-listing
 * endpoint in chunks and falls back to the single-listing endpoint when Guesty
 * rejects the batch (undocumented limits). A 404 for one listing skips it.
 */
export async function getCalendarDays(
  http: GuestyHttp,
  listingIds: string[],
  startDate: string,
  endDate: string,
  opts: CalendarOptions = {},
): Promise<ParsedCalendarDay[]> {
  const chunk = opts.chunkSize ?? 20;
  const ids = [...new Set(listingIds)];
  const out: ParsedCalendarDay[] = [];
  for (let i = 0; i < ids.length; i += chunk) {
    const part = ids.slice(i, i + chunk);
    try {
      const json = await http.get('/availability-pricing/api/calendar/listings', { listingIds: part, startDate, endDate });
      out.push(...parseMany(calendarDaySchema, extractCalendarDays(json), opts.onParseError));
    } catch (e) {
      if (!(e instanceof GuestyApiError) || e.status < 400 || e.status >= 500) throw e;
      for (const id of part) {
        try {
          const json = await http.get(`/availability-pricing/api/calendar/listings/${encodeURIComponent(id)}`, { startDate, endDate });
          const days = parseMany(calendarDaySchema, extractCalendarDays(json, 0, id), opts.onParseError);
          out.push(...days.map((d) => ({ ...d, listingId: d.listingId ?? id })));
        } catch (inner) {
          if (inner instanceof GuestyApiError && inner.status === 404) continue;
          throw inner;
        }
      }
    }
  }
  return out;
}
