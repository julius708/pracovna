import type { Counts, WarningCode } from './types';

/**
 * What Angelika knows about particular flats and Guesty does not say (or says
 * differently). Keyed by the Guesty listing id, so a renamed listing keeps
 * its facts. Entries come from the owner (relayed from Angelika) and win over
 * the Guesty data they replace; the card shows "podľa Angeliky" where that
 * happens. Code constants on purpose, like the other packing rules.
 */
export interface FlatFacts {
  /** The name Angelika knows the flat by ("č. bytu 606", "Eurovea"); shown under the Guesty name. */
  alias?: string;
  /** The flat's beds as Angelika counts them; replaces the Guesty bed list (same type keys). */
  beds?: Record<string, number>;
  /** How many guests the flat really takes when full; replaces the Guesty accommodates (Mestská: 4, Guesty says 2). */
  capacity?: number;
  /** The flat's full duvet set; replaces "Paplón veľký/malý" from Guesty. */
  duvets?: { large: number; small: number };
  /**
   * Sheet of a made single bed when Angelika confirmed the size: 'small' packs a
   * small sheet. Without it a single bed gets a large sheet and the card asks
   * her (owner, 2026-10-04).
   */
  singleSheet?: 'small';
  /** Shown on the card ("Info o byte: …"). */
  note?: string;
  /** A must-not-miss instruction, shown in red on every card of the flat (Martina, 2026-10-21). */
  alert?: string;
  /** Items never packed for this flat (the flat has its own stock); their rows leave the card and the day totals. */
  skipItems?: string[];
  /** Questions Angelika has already settled for this flat; never shown on its card. */
  settled?: WarningCode[];
}

/** A 140 cm bed (Vajnorská): sleeps one, takes its own 140 cm sheet. */
export const BED_140 = 'BED_140';

export const FLAT_FACTS: Record<string, FlatFacts> = {
  // Poštová, Heart
  '69e7584bd6397b001423638a': { alias: 'č. bytu 606' },
  // Poštová, Shopping
  '69a7f976a4c8180015e47e98': { alias: 'č. bytu 310' },
  // Pribinová, Luxury
  '68592546458130001380dfc6': { alias: 'Eurovea' },
  // Skypark, Luxury I
  '68d3da344f45f70012accb1a': { alias: 'byt 190' },
  // Skypark, Modern
  '68ecfcd30c0b51002237bdda': { alias: 'byt 187' },
  // Moyzesova, Spacious (owner, 2026-10-10): 1 small bed, 3 large double beds, a sofa that does not unfold;
  // the full flat gets 3 large + 2 small duvets (Guesty says 4 large). 8 guests happen (the 8th sleeps on the
  // sofa), so the bed-capacity question is settled
  '694aa0c5b0f9ec001691d05d': {
    duvets: { large: 3, small: 2 },
    note: '1 malá posteľ, 3 veľké manželské, gauč sa nedá rozložiť · plný byt: 3× veľký + 2× malý paplón',
    settled: ['beds_insufficient'],
  },
  // Skalická 3A, Bright (owner, 2026-10-10): 2 small beds + 3 large; full flat = 2 small + 3 large sheets
  '688b6dfc3abd4d0010ae4542': {
    beds: { DOUBLE_BED: 3, SINGLE_BED: 2 },
    singleSheet: 'small',
    note: '2 malé postele + 3 veľké · plný byt: 2 malé + 3 veľké plachty',
  },
  // Tomášikova, Family (owner, 2026-10-10): the same as Skalická
  '68b84c169c4f710012f3984f': {
    beds: { DOUBLE_BED: 3, SINGLE_BED: 2 },
    singleSheet: 'small',
    note: '2 malé postele + 3 veľké · plný byt: 2 malé + 3 veľké plachty',
  },
  // Mestská, Modern (owner, 2026-10-11): Guesty says 2 guests, but the flat is full at 4 (king + sofa, 4 small
  // duvets in Guesty) and that is what is packed - the "more duvets than capacity" question is answered
  '689c97f1ebf8060016d60895': {
    capacity: 4,
    note: 'Hoci je v Guesty kapacita 2 osoby, plný počet sú 4 a na to balíme (king + gauč, 4 malé paplóny).',
  },
  // Vajnorská, Terrazzo (owner, 2026-10-10): packed as it is - king bed + a 140 cm bed for the third guest,
  // 1 large sheet + 1 sheet 140 cm; the one large duvet from Guesty covers both beds, so no duvet question on
  // the card (the bed warning stays for a reservation with more than 3 guests)
  // Owner, 2026-10-16: the flat (the office calls it Vajnorská 32A; the card keeps the Guesty name) has a large stock of toilet paper and dishwasher tablets in the
  // wardrobe drawer, so neither is packed for now; the card says so every time
  '685925a3458130001380e80a': {
    beds: { KING_BED: 1, [BED_140]: 1 },
    settled: ['duvets_short'],
    note: 'Nenosiť tablety do umývačky riadu a zatiaľ ani toaletný papier – v zásuvke v skrini je veľká zásoba.',
    skipItems: ['myckaKaps', 'toaletak'],
  },
  // Ventúrska A, Charming (Martina, 2026-10-21): the flat has no dishwasher, so no dishwasher tablets; the card says so
  // in red every time
  '6859255a167a6d001324a29a': {
    alert: 'Nebaliť tablety do umývačky – v byte nie je umývačka.',
    skipItems: ['myckaKaps'],
  },
};

export function flatFacts(guestyId: string | null | undefined): FlatFacts | null {
  return (guestyId && FLAT_FACTS[guestyId]) || null;
}

/** Angelika's name of a flat, or null. */
export function flatAlias(guestyId: string | null | undefined): string | null {
  return flatFacts(guestyId)?.alias ?? null;
}

/** Sheet key of a made bed of `type` (see FlatFacts.singleSheet): large by default, a small one when confirmed, 140 cm for a 140 cm bed. */
export function sheetKeyFor(type: string, group: 'dvoj' | 'jedno' | 'gauc', facts: FlatFacts | null): keyof SheetKeys {
  if (group !== 'jedno') return 'plachta';
  if (type === BED_140) return 'plachta140';
  return facts?.singleSheet === 'small' ? 'plachtaM' : 'plachta';
}

export type SheetKeys = Pick<Counts, 'plachta' | 'plachtaM' | 'plachta140'>;
