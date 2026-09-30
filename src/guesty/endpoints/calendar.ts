import { GuestyApiError, type GuestyHttp } from '../http';
import { calendarDaySchema, parseMany, type ParsedCalendarDay } from '../schemas';

/**
 * The calendar response shape is documented per day object only; the top level
 * may be a flat array, {data: {days}}, {days}, or one object per listing. This
 * collects every array of day-like objects found in the payload.
 */
export function extractCalendarDays(json: unknown, depth = 0): unknown[] {
  if (depth > 5 || !json) return [];
  if (Array.isArray(json)) {
    if (json.length && json.every((x) => x && typeof x === 'object' && typeof (x as Record<string, unknown>).date === 'string')) {
      return json;
    }
    return json.flatMap((x) => extractCalendarDays(x, depth + 1));
  }
  if (typeof json === 'object') {
    const o = json as Record<string, unknown>;
    if (typeof o.date === 'string' && ('minNights' in o || 'status' in o)) return [o];
    return Object.values(o).flatMap((v) => extractCalendarDays(v, depth + 1));
  }
  return [];
}

export interface CalendarOptions {
  chunkSize?: number;
  onParseError?: (issue: string, item: unknown) => void;
}

/**
 * Per-day minNights / status / cta for several listings. Uses the multi-listing
 * endpoint in chunks and falls back to the single-listing endpoint when Guesty
 * rejects the batch (undocumented limits).
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
        const json = await http.get(`/availability-pricing/api/calendar/listings/${encodeURIComponent(id)}`, { startDate, endDate });
        const days = parseMany(calendarDaySchema, extractCalendarDays(json), opts.onParseError);
        out.push(...days.map((d) => ({ ...d, listingId: d.listingId ?? id })));
      }
    }
  }
  return out;
}
