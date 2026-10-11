/**
 * Types of the pure packing domain. Nothing here imports Next, Supabase or Guesty.
 */
import type { FlatFacts } from './flats';

/** Bed groups used by the linen table. */
export type BedGroup = 'dvoj' | 'jedno' | 'gauc';

/** ISO calendar date "YYYY-MM-DD" in Europe/Bratislava. */
export type Ymd = string;

/** Item of the linen table (label editable by admins). */
export interface ItemDef {
  key: string;
  label: string;
  size?: string;
}

/** Counts per item key, e.g. { paplonV: 1, vankus: 2, plachta: 1 }. */
export type Counts = Record<string, number>;

/** Settings editable in "Nastavenie" (defaults in settings.ts). */
export interface PackingSettings {
  items: ItemDef[];
  beds: Record<BedGroup, Counts>;
  perGuest: Counts;
  perBathroom: Counts;
  perApartment: Counts;
  checklist: string[];
}

/** One "Kapsule:" entry after parsing. */
export interface CapsuleSpec {
  /**
   * Type text as written, e.g. "L'OR Nespresso (veľké)". Empty for "upresniť"
   * and for a count without a type ("Kapsule: 10 ks"), which the card shows as
   * the generic row with "druh nezadaný v Guesty".
   */
  type: string;
  /** Fixed count from "N ks", or null = count follows people. */
  n: number | null;
  /** ok = a real type; unsure = "upresniť". */
  mode: 'ok' | 'unsure';
}

/** Parsed "Informácie do práčovne" field. */
export interface ParsedLaundry {
  /** Exact duvet counts; a present object means "replace the calculation". Missing line = 0. */
  duvetCounts: { large: number; small: number } | null;
  /** Duvet type from "Paplóny: malé|veľké" (used only without exact counts). */
  duvetType: 'male' | 'velke' | null;
  /** Per-item overrides (absolute counts). */
  overrides: Partial<Record<'predlozka' | 'osuskaV' | 'uterakM', number>>;
  /** "Prádlo: súkromné" */
  private: boolean;
  /** "Kávovar: …" */
  coffee: string | null;
  /**
   * null  = no "Kapsule:" line at all (row with "druh nezadaný v Guesty"),
   * []    = explicitly none ("nedávať", "žiadne"),
   * [...] = types (or one unsure entry for "upresniť").
   */
  capsules: CapsuleSpec[] | null;
  /** "Navyše: a, b" and aliases. */
  extras: string[];
  /** "Poznámka: …" plus every unknown line, in order. */
  notes: string[];
  /** The field text says the owner cleans (see OWNER_CLEANS_PHRASES). */
  ownerCleans: boolean;
}

/** Listing data needed by the calculator (a snapshot from Guesty). */
export interface ListingInput {
  guestyId: string;
  name: string;
  /** Bed type -> quantity, e.g. { KING_BED: 1, SOFA_BED: 1 }. */
  beds: Record<string, number>;
  /** Guesty accommodates; null/0 = unknown. */
  accommodates: number | null;
  /** Guesty bathrooms, may be 1.5; null = unknown. */
  bathrooms: number | null;
  /** Parsed laundry field, null when the field is empty. */
  laundry: ParsedLaundry | null;
  cleaner?: string | null;
}

/** Reservation data needed by the calculator. Clock times are never used. */
export interface ReservationInput {
  guestyId: string;
  listingId: string;
  checkInDate: Ymd;
  checkOutDate: Ymd;
  /** Guesty guestsCount (adults + children). null/0 = unknown. */
  guests: number | null;
  adults?: number | null;
  children?: number | null;
  infants?: number | null;
  confirmationCode?: string | null;
  /** True when the stay spans several listings. */
  multiStay?: boolean;
}

/** Calendar data for one gap day. */
export interface CalendarDay {
  /** Guesty minNights; null = unknown. */
  minNights: number | null;
  /** false when the day is blocked / unavailable in the calendar. */
  available?: boolean | null;
  /** Closed to arrival. */
  cta?: boolean | null;
}

/** Everything the calculator needs for one package. */
export interface PackageInput {
  /** Package date = check-out date of the outgoing reservation. */
  date: Ymd;
  listing: ListingInput;
  outgoing: ReservationInput;
  /** Next confirmed reservation of the listing on/after date, or null. */
  next: ReservationInput | null;
  /** Calendar per gap day (keys "YYYY-MM-DD"). Missing key = unknown. */
  calendar: Record<Ymd, CalendarDay>;
  settings: PackingSettings;
  /** Duvet type chosen in Settings for this listing (lowest precedence). */
  duvetTypeSetting?: 'male' | 'velke' | null;
  /** True when another package of the same listing has the same date. */
  doubleCheckout?: boolean;
  /**
   * Angelika's facts about the flat (src/core/packing/flats.ts). Left out = looked
   * up by the listing id; null = none (tests).
   */
  facts?: FlatFacts | null;
}

export type PeopleSource = 'same_day' | 'gap' | 'capacity' | 'capacity_from_beds';

export type WarningCode =
  | 'bunk'
  | 'no_duvet_info'
  | 'duvets_short'
  | 'duvets_exceed_capacity'
  | 'beds_insufficient'
  | 'guests_missing'
  | 'capacity_missing'
  | 'bathrooms_missing'
  | 'min_nights_unknown'
  | 'no_beds'
  | 'unknown_bed_type'
  | 'capsules_multi'
  | 'multi_stay'
  | 'double_checkout'
  /** Info, not a problem: more beds are made than the guests need if they pair up (2 guests, 2 beds). */
  | 'separate_beds'
  /** A single bed or fold-out is made: the sheet size is to be checked with Angelika (small sheets are never packed automatically). */
  | 'sheet_size_check';

export interface GapInfo {
  nights: number;
  /** Highest known minNights over the gap days (what makes the gap unsellable). */
  minNightsMax: number | null;
  /** true = nothing fits, false = sellable, null = unknown calendar. */
  blocked: boolean | null;
  /** Why it is blocked. */
  reason: 'min_nights' | 'calendar_blocked' | null;
}

export interface BedPlan {
  /** Regular beds (bunk beds already expanded to 2 singles). */
  regular: { type: string; qty: number }[];
  sofasTotal: number;
  sofasUsed: number;
  /** Groups of every bed that gets linen, in order. */
  usedGroups: BedGroup[];
  capacityRegular: number;
  capacityAll: number;
  bunk: boolean;
}

export interface LineItem {
  key: string;
  label: string;
  size: string;
  n: number;
  /** calc = from the table; guesty = replaced by an override from Guesty. */
  source: 'calc' | 'guesty';
}

export interface CapsuleLine {
  /** Type text as written, or "" for the missing/unsure rows. */
  type: string;
  /** Normalised key for totals ("l'or nespresso (velke)"). */
  typeKey: string;
  n: number;
  /** Count came from "N ks". */
  fixed: boolean;
  state: 'ok' | 'unsure' | 'missing';
  /** Asset file name in /assets, or null. */
  photo: string | null;
}

/** facts = the flat's full set as Angelika counts it (flats.ts), shown as "podľa Angeliky". */
export type DuvetSource = 'guesty_exact' | 'guesty_type' | 'setting' | 'default' | 'facts';

export interface PackingResult {
  v: 1;
  people: number;
  peopleSource: PeopleSource;
  sameDay: boolean;
  next: {
    reservationId: string;
    date: Ymd;
    guests: number | null;
    children: number;
    infants: number;
  } | null;
  gap: GapInfo | null;
  beds: BedPlan;
  bathrooms: number;
  linen: LineItem[];
  consumables: LineItem[];
  capsules: CapsuleLine[];
  duvetSource: DuvetSource;
  duvetType: 'male' | 'velke' | 'exact';
  /**
   * Present only when the Guesty duvet set is larger than the flat's capacity
   * (warning duvets_exceed_capacity): the numbers for the card text. Optional so
   * that results of every other flat keep their shape and hash.
   */
  duvetInventory?: { large: number; small: number; capacity: number };
  private: boolean;
  coffee: string | null;
  guestyNote: string | null;
  checklist: string[];
  cleaner: string | null;
  warnings: WarningCode[];
}
