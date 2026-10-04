import { CONSUMABLE_KEYS, toiletPaperCount } from './constants';
import { bedGroup, SLEEPS } from './beds';
import type { BedGroup, BedPlan, Counts, DuvetSource, LineItem, PackingSettings, ParsedLaundry, WarningCode } from './types';

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

const BED_ORDER: Record<BedGroup, number> = { dvoj: 0, gauc: 1, jedno: 2 };

/**
 * Duvets per made bed from the Guesty counts, which describe the flat's full
 * set. Beds are made complete even for one guest (owner's rules 2026-10-03/04):
 *  - double-type beds (regular doubles first, then sofas) each get the flat's
 *    large duvets per double bed: the set divided over all double-type beds,
 *    at least one while any are left (Gross. 23 keeps its 2 per bed);
 *  - a bed without a large duvet gets one small duvet per sleeper (2 for a
 *    double, 1 for a single), or a leftover large one when the flat has no
 *    small ones (Moyzesova's single bed);
 *  - a full flat (people >= accommodates) gets the whole set as written.
 */
export function duvetsForBeds(full: { large: number; small: number }, plan: BedPlan, people: number, accommodates: number | null | undefined): { large: number; small: number } {
  const L = Math.max(0, Math.floor(full.large) || 0);
  const S = Math.max(0, Math.floor(full.small) || 0);
  if (accommodates && accommodates > 0 && people >= accommodates) return { large: L, small: S };
  const beds = [...plan.usedGroups].sort((a, b) => BED_ORDER[a] - BED_ORDER[b]);
  const doublesTotal = plan.regular.reduce((n, b) => n + (bedGroup(b.type) === 'jedno' ? 0 : b.qty), 0) + plan.sofasTotal;
  const perDouble = Math.max(1, doublesTotal > 0 ? Math.floor(L / doublesTotal) : 1);
  let large = 0;
  let small = 0;
  let l = L;
  let s = S;
  const uncovered: BedGroup[] = [];
  for (const g of beds) {
    if (g !== 'jedno' && l > 0) {
      const take = Math.min(l, perDouble);
      large += take;
      l -= take;
    } else {
      uncovered.push(g);
    }
  }
  for (const g of uncovered) {
    if (s > 0) {
      const take = Math.min(s, SLEEPS[g]);
      small += take;
      s -= take;
    } else if (l > 0) {
      large += 1;
      l -= 1;
    }
  }
  return { large, small };
}

/**
 * Bed linen per duvet, read off the linen table: what a double bed gets per its
 * large duvet (2 pillows, 1 sheet) and what a single bed gets per its small
 * duvet (1 pillow, 1 small sheet). Duvet rows themselves are left out. Falls
 * back to those defaults when a table row has no duvet.
 */
export function linenPerDuvet(settings: PackingSettings): { large: Counts; small: Counts } {
  const scale = (row: Counts | undefined, duvetKey: string, fallback: Counts): Counts => {
    const n = row?.[duvetKey];
    if (!row || !n) return fallback;
    const out: Counts = {};
    for (const [k, v] of Object.entries(row)) if (k !== 'paplonV' && k !== 'paplonM') out[k] = (Number(v) || 0) / n;
    return out;
  };
  return {
    large: scale(settings.beds.dvoj, 'paplonV', { vankus: 2, plachta: 1 }),
    small: scale(settings.beds.jedno, 'paplonM', { vankus: 1, plachtaM: 1 }),
  };
}

/** Pillows per duvet (see linenPerDuvet). */
export function pillowsPerDuvet(settings: PackingSettings): { large: number; small: number } {
  const per = linenPerDuvet(settings);
  return { large: per.large.vankus ?? 0, small: per.small.vankus ?? 0 };
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
 * - Guesty duvet counts are the flat's full set, handed out per made bed (see
 *   duvetsForBeds): beds are made complete even for one guest;
 * - pillows and sheets always follow the duvets: 2 pillows + 1 sheet per large,
 *   1 pillow + 1 small sheet per small (so a small-duvet double bed gets 2 small sheets)
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
  /** Guesty accommodates; a full flat gets the whole Guesty duvet set. */
  accommodates?: number | null;
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
    const d = duvetsForBeds(laundry.duvetCounts, plan, people, args.accommodates);
    counts.paplonV = d.large;
    counts.paplonM = d.small;
    // the Guesty set is smaller than the beds that get linen: a bed would go without a duvet
    if (d.large + d.small < plan.usedGroups.length) warnings.push('duvets_short');
    overridden.add('paplonV');
    overridden.add('paplonM');
  }
  // bed linen ALWAYS goes with the duvets, whatever decided them (owner's rule 2026-10-04): per large duvet
  // 2 pillows and 1 sheet, per small duvet 1 pillow and 1 small sheet (the table's ratios). A small-duvet
  // double bed therefore gets 2 small sheets, not one large.
  const per = linenPerDuvet(settings);
  for (const key of new Set([...Object.keys(per.large), ...Object.keys(per.small)])) {
    counts[key] = Math.round((counts.paplonV ?? 0) * (per.large[key] ?? 0) + (counts.paplonM ?? 0) * (per.small[key] ?? 0));
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
