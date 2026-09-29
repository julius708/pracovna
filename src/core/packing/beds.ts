import type { BedGroup, BedPlan, WarningCode } from './types';

/** Beds that sleep 2 and are used only when regular beds cannot cover the people. */
const SOFA_LIKE: ReadonlySet<string> = new Set(['SOFA_BED', 'FUTON', 'AIR_MATTRESS', 'FLOOR_MATTRESS', 'COUCH']);
/** Not beds for linen purposes. */
const IGNORED: ReadonlySet<string> = new Set(['CRIB', 'TODDLER_BED', 'HAMMOCK']);
const KNOWN_DOUBLE: ReadonlySet<string> = new Set(['KING_BED', 'QUEEN_BED', 'DOUBLE_BED']);
const SINGLE: ReadonlySet<string> = new Set(['SINGLE_BED', 'BUNK_BED']);

export const SLEEPS: Record<BedGroup, number> = { dvoj: 2, jedno: 1, gauc: 2 };

/** Placeholder type when a listing has no beds at all. */
export const UNKNOWN_BED = 'UNKNOWN';

/** Linen group of a bed type. Unknown types count as a double bed (spec). */
export function bedGroup(type: string): BedGroup {
  if (SINGLE.has(type)) return 'jedno';
  if (SOFA_LIKE.has(type)) return 'gauc';
  return 'dvoj';
}

export function isKnownBedType(type: string): boolean {
  return KNOWN_DOUBLE.has(type) || SINGLE.has(type) || SOFA_LIKE.has(type) || IGNORED.has(type);
}

export interface BedPlanResult {
  plan: BedPlan;
  warnings: WarningCode[];
}

/**
 * Expands the bed counts and decides which sofas to unfold.
 * Regular beds always get linen; sofas are added one by one only while the
 * regular capacity is below `people`. Bunk beds count as 2 single beds.
 */
export function planBeds(beds: Record<string, number>, people: number): BedPlanResult {
  const warnings: WarningCode[] = [];
  const regular: { type: string; qty: number }[] = [];
  let sofasTotal = 0;
  let bunk = false;
  let unknown = false;

  for (const [type, rawQty] of Object.entries(beds ?? {})) {
    const qty = Math.max(0, Math.floor(Number(rawQty) || 0));
    if (!qty || IGNORED.has(type)) continue;
    if (!isKnownBedType(type)) unknown = true;
    if (SOFA_LIKE.has(type)) {
      sofasTotal += qty;
      continue;
    }
    if (type === 'BUNK_BED') bunk = true;
    regular.push({ type, qty: type === 'BUNK_BED' ? qty * 2 : qty });
  }

  if (!regular.length && !sofasTotal) {
    regular.push({ type: UNKNOWN_BED, qty: 1 });
    warnings.push('no_beds');
  } else if (unknown) {
    warnings.push('unknown_bed_type');
  }
  if (bunk) warnings.push('bunk');

  const usedGroups: BedGroup[] = [];
  let capacityRegular = 0;
  for (const b of regular) {
    const g = bedGroup(b.type);
    for (let i = 0; i < b.qty; i++) {
      usedGroups.push(g);
      capacityRegular += SLEEPS[g];
    }
  }

  let sofasUsed = 0;
  let capacity = capacityRegular;
  while (sofasUsed < sofasTotal && capacity < people) {
    usedGroups.push('gauc');
    capacity += SLEEPS.gauc;
    sofasUsed++;
  }
  const capacityAll = capacityRegular + sofasTotal * SLEEPS.gauc;
  if (capacityAll < people) warnings.push('beds_insufficient');

  return {
    plan: { regular, sofasTotal, sofasUsed, usedGroups, capacityRegular, capacityAll, bunk },
    warnings,
  };
}

/** Sleeping capacity of all beds including every sofa (fallback for missing accommodates). */
export function bedCapacity(beds: Record<string, number>): number {
  return planBeds(beds, Number.MAX_SAFE_INTEGER).plan.capacityAll;
}
