import { CONSUMABLE_KEYS, toiletPaperCount } from './constants';
import type { BedPlan, Counts, DuvetSource, LineItem, PackingSettings, ParsedLaundry, WarningCode } from './types';

/** Adds `obj` counts times `k` into `acc`. */
function add(acc: Counts, obj: Counts | undefined, k = 1): void {
  for (const [key, n] of Object.entries(obj ?? {})) acc[key] = (acc[key] ?? 0) + (Number(n) || 0) * k;
}

export interface DuvetDecision {
  source: DuvetSource;
  type: 'male' | 'velke' | 'exact';
  warnings: WarningCode[];
}

/**
 * Duvet precedence: Guesty exact counts > Guesty "Paplóny:" line > Settings
 * per apartment > large duvets + warning.
 */
export function decideDuvets(laundry: ParsedLaundry | null, setting: 'male' | 'velke' | null | undefined): DuvetDecision {
  if (laundry?.duvetCounts) return { source: 'guesty_exact', type: 'exact', warnings: [] };
  if (laundry?.duvetType) return { source: 'guesty_type', type: laundry.duvetType, warnings: [] };
  if (setting) return { source: 'setting', type: setting, warnings: [] };
  return { source: 'default', type: 'velke', warnings: ['no_duvet_info'] };
}

/**
 * Duvets to pack from the Guesty counts, which describe the flat's full set
 * (what a full flat gets). Fewer guests get one duvet each: large duvets
 * first, small ones for the rest, never more than the flat has. With people
 * >= large + small the full set is packed, as before (owner's rule 2026-10-03).
 */
export function duvetsFor(full: { large: number; small: number }, people: number): { large: number; small: number } {
  const n = Math.max(0, Math.floor(people) || 0);
  const large = Math.min(Math.max(0, full.large), n);
  const small = Math.min(Math.max(0, full.small), Math.max(0, n - large));
  return { large, small };
}

/** Whole bathrooms only: 1.5 means bathroom + separate WC = 1. Unknown = 1 + warning. */
export function bathroomCount(bathrooms: number | null | undefined): { n: number; warnings: WarningCode[] } {
  if (bathrooms === null || bathrooms === undefined || Number.isNaN(Number(bathrooms))) {
    return { n: 1, warnings: ['bathrooms_missing'] };
  }
  return { n: Math.max(1, Math.floor(Number(bathrooms))), warnings: [] };
}

export interface LinenResult {
  counts: Counts;
  linen: LineItem[];
  consumables: LineItem[];
  bathrooms: number;
  duvets: DuvetDecision;
  warnings: WarningCode[];
}

/**
 * Linen and consumable counts for one package.
 * - per made bed from the table (small-duvet flats get 2 small instead of 1 large per double/sofa)
 * - per person: towels; per bathroom: foot towel; per apartment: consumables
 * - toilet paper max(2, people)
 * - Guesty duvet counts are the flat's full set: one duvet per person is taken
 *   from it, large ones first, never more than the flat has (see duvetsFor)
 * - per-item overrides from Guesty replace the calculated numbers
 * - private linen: no linen rows at all, consumables are still packed
 */
export function computeLinen(args: {
  settings: PackingSettings;
  plan: BedPlan;
  people: number;
  bathrooms: number | null | undefined;
  laundry: ParsedLaundry | null;
  duvetTypeSetting?: 'male' | 'velke' | null;
}): LinenResult {
  const { settings, plan, people, laundry } = args;
  const warnings: WarningCode[] = [];
  const duvets = decideDuvets(laundry, args.duvetTypeSetting);
  warnings.push(...duvets.warnings);
  const bath = bathroomCount(args.bathrooms);
  warnings.push(...bath.warnings);

  const counts: Counts = {};
  for (const group of plan.usedGroups) {
    const table: Counts = { ...(settings.beds[group] ?? {}) };
    if (duvets.type === 'male' && table.paplonV) {
      table.paplonM = (table.paplonM ?? 0) + 2 * table.paplonV;
      delete table.paplonV;
    }
    add(counts, table);
  }
  add(counts, settings.perGuest, people);
  add(counts, settings.perBathroom, bath.n);
  add(counts, settings.perApartment);
  counts.toaletak = toiletPaperCount(people);

  const overridden = new Set<string>();
  if (laundry?.duvetCounts) {
    const d = duvetsFor(laundry.duvetCounts, people);
    counts.paplonV = d.large;
    counts.paplonM = d.small;
    // the Guesty set is smaller than the beds that get linen: a bed would go without a duvet
    if (d.large + d.small < plan.usedGroups.length) warnings.push('duvets_short');
    // the large duvet(s) alone would cover everyone (a couple on the king), yet the one-per-guest rule adds a
    // small one from the flat's mixed set: the owner cannot say which is right, so the card asks Angelika
    if (!laundry.private && d.small > 0 && people <= 2 * d.large) warnings.push('duvets_mixed_couple');
    overridden.add('paplonV');
    overridden.add('paplonM');
  }
  for (const [key, n] of Object.entries(laundry?.overrides ?? {})) {
    if (typeof n === 'number') {
      counts[key] = n;
      overridden.add(key);
    }
  }

  const linen: LineItem[] = [];
  const consumables: LineItem[] = [];
  for (const item of settings.items) {
    const n = counts[item.key] ?? 0;
    if (n <= 0) continue;
    const line: LineItem = {
      key: item.key,
      label: item.label,
      size: item.size ?? '',
      n,
      source: overridden.has(item.key) ? 'guesty' : 'calc',
    };
    if (CONSUMABLE_KEYS.has(item.key)) consumables.push(line);
    else if (!laundry?.private) linen.push(line);
  }

  return { counts, linen, consumables, bathrooms: bath.n, duvets, warnings };
}
