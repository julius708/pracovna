import type { GuestyClient } from './client';
import type { ListListingsOptions } from './endpoints/listings';
import type { ReservationSearch, ReservationSearchResult } from './endpoints/reservations';
import type { ParsedCalendarDay, ParsedCustomFieldDef, ParsedListing, ParsedReservation, ParsedWebhook } from './schemas';
import type { GuestyCustomFieldValue, GuestySpaces } from './types';

/** Data the fake client serves; seed mode generates it, tests build it by hand. */
export interface FakeGuestyData {
  listings: ParsedListing[];
  reservations: ParsedReservation[];
  /** Calendar days keyed by listing id. */
  calendar: Record<string, ParsedCalendarDay[]>;
  customFieldDefs?: ParsedCustomFieldDef[];
  customFieldValues?: Record<string, GuestyCustomFieldValue[]>;
  spaces?: Record<string, GuestySpaces>;
  webhooks?: ParsedWebhook[];
  webhookSecret?: string;
}

function rid(r: ParsedReservation): string {
  return r._id ?? r.reservationId ?? '';
}

function stayOf(r: ParsedReservation) {
  const s = r.stay?.[0];
  return {
    listingId: s?.listingId ?? r.listingId ?? null,
    checkIn: s?.checkInDateLocalized ?? r.checkInDateLocalized ?? '',
    checkOut: r.stay?.at(-1)?.checkOutDateLocalized ?? r.checkOutDateLocalized ?? '',
  };
}

/**
 * In-memory Guesty with the same paging, filters and envelopes as the real
 * API. Mutations (cancel, move) are done on `data` between calls.
 */
export function createFakeGuestyClient(data: FakeGuestyData): GuestyClient & { data: FakeGuestyData } {
  let calls = 0;
  const webhooks: ParsedWebhook[] = data.webhooks ?? [];
  return {
    kind: 'fake',
    data,
    calls: () => calls,
    async listListings(opts?: ListListingsOptions) {
      calls += Math.max(1, Math.ceil(data.listings.length / (opts?.pageSize ?? 100)));
      return data.listings.map((l) => ({ ...l }));
    },
    async getListing(id) {
      calls++;
      return data.listings.find((l) => l._id === id) ?? null;
    },
    async getSpaces(id) {
      calls++;
      return data.spaces?.[id] ?? null;
    },
    async getListingCustomFields(id) {
      calls++;
      return data.customFieldValues?.[id] ?? [];
    },
    async getCustomFieldDefs() {
      calls++;
      return data.customFieldDefs ?? [];
    },
    async searchReservations(p: ReservationSearch): Promise<ReservationSearchResult> {
      const statuses = p.status ? (Array.isArray(p.status) ? p.status : [p.status]) : null;
      const listingIds = p.listingIds?.length ? new Set(p.listingIds) : null;
      let rows = data.reservations.filter((r) => {
        const s = stayOf(r);
        if (statuses && !statuses.includes(r.status)) return false;
        if (p.checkOutGte && s.checkOut < p.checkOutGte) return false;
        if (p.checkOutLte && s.checkOut > p.checkOutLte) return false;
        if (p.checkInGte && s.checkIn < p.checkInGte) return false;
        if (p.checkInLt && s.checkIn >= p.checkInLt) return false;
        if (listingIds && !(r.stay ?? []).some((seg) => listingIds.has(seg.listingId ?? '')) && !listingIds.has(r.listingId ?? '')) return false;
        return true;
      });
      const sortKey = (p.sort ?? 'checkOut').replace('-', '');
      const desc = (p.sort ?? '').startsWith('-');
      rows = rows.sort((a, b) => {
        const ka = sortKey === 'checkIn' ? stayOf(a).checkIn : sortKey === 'checkOut' ? stayOf(a).checkOut : rid(a);
        const kb = sortKey === 'checkIn' ? stayOf(b).checkIn : sortKey === 'checkOut' ? stayOf(b).checkOut : rid(b);
        return (ka < kb ? -1 : ka > kb ? 1 : 0) * (desc ? -1 : 1);
      });
      const limit = p.pageSize ?? 100;
      const maxPages = p.maxPages ?? 30;
      const results: ParsedReservation[] = [];
      let pages = 0;
      for (let skip = 0; ; skip += limit) {
        const page = rows.slice(skip, skip + limit);
        calls++;
        pages++;
        results.push(...page.map((r) => ({ ...r })));
        const hasMore = skip + limit < rows.length;
        if (!hasMore) return { results, truncated: false, pages };
        if (p.stopWhen?.(results)) return { results, truncated: true, pages };
        if (pages >= maxPages) return { results, truncated: true, pages };
      }
    },
    async getReservationsByIds(ids) {
      calls += Math.max(1, Math.ceil(ids.length / 10));
      const set = new Set(ids);
      return data.reservations.filter((r) => set.has(rid(r))).map((r) => ({ ...r }));
    },
    async getCalendarDays(listingIds, startDate, endDate) {
      calls += Math.max(1, Math.ceil(listingIds.length / 20));
      const out: ParsedCalendarDay[] = [];
      for (const id of listingIds) {
        for (const d of data.calendar[id] ?? []) {
          if (d.date >= startDate && d.date <= endDate) out.push({ ...d, listingId: d.listingId ?? id });
        }
      }
      return out;
    },
    async listWebhooks() {
      calls++;
      return webhooks.map((w) => ({ ...w }));
    },
    async createWebhook(url, events) {
      calls++;
      const w: ParsedWebhook = { _id: `wh_${webhooks.length + 1}`, url, events: [...events] };
      webhooks.push(w);
      return w;
    },
    async deleteWebhook(id) {
      calls++;
      const i = webhooks.findIndex((w) => w._id === id);
      if (i >= 0) webhooks.splice(i, 1);
    },
    async getWebhookSecret() {
      calls++;
      return { secret: data.webhookSecret ?? 'whsec_c2VlZC1tb2RlLXNlY3JldC1zZWVkLW1vZGUtc2VjcmV0', responseKeys: ['secret'] };
    },
  };
}
