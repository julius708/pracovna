import { GuestyApiError, type GuestyHttp, type QueryValue } from '../http';
import {
  customFieldDefSchema,
  customFieldValueSchema,
  extractHasMore,
  extractResults,
  listingSchema,
  parseMany,
  type ParsedCustomFieldDef,
  type ParsedListing,
} from '../schemas';
import type { GuestyCustomFieldValue, GuestySpaces } from '../types';

/** Fields requested from GET /listings. listingRooms/customFields/bathrooms are confirmed by the day-1 probe. */
export const LISTING_FIELDS =
  '_id nickname title active isListed address.city accommodates bedrooms bathrooms beds tags customFields listingRooms';

export interface ListListingsOptions {
  pageSize?: number;
  maxPages?: number;
  /** Extra query parameters, e.g. { active: true } once the probe settles the default filter. */
  query?: Record<string, QueryValue>;
  onParseError?: (issue: string, item: unknown) => void;
}

/** Every listing of the account, paged by limit/skip until the envelope says there is no more. */
export async function listAllListings(http: GuestyHttp, opts: ListListingsOptions = {}): Promise<ParsedListing[]> {
  const limit = opts.pageSize ?? 100;
  const maxPages = opts.maxPages ?? 50;
  const out: ParsedListing[] = [];
  let skip = 0;
  for (let page = 0; page < maxPages; page++) {
    const json = await http.get('/listings', { fields: LISTING_FIELDS, limit, skip, sort: '_id', ...(opts.query ?? {}) });
    const items = extractResults(json);
    out.push(...parseMany(listingSchema, items, opts.onParseError));
    if (!items.length || !extractHasMore(json, items.length, limit)) break;
    skip += limit;
  }
  return out;
}

/** One listing, or null when Guesty answers 404. */
export async function getListing(http: GuestyHttp, id: string): Promise<ParsedListing | null> {
  try {
    const json = await http.get(`/listings/${encodeURIComponent(id)}`, { fields: LISTING_FIELDS });
    const r = listingSchema.safeParse(json);
    return r.success ? r.data : null;
  } catch (e) {
    if (e instanceof GuestyApiError && e.status === 404) return null;
    throw e;
  }
}

/** Beds and bathrooms from the Spaces API (fallback when the listing carries no listingRooms). */
export async function getUnitTypeSpaces(http: GuestyHttp, id: string): Promise<GuestySpaces | null> {
  let json: unknown;
  try {
    json = await http.get(`/properties/spaces/unit-type/${encodeURIComponent(id)}`);
  } catch (e) {
    if (e instanceof GuestyApiError && e.status === 404) return null;
    throw e;
  }
  const o = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>;
  const spaces = Array.isArray(o.spaces) ? (o.spaces as Record<string, unknown>[]) : [];
  const beds: Record<string, number> = {};
  for (const space of spaces) {
    for (const group of ['beds', 'other']) {
      const g = space[group];
      if (!g || typeof g !== 'object') continue;
      for (const [type, qty] of Object.entries(g as Record<string, unknown>)) {
        const n = Number(qty);
        if (Number.isFinite(n) && n > 0) beds[type] = (beds[type] ?? 0) + n;
      }
    }
  }
  const b = o.bathrooms as Record<string, unknown> | undefined;
  let bathrooms: number | null = null;
  if (b && typeof b === 'object') {
    const total = Number(b.PRIVATE ?? 0) + Number(b.SHARED ?? 0);
    bathrooms = Number.isFinite(total) ? total : null;
  } else if (typeof o.bathrooms === 'number') bathrooms = o.bathrooms;
  return { beds, bathrooms };
}

/** Custom field values of one property (documented endpoint; the listing's inline customFields is the fast path). */
export async function getListingCustomFields(http: GuestyHttp, id: string): Promise<GuestyCustomFieldValue[]> {
  try {
    const json = await http.get(`/properties-api/custom-fields/${encodeURIComponent(id)}`);
    const o = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>;
    const items = Array.isArray(o.customFields) ? o.customFields : extractResults(json);
    return parseMany(customFieldValueSchema, items) as GuestyCustomFieldValue[];
  } catch (e) {
    if (e instanceof GuestyApiError && e.status === 404) return [];
    throw e;
  }
}

/** Account-level custom field definitions (fieldId -> name), listing-scoped ones only. */
export async function getAccountCustomFieldDefs(http: GuestyHttp, accountId: string): Promise<ParsedCustomFieldDef[]> {
  const json = await http.get(`/accounts/${encodeURIComponent(accountId)}/custom-fields`);
  return parseMany(customFieldDefSchema, extractResults(json)).filter((d) => !d.object || d.object === 'listing');
}
