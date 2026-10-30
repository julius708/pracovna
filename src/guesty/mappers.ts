import { listingDisplayName, listingScope, parseLaundry } from '@/core/packing';
import type { ListingRow, ReservationRow } from '@/db/types';
import type { ParsedListing, ParsedReservation } from './schemas';
import type { GuestyCustomFieldValue, GuestySpaces } from './types';

export interface ListingMapContext {
  laundryFieldId: string;
  cleanerFieldId?: string | null;
  /** fieldId -> normalised display name, from the account definitions. */
  fieldNames?: Record<string, string>;
  /** Beds/bathrooms from the Spaces API when the listing has no listingRooms. */
  spaces?: GuestySpaces | null;
  /** Values from GET /properties-api/custom-fields/{id} when the listing has no inline customFields. */
  customFieldValues?: GuestyCustomFieldValue[] | null;
  fetchedAt: string;
}

function norm(s: unknown): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/** Beds per type from listingRooms[].beds[] ({type, quantity}). */
export function bedsFromRooms(rooms: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!Array.isArray(rooms)) return out;
  for (const room of rooms) {
    const beds = (room as { beds?: unknown })?.beds;
    if (!Array.isArray(beds)) continue;
    for (const b of beds) {
      const type = String((b as { type?: unknown })?.type ?? 'UNKNOWN');
      const qty = Number((b as { quantity?: unknown })?.quantity ?? 0);
      if (Number.isFinite(qty) && qty > 0) out[type] = (out[type] ?? 0) + qty;
    }
  }
  return out;
}

/** Inline customFields may be an array of {fieldId, value} or an object keyed by fieldId. */
export function customFieldEntries(cf: unknown): { fieldId: string; value: unknown; fullText?: string | null }[] {
  if (Array.isArray(cf)) {
    return cf
      .map((x) => x as { fieldId?: unknown; value?: unknown; fullText?: unknown })
      .filter((x) => x && typeof x.fieldId === 'string')
      .map((x) => ({ fieldId: x.fieldId as string, value: x.value, fullText: typeof x.fullText === 'string' ? x.fullText : null }));
  }
  if (cf && typeof cf === 'object') {
    return Object.entries(cf as Record<string, unknown>).map(([fieldId, value]) => ({ fieldId, value }));
  }
  return [];
}

function fieldText(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return v.map(String).join(', ');
  const s = String(v).trim();
  return s ? s : null;
}

/** Guesty listing -> listings row, with scope and the parsed laundry field. */
export function mapListing(raw: ParsedListing, ctx: ListingMapContext): ListingRow {
  const entries = customFieldEntries(raw.customFields);
  const values = entries.length ? entries : (ctx.customFieldValues ?? []).map((v) => ({ fieldId: v.fieldId ?? '', value: v.value, fullText: v.fullText }));
  let laundryRaw: string | null = null;
  let cleaner: string | null = null;
  let cleaningInfo: string | null = null;
  for (const e of values) {
    const name = ctx.fieldNames?.[e.fieldId] ?? '';
    const isLaundry = e.fieldId === ctx.laundryFieldId || (!!name && norm(name).includes('pracovn'));
    // "INFO PRE UPRATOVAČOV" (key info_pre_upratovačov) is the standing note for the cleaners (Martina, 2026-10-30);
    // it also says "upratov", so the cleaning-company field ("Upratovacia služba") must not be an "info" one
    const isCleaningInfo = !!name && norm(name).includes('upratov') && norm(name).includes('info');
    const isCleaner = (ctx.cleanerFieldId && e.fieldId === ctx.cleanerFieldId) || (!!name && norm(name).includes('upratov') && !isCleaningInfo);
    if (isCleaningInfo) {
      const full = fieldText(e.fullText);
      const val = fieldText(e.value);
      cleaningInfo = full && val ? (full.length >= val.length ? full : val) : (full ?? val);
    } else if (isLaundry) {
      const full = fieldText(e.fullText);
      const val = fieldText(e.value);
      // prefer the longer of the two: one of them may be truncated (probe decides which)
      laundryRaw = full && val ? (full.length >= val.length ? full : val) : (full ?? val);
    } else if (isCleaner) cleaner = fieldText(e.value);
  }

  let beds = bedsFromRooms(raw.listingRooms);
  let bedsSource: ListingRow['beds_source'] = 'listingRooms';
  if (!Object.keys(beds).length && ctx.spaces && Object.keys(ctx.spaces.beds).length) {
    beds = { ...ctx.spaces.beds };
    bedsSource = 'spaces';
  } else if (!Object.keys(beds).length && raw.beds && raw.beds > 0) {
    beds = { UNKNOWN: Math.floor(raw.beds) };
    bedsSource = 'beds_count';
  } else if (!Object.keys(beds).length) {
    bedsSource = 'none';
  }

  const bathrooms = raw.bathrooms ?? ctx.spaces?.bathrooms ?? null;
  const laundry = laundryRaw ? parseLaundry(laundryRaw) : null;
  const scope = listingScope({
    guestyId: raw._id,
    nickname: raw.nickname,
    city: raw.address?.city,
    active: raw.active,
    tags: raw.tags ?? [],
    laundryRaw,
  });

  return {
    guesty_id: raw._id,
    name: listingDisplayName(raw.nickname, raw.title) || raw._id,
    title: raw.title ?? null,
    city: raw.address?.city ?? null,
    active: raw.active !== false,
    accommodates: raw.accommodates ?? null,
    bedrooms: raw.bedrooms ?? null,
    bathrooms,
    beds,
    beds_source: bedsSource,
    tags: raw.tags ?? [],
    laundry_raw: laundryRaw,
    laundry,
    cleaner,
    cleaning_info: cleaningInfo,
    owner_cleans: scope.reason === 'owner_id' || scope.reason === 'owner_tag' || scope.reason === 'owner_text',
    in_scope: scope.inScope,
    exclusion_reason: scope.reason,
    fetched_at: ctx.fetchedAt,
  };
}

/**
 * The planned arrival as "HH:MM" from what Guesty writes: the clock part of the
 * check-in timestamp (16:00 standard, 13:00 for an agreed early check-in; the
 * zone suffix is meaningless and ignored) or a bare "15:00" (eta). Null when absent.
 */
export function arrivalClock(value: string | null | undefined): string | null {
  const m = /(?:^|T)(\d{2}):(\d{2})/.exec(value ?? '');
  return m ? `${m[1]}:${m[2]}` : null;
}

/** Guesty reservation -> reservations row; null when it has no id, listing or dates. */
export function mapReservation(raw: ParsedReservation, fetchedAt: string): ReservationRow | null {
  const id = raw._id ?? raw.reservationId ?? null;
  // the listing of a segment: listingId (search shape), else unitTypeId (by-ids shape; the unit type IS the listing), else unitId (single-unit listings)
  const segListing = (s: { listingId?: string | null; unitTypeId?: string | null; unitId?: string | null }) => s.listingId ?? s.unitTypeId ?? s.unitId ?? null;
  const stay = (raw.stay ?? []).filter((s) => s && segListing(s));
  const first = stay[0];
  const last = stay[stay.length - 1];
  const listingId = (last && segListing(last)) ?? raw.lastStayListingId ?? raw.listingId ?? null;
  const arrivalListingId = (first && segListing(first)) ?? raw.listingId ?? listingId;
  const checkIn = first?.checkInDateLocalized ?? raw.checkInDateLocalized ?? null;
  const checkOut = last?.checkOutDateLocalized ?? raw.checkOutDateLocalized ?? null;
  const arrivalTime = arrivalClock(first?.checkIn ?? first?.eta ?? raw.checkIn);
  if (!id || !listingId || !arrivalListingId || !checkIn || !checkOut) return null;
  const ng = first?.numberOfGuests ?? raw.numberOfGuests ?? null;
  const adults = ng?.numberOfAdults ?? null;
  const children = ng?.numberOfChildren ?? null;
  const infants = ng?.numberOfInfants ?? null;
  const guestsRaw = first?.guestsCount ?? raw.guestsCount ?? null;
  const guests = guestsRaw && guestsRaw > 0 ? guestsRaw : adults !== null ? adults + (children ?? 0) : null;
  const listingIds = new Set(stay.map(segListing));
  return {
    guesty_id: id,
    listing_id: listingId,
    arrival_listing_id: arrivalListingId,
    status: raw.status,
    check_in_date: checkIn.slice(0, 10),
    check_out_date: checkOut.slice(0, 10),
    guests: guests && guests > 0 ? guests : null,
    adults,
    children,
    infants,
    confirmation_code: raw.confirmationCode ?? null,
    source: raw.source ?? null,
    multi_stay: listingIds.size > 1,
    not_found_runs: 0,
    fetched_at: fetchedAt,
    arrival_time: arrivalTime,
  };
}
