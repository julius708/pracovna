import { bagCount, CONSUMABLE_KEYS, toiletPaperCount } from './constants';
import { bedGroup, madeBeds, SLEEPS } from './beds';
import { sheetKeyFor, type FlatFacts } from './flats';
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
export function decideDuvets(laundry: ParsedLaundry | null, setting: 'male' | 'velke' | null | undefined, facts: FlatFacts | null = null): DuvetDecision {
  if (facts?.duvets) return { source: 'facts', type: 'exact', warnings: [] };
  if (laundry?.duvetCounts) return { source: 'guesty_exact', type: 'exact', warnings: [] };
  if (laundry?.duvetType) return { source: 'guesty_type', type: laundry.duvetType, warnings: [] };
  if (setting) return { source: 'setting', type: setting, warnings: [] };
  return { source: 'default', type: 'velke', warnings: ['no_duvet_info'] };
}

const BED_ORDER: Record<BedGroup, number> = { dvoj: 0, gauc: 1, jedno: 2 };

/** Table keys that stay per made bed (the duvets decide the rest): the duvets themselves and the sheets. */
const PER_BED_KEYS: ReadonlySet<string> = new Set(['paplonV', 'paplonM', 'plachta', 'plachtaM', 'plachta140']);

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
 * `bare` counts the made beds the set leaves without any duvet (the card's
 * "duvets short" question), for the full flat too.
 */
export function duvetsForBeds(full: { large: number; small: number }, plan: BedPlan, people: number, accommodates: number | null | undefined): { large: number; small: number; bare: number } {
  const L = Math.max(0, Math.floor(full.large) || 0);
  const S = Math.max(0, Math.floor(full.small) || 0);
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
  let bare = 0;
  for (const g of uncovered) {
    if (s > 0) {
      const take = Math.min(s, SLEEPS[g]);
      small += take;
      s -= take;
    } else if (l > 0) {
      large += 1;
      l -= 1;
    } else {
      bare++;
    }
  }
  if (accommodates && accommodates > 0 && people >= accommodates) return { large: L, small: S, bare };
  return { large, small, bare };
}

/**
 * Linen that goes with the duvets, read off the linen table: what a double bed
 * gets per its large duvet (2 pillows) and what a single bed gets per its small
 * duvet (1 pillow). Duvets and sheets are left out: sheets go by the beds
 * (owner, 2026-10-04). Falls back to the defaults when a table row has no duvet.
 */
export function linenPerDuvet(settings: PackingSettings): { large: Counts; small: Counts } {
  const scale = (row: Counts | undefined, duvetKey: string, fallback: Counts): Counts => {
    const n = row?.[duvetKey];
    if (!row || !n) return fallback;
    const out: Counts = {};
    for (const [k, v] of Object.entries(row)) if (!PER_BED_KEYS.has(k)) out[k] = (Number(v) || 0) / n;
    return out;
  };
  return {
    large: scale(settings.beds.dvoj, 'paplonV', { vankus: 2 }),
    small: scale(settings.beds.jedno, 'paplonM', { vankus: 1 }),
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
 * - toilet paper people + 1; bin bags 2 + 2 for a small flat, 3 + 3 from capacity 4
 * - Guesty duvet counts (or Angelika's, flats.ts) are the flat's full set, handed
 *   out per made bed (see duvetsForBeds): beds are made complete even for one guest;
 * - pillows always follow the duvets: 2 per large, 1 per small; sheets follow the
 *   made beds, one large sheet each; small sheets are packed only where Angelika
 *   confirmed the size (flats.ts), otherwise a made single bed gets a large sheet
 *   and the card question "veľkosť plachty preveriť s Angelikou"; a 140 cm bed
 *   takes its 140 cm sheet
 * - per-item overrides from Guesty replace the calculated numbers
 * - private linen ("Prádlo: súkromné") changes nothing in the counts: it is a note
 *   for the packer (take the flat's own set), shown as a banner (owner, 2026-10-05)
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
  /** Angelika's facts about the flat (flats.ts), null when there are none. */
  facts?: FlatFacts | null;
}): LinenResult {
  const { settings, plan, people, laundry } = args;
  const facts = args.facts ?? null;
  const warnings: WarningCode[] = [];
  const duvets = decideDuvets(laundry, args.duvetTypeSetting, facts);
  warnings.push(...duvets.warnings);
  const bath = bathroomCount(args.bathrooms);
  warnings.push(...bath.warnings);

  // the made beds with their types (regular beds in the flat's order, then the unfolded sofas)
  const made: { type: string; group: BedGroup }[] = [];
  for (const b of madeBeds(plan)) for (let i = 0; i < b.qty; i++) made.push({ type: b.type, group: bedGroup(b.type) });
  for (let i = 0; i < plan.sofasUsed; i++) made.push({ type: 'SOFA_BED', group: 'gauc' });

  const counts: Counts = {};
  for (const bed of made) {
    const table: Counts = { ...(settings.beds[bed.group] ?? {}) };
    if (duvets.type === 'male' && table.paplonV) {
      table.paplonM = (table.paplonM ?? 0) + 2 * table.paplonV;
      delete table.paplonV;
    }
    // the bed's sheets go to one size: large unless Angelika confirmed a small one for the flat's single beds
    // (owner, 2026-10-04: small sheets are never packed on a guess; the card asks her instead) or the bed is a 140 cm one
    const sheets = (table.plachta ?? 0) + (table.plachtaM ?? 0) + (table.plachta140 ?? 0);
    delete table.plachta;
    delete table.plachtaM;
    delete table.plachta140;
    const sheetKey = sheetKeyFor(bed.type, bed.group, facts);
    if (sheets) table[sheetKey] = sheets;
    if (bed.group === 'jedno' && sheetKey === 'plachta') warnings.push('sheet_size_check');
    add(counts, table);
  }
  add(counts, settings.perGuest, people);
  add(counts, settings.perBathroom, bath.n);
  add(counts, settings.perApartment);
  counts.toaletak = toiletPaperCount(people);
  // bin bags by the flat's size, not the guests (owner, 2026-10-10)
  const capacity = args.accommodates && args.accommodates > 0 ? args.accommodates : plan.capacityAll;
  counts.vreckoV = bagCount(capacity);
  counts.vreckoM = bagCount(capacity);

  const overridden = new Set<string>();
  const fullSet = facts?.duvets ?? laundry?.duvetCounts ?? null;
  if (fullSet) {
    const d = duvetsForBeds(fullSet, plan, people, args.accommodates);
    counts.paplonV = d.large;
    counts.paplonM = d.small;
    // the set leaves a made bed without any duvet (Guesty's duvets vs. the beds as counted): a question for Angelika
    if (d.bare > 0 || d.large + d.small < plan.usedGroups.length) warnings.push('duvets_short');
    overridden.add('paplonV');
    overridden.add('paplonM');
  }
  // pillows ALWAYS go with the duvets, whatever decided them (owner's rule 2026-10-04): 2 per large duvet,
  // 1 per small (the table's ratios). Sheets stay per made bed (see above).
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
    else linen.push(line);
  }

  return { counts, linen, consumables, bathrooms: bath.n, duvets, warnings };
}
