import { planBeds } from './beds';
import { capsuleRows } from './capsules';
import { hashOf } from './hash';
import { computeLinen } from './linen';
import { uniqueStrings } from './normalize';
import { computePeople } from './people';
import type { PackageInput, PackingResult, WarningCode } from './types';

/**
 * The packing calculation of spec §4. Pure and deterministic: the same input
 * always gives the same result (and therefore the same hash).
 */
export function computePackage(input: PackageInput): PackingResult {
  const { listing, next, settings } = input;
  const laundry = listing.laundry ?? null;
  const warnings: WarningCode[] = [];

  const people = computePeople({ date: input.date, listing, next, calendar: input.calendar ?? {} });
  warnings.push(...people.warnings);

  const beds = planBeds(listing.beds ?? {}, people.people);
  warnings.push(...beds.warnings);

  const linen = computeLinen({
    settings,
    plan: beds.plan,
    people: people.people,
    bathrooms: listing.bathrooms,
    laundry,
    duvetTypeSetting: input.duvetTypeSetting ?? null,
    accommodates: listing.accommodates,
  });
  warnings.push(...linen.warnings);

  const capsules = capsuleRows(laundry, people.people);
  warnings.push(...capsules.warnings);

  if (next?.multiStay || input.outgoing.multiStay) warnings.push('multi_stay');
  if (input.doubleCheckout) warnings.push('double_checkout');

  // clearly more duvets in Guesty than the flat sleeps (Mestská: 4 large for 2 guests): the entry needs
  // clarifying. One spare duvet is normal (a fold-out bed, Tomášikova: 6 for 5), so only a surplus of two or
  // more is flagged; not for private linen, where the duvets are not packed at all
  const inv = laundry?.duvetCounts;
  const capacity = listing.accommodates ?? 0;
  const duvetInventory =
    inv && !laundry?.private && capacity > 0 && inv.large + inv.small >= capacity + 2 ? { large: inv.large, small: inv.small, capacity } : undefined;
  if (duvetInventory) warnings.push('duvets_exceed_capacity');

  const checklist = uniqueStrings([...(settings.checklist ?? []), ...(laundry?.extras ?? [])]);
  const guestyNote = laundry?.notes.length ? laundry.notes.join(' · ') : null;

  return {
    v: 1,
    people: people.people,
    peopleSource: people.source,
    sameDay: people.sameDay,
    next: next
      ? {
          reservationId: next.guestyId,
          date: next.checkInDate,
          guests: next.guests ?? null,
          children: next.children ?? 0,
          infants: next.infants ?? 0,
        }
      : null,
    gap: people.gap,
    beds: beds.plan,
    bathrooms: linen.bathrooms,
    linen: linen.linen,
    consumables: linen.consumables,
    capsules: capsules.rows,
    duvetSource: linen.duvets.source,
    duvetType: linen.duvets.type,
    ...(duvetInventory ? { duvetInventory } : {}),
    private: !!laundry?.private,
    coffee: laundry?.coffee ?? null,
    guestyNote,
    checklist,
    cleaner: listing.cleaner ?? null,
    warnings: uniqueStrings(warnings) as WarningCode[],
  };
}

/** Change-detection hash of a result (stable key order). */
export function packageHash(result: PackingResult): string {
  return hashOf(result);
}
