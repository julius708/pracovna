import { DEFAULT_SETTINGS, parseLaundry } from '@/core/packing';
import type { ListingInput, PackageInput, PackingResult, ReservationInput } from '@/core/packing';

export const D0 = '2026-10-05';

export function listing(over: Partial<ListingInput> = {}): ListingInput {
  return {
    guestyId: 'L1',
    name: 'Testovacia, Byt',
    beds: { KING_BED: 1, SOFA_BED: 1 },
    accommodates: 4,
    bathrooms: 1,
    laundry: null,
    ...over,
  };
}

export function reservation(over: Partial<ReservationInput> = {}): ReservationInput {
  return {
    guestyId: 'R1',
    listingId: 'L1',
    checkInDate: '2026-10-01',
    checkOutDate: D0,
    guests: 2,
    ...over,
  };
}

export function pkg(over: Partial<PackageInput> = {}): PackageInput {
  return {
    date: D0,
    listing: listing(),
    outgoing: reservation(),
    next: null,
    calendar: {},
    settings: DEFAULT_SETTINGS,
    ...over,
  };
}

/** Count of an item across linen and consumables (0 when the row is absent). */
export function count(r: PackingResult, key: string): number {
  return [...r.linen, ...r.consumables].find((l) => l.key === key)?.n ?? 0;
}

export function laundry(text: string) {
  return parseLaundry(text);
}
