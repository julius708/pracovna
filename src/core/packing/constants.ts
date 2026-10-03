/**
 * Constants of the packing domain. These are code constants on purpose:
 * the spec says the rules must be implemented exactly, so they must not
 * drift through configuration.
 */

/** All dates in the app are calendar days in this zone. */
export const TZ = 'Europe/Bratislava';

/**
 * Gaps longer than this are treated as sellable without a calendar lookup
 * (a 15-night gap would need a 16-night minimum stay to be unsellable).
 * Approved default, proposal Q6b.
 */
export const GAP_MAX_NIGHTS = 14;

/** Guesty custom field "Informácie do práčovne" (long text). */
export const LAUNDRY_FIELD_ID = '6ab385c5bcf98e0011a9419d';

/** Listings whose owners clean themselves. Hard-coded fallback from the spec. */
export const OWNER_CLEANS_IDS: ReadonlySet<string> = new Set([
  '6a86ff17bca9ae0013a0b530', // Závodná Panoramic
  '6895eb9d1addea001a2a70d5', // Šoltésovej Bus
  '6a8813a766af800011acc0a5', // Hrobákova Family
  '69f88075223f680010e4b4cb', // Hrubá Borša
  '6a69e934295ae3003bea4bb4', // Kopčianka Haven
]);

/**
 * Diacritics-free, lower-case phrases in the laundry field that exclude a
 * listing from the laundry. Matched as whole phrases (substring of the
 * normalised text), never as loose word co-occurrence.
 */
export const OWNER_CLEANS_PHRASES: readonly string[] = [
  'upratuje majitel',
  'majitelia si upratuju',
  'majitel si upratuje',
  'nezaradit do pracovne',
  'mimo pracovne',
  'nie do pracovne',
  'pracovna: nie',
  // Šustekova, Sky (owner's instruction 2026-10-03): "NEPATRÍ DO NAŠEJ PRÁČOVNE."
  'nepatri do nasej pracovne',
  'nepatri do pracovne',
];

/** Guesty tag (normalised) that marks owner-cleaned listings. */
export const OWNER_CLEANS_TAG = 'upratuje majitel';

/** Nicknames starting with these prefixes belong to other cities. */
export const EXCLUDED_NICKNAME_PREFIX = /^\s*(ke|tt)\s*:/i;

/** City filter: address.city must contain this (normalised). */
export const CITY_MATCH = 'bratislava';

/** Maximum length of the staff note. */
export const NOTE_MAX_LENGTH = 200;

/** Item keys that belong to "Spotrebný tovar" (packed in the same bag). */
export const CONSUMABLE_KEYS: ReadonlySet<string> = new Set([
  'toaletak',
  'utierky',
  'spongia',
  'myckaKaps',
  'vreckoV',
  'vreckoM',
]);

/** Toilet paper rule: max(2, people). Fixed in code, read-only in Settings. */
export function toiletPaperCount(people: number): number {
  return Math.max(2, people);
}
