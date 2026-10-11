import { z } from 'zod';


/** Numbers may arrive as strings from some Guesty fields; null/undefined stay unknown. */
const num = z.preprocess((v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}, z.number().nullable());

const str = z.string().nullable().optional();

export const listingSchema = z.looseObject({
  _id: z.string(),
  nickname: str,
  title: str,
  active: z.boolean().nullable().optional(),
  isListed: z.boolean().nullable().optional(),
  address: z.looseObject({ city: str }).nullable().optional(),
  accommodates: num.optional(),
  bedrooms: num.optional(),
  bathrooms: num.optional(),
  beds: num.optional(),
  tags: z.array(z.string()).nullable().optional(),
  customFields: z.unknown().optional(),
  listingRooms: z.unknown().optional(),
});

export const numberOfGuestsSchema = z.looseObject({
  numberOfAdults: num.optional(),
  numberOfChildren: num.optional(),
  numberOfInfants: num.optional(),
  numberOfPets: num.optional(),
});

export const staySegmentSchema = z.looseObject({
  /** v3 search gives listingId; GET /reservations-v3?reservationIds[] gives unitTypeId (= the listing) and unitId (the unit). */
  listingId: str,
  unitTypeId: str,
  unitId: str,
  checkInDateLocalized: str,
  checkOutDateLocalized: str,
  /** Planned arrival: the search shape writes it as the clock part of checkIn, the by-ids shape as eta ("15:00" or a timestamp). */
  checkIn: str,
  eta: str,
  guestsCount: num.optional(),
  numberOfGuests: numberOfGuestsSchema.nullable().optional(),
});

export const reservationSchema = z.looseObject({
  _id: str,
  reservationId: str,
  status: z.string(),
  listingId: str,
  lastStayListingId: str,
  checkInDateLocalized: str,
  checkOutDateLocalized: str,
  checkIn: str,
  guestsCount: num.optional(),
  numberOfGuests: numberOfGuestsSchema.nullable().optional(),
  confirmationCode: str,
  source: str,
  stay: z.array(staySegmentSchema).nullable().optional(),
});

export const calendarDaySchema = z.looseObject({
  date: z.string(),
  listingId: str,
  minNights: num.optional(),
  status: str,
  cta: z.boolean().nullable().optional(),
  ctd: z.boolean().nullable().optional(),
  allotment: num.optional(),
});

export const webhookSchema = z.looseObject({
  _id: z.string(),
  url: z.string(),
  events: z.array(z.string()).default([]),
});

export const customFieldDefSchema = z.looseObject({
  fieldId: z.string(),
  displayName: str,
  key: str,
  object: str,
  type: str,
});

export const customFieldValueSchema = z.looseObject({
  fieldId: str,
  value: z.unknown().optional(),
  fullText: str,
  displayName: str,
  key: str,
});

export const tokenResponseSchema = z.looseObject({
  access_token: z.string().min(1),
  expires_in: num,
  token_type: str,
});

/**
 * Guesty list responses come either as `{results, count, limit, skip}`, as
 * `{data: {...}}` wrappers, or as a bare array. This finds the item array.
 */
export function extractResults(json: unknown): unknown[] {
  if (Array.isArray(json)) return json;
  if (json && typeof json === 'object') {
    const o = json as Record<string, unknown>;
    if (Array.isArray(o.results)) return o.results;
    if (Array.isArray(o.days)) return o.days;
    if (o.data !== undefined) return extractResults(o.data);
  }
  return [];
}

/** Pagination info of the v3 search envelope; falls back to counting. */
export function extractHasMore(json: unknown, received: number, limit: number): boolean {
  if (json && typeof json === 'object') {
    const o = json as Record<string, unknown>;
    const p = o.pagination as Record<string, unknown> | undefined;
    if (p && typeof p.hasMore === 'boolean') return p.hasMore;
    if (typeof o.count === 'number' && typeof o.skip === 'number') return o.skip + received < o.count;
  }
  return received >= limit;
}

/** Parses an array of items, skipping (and reporting) the ones that do not fit. */
export function parseMany<T>(schema: z.ZodType<T>, items: unknown[], onError?: (issue: string, item: unknown) => void): T[] {
  const out: T[] = [];
  for (const item of items) {
    const r = schema.safeParse(item);
    if (r.success) out.push(r.data);
    else onError?.(r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '), item);
  }
  return out;
}

export type ParsedListing = z.infer<typeof listingSchema>;
export type ParsedReservation = z.infer<typeof reservationSchema>;
export type ParsedCalendarDay = z.infer<typeof calendarDaySchema>;
export type ParsedWebhook = z.infer<typeof webhookSchema>;
export type ParsedCustomFieldDef = z.infer<typeof customFieldDefSchema>;
