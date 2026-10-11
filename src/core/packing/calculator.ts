import { planBeds } from './beds';
import { capsuleRows } from './capsules';
import { hashOf } from './hash';
import { flatFacts } from './flats';
import { computeLinen } from './linen';
import { uniqueStrings } from './normalize';
import { computePeople } from './people';
import type { ListingInput, PackageInput, PackingResult, WarningCode } from './types';

/**
 * The packing calculation of spec §4. Pure and deterministic: the same input
 * always gives the same result (and therefore the same hash).
 */
export function computePackage(input: PackageInput): PackingResult {
  const { next, settings } = input;
  // what Angelika knows about the flat (beds, capacity, duvet set, sheet sizes); wins over the Guesty data it replaces
  const facts = input.facts === undefined ? flatFacts(input.listing.guestyId) : input.facts;
  const listing: ListingInput =
    facts?.beds || facts?.capacity ? { ...input.listing, beds: facts.beds ?? input.listing.beds, accommodates: facts.capacity ?? input.listing.accommodates } : input.listing;
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
    facts,
  });
  warnings.push(...linen.warnings);

  const capsules = capsuleRows(laundry, people.people);
  warnings.push(...capsules.warnings);

  if (next?.multiStay || input.outgoing.multiStay) warnings.push('multi_stay');
  if (input.doubleCheckout) warnings.push('double_checkout');

  // info for Angelika (owner, 2026-10-04): guests may want separate beds, so every one of them gets a bed;
  // when they share, fewer beds would do - the card says so
  const made = beds.plan.usedGroups.length;
  if (people.people >= 2 && made >= people.people && made > Math.ceil(people.people / 2)) warnings.push('separate_beds');

  // clearly more duvets in Guesty than the flat sleeps (Mestská: 4 large for 2 guests): the entry needs
  // clarifying. One spare duvet is normal (a fold-out bed, Tomášikova: 6 for 5), so only a surplus of two or
  // more is flagged (private linen too: its counts are shown like everyone else's)
  const inv = facts?.duvets ?? laundry?.duvetCounts;
  const capacity = listing.accommodates ?? 0;
  const duvetInventory =
    inv && capacity > 0 && inv.large + inv.small >= capacity + 2 ? { large: inv.large, small: inv.small, capacity } : undefined;
  if (duvetInventory) warnings.push('duvets_exceed_capacity');

  // questions Angelika has already answered for this flat stay off its card
  const settled = new Set<WarningCode>(facts?.settled ?? []);
  const shown = warnings.filter((w) => !settled.has(w));

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
    warnings: uniqueStrings(shown) as WarningCode[],
  };
}

/** Change-detection hash of a result (stable key order). */
export function packageHash(result: PackingResult): string {
  return hashOf(result);
}
