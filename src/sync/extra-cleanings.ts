import {
  computePackage,
  extraPackageKey,
  packageHash,
  type ExtraCleaning,
  type ExtraInfo,
  type ListingInput,
  type PackingResult,
  type PackingSettings,
  type ReservationInput,
} from '@/core/packing';
import type { ListingRow, PackageComputed, ReservationRow } from '@/db/types';

/**
 * Extra cleanings asked for in a board message (Martina, 2026-11-18): the package
 * of a cleaning that is not a check-out. People: the number written in the
 * message; otherwise the guests staying in the flat that day, or the next
 * arrival; with neither, the flat's capacity.
 */
export function extraComputed(e: ExtraCleaning, listing: ListingRow, listingInput: ListingInput, reservations: readonly ReservationRow[], settings: PackingSettings, duvetTypeSetting: 'male' | 'velke' | null): PackageComputed {
  const ofFlat = reservations.filter((r) => r.status === 'confirmed' && (r.listing_id === listing.guesty_id || r.arrival_listing_id === listing.guesty_id));
  const staying = ofFlat.find((r) => r.check_in_date < e.date && r.check_out_date > e.date) ?? null;
  const next = ofFlat.filter((r) => r.check_in_date >= e.date).sort((a, b) => a.check_in_date.localeCompare(b.check_in_date))[0] ?? null;
  const ref = staying ?? next;
  const guests = e.people ?? (ref?.guests && ref.guests > 0 ? ref.guests : null);
  const peopleFrom: ExtraInfo['peopleFrom'] = e.people !== null ? 'message' : guests === null ? 'capacity' : staying ? 'stay' : 'next';

  // the people to pack for reach the calculation as an arrival on the day of the cleaning
  const arrival: ReservationInput | null =
    guests === null
      ? null
      : {
          guestyId: ref?.guesty_id ?? `${extraPackageKey(listing.guesty_id, e.date)}:people`,
          listingId: listing.guesty_id,
          checkInDate: e.date,
          checkOutDate: ref?.check_out_date ?? e.date,
          guests,
          adults: e.people ?? ref?.adults ?? null,
          children: ref?.children ?? 0,
          infants: ref?.infants ?? 0,
        };
  const base = computePackage({
    date: e.date,
    listing: listingInput,
    outgoing: { guestyId: extraPackageKey(listing.guesty_id, e.date), listingId: listing.guesty_id, checkInDate: e.date, checkOutDate: e.date, guests: null },
    next: arrival,
    calendar: {},
    settings,
    duvetTypeSetting,
  });
  const result: PackingResult = {
    ...base,
    // not a quick turnover: nobody checks out, the card says "Extra upratovanie" instead
    sameDay: false,
    next: ref ? { reservationId: ref.guesty_id, date: ref.check_in_date, guests: ref.guests, children: ref.children ?? 0, infants: ref.infants ?? 0 } : null,
    extra: { peopleFrom, texts: e.sources.map((s) => s.text) },
  };
  return {
    outgoing_reservation_id: extraPackageKey(listing.guesty_id, e.date),
    listing_id: listing.guesty_id,
    listing_name: listing.name,
    date: e.date,
    incoming_reservation_id: ref?.guesty_id ?? null,
    same_day: false,
    gap_nights: null,
    gap_blocked: null,
    target_people: result.people,
    people_source: result.peopleSource,
    computed_items: result,
    computed_hash: packageHash(result),
    warnings: result.warnings,
  };
}
