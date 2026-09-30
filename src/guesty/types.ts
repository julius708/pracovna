/**
 * Shapes of the Guesty Open API objects the app consumes. Only the fields we
 * read are typed; everything else is kept as unknown so the mappers stay
 * tolerant to fields Guesty adds or renames.
 */

export interface GuestyBedSlot {
  type?: string | null;
  quantity?: number | null;
}

export interface GuestyListingRoom {
  beds?: GuestyBedSlot[] | null;
  [k: string]: unknown;
}

export interface GuestyCustomFieldValue {
  fieldId?: string | null;
  value?: unknown;
  fullText?: string | null;
  displayName?: string | null;
  key?: string | null;
}

export interface GuestyListing {
  _id: string;
  nickname?: string | null;
  title?: string | null;
  active?: boolean | null;
  isListed?: boolean | null;
  address?: { city?: string | null; [k: string]: unknown } | null;
  accommodates?: number | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  beds?: number | null;
  tags?: string[] | null;
  customFields?: GuestyCustomFieldValue[] | Record<string, unknown> | null;
  listingRooms?: GuestyListingRoom[] | null;
  [k: string]: unknown;
}

export interface GuestyNumberOfGuests {
  numberOfAdults?: number | null;
  numberOfChildren?: number | null;
  numberOfInfants?: number | null;
  numberOfPets?: number | null;
}

export interface GuestyStaySegment {
  listingId?: string | null;
  unitId?: string | null;
  checkInDateLocalized?: string | null;
  checkOutDateLocalized?: string | null;
  guestsCount?: number | null;
  numberOfGuests?: GuestyNumberOfGuests | null;
  [k: string]: unknown;
}

export type GuestyReservationStatus =
  | 'confirmed'
  | 'reserved'
  | 'awaiting_payment'
  | 'inquiry'
  | 'canceled'
  | 'closed'
  | 'declined'
  | 'expired'
  | string;

export interface GuestyReservation {
  _id?: string | null;
  reservationId?: string | null;
  status: GuestyReservationStatus;
  listingId?: string | null;
  lastStayListingId?: string | null;
  checkInDateLocalized?: string | null;
  checkOutDateLocalized?: string | null;
  guestsCount?: number | null;
  numberOfGuests?: GuestyNumberOfGuests | null;
  confirmationCode?: string | null;
  source?: string | null;
  stay?: GuestyStaySegment[] | null;
  [k: string]: unknown;
}

export interface GuestyCalendarDay {
  date: string;
  listingId?: string | null;
  minNights?: number | null;
  status?: 'available' | 'unavailable' | 'booked' | 'reserved' | string | null;
  cta?: boolean | null;
  ctd?: boolean | null;
  allotment?: number | null;
  [k: string]: unknown;
}

export interface GuestyWebhook {
  _id: string;
  url: string;
  events: string[];
  [k: string]: unknown;
}

export interface GuestyCustomFieldDef {
  fieldId: string;
  displayName?: string | null;
  key?: string | null;
  object?: 'listing' | 'reservation' | string | null;
  type?: string | null;
}

export interface GuestySpaces {
  beds: Record<string, number>;
  bathrooms: number | null;
}

/** Webhook events the app subscribes to (v2 reservation events, listing events). */
export const WEBHOOK_EVENTS = [
  'reservation.created.v2',
  'reservation.updated.v2',
  'listing.new',
  'listing.updated',
  'listing.removed',
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];
