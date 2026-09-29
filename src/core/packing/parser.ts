import { OWNER_CLEANS_PHRASES } from './constants';
import { firstInt, norm, splitList, uniqueStrings } from './normalize';
import type { CapsuleSpec, ParsedLaundry } from './types';

/*
 * Keys are compared after normalisation (diacritics-free, lower-case, collapsed
 * spaces) and only against explicit spellings. Anything else is an unknown line
 * and becomes a note on the card (spec §3), never a silent drop.
 */

/** Exact duvet counts. */
const EXACT_LARGE = new Set(['paplon velky', 'paplony velke', 'velky paplon', 'velke paplony']);
const EXACT_SMALL = new Set(['paplon maly', 'paplony male', 'maly paplon', 'male paplony']);

/** Duvet type only ("Paplóny: malé"). */
const DUVET_TYPE_KEYS = new Set(['paplon', 'paplony', 'obliecky', 'obliecka']);
const DUVET_SMALL = /^mal[aey]?$/;
const DUVET_LARGE = /^velk[aey]?$/;

/** Per-item override keys -> item key. Aliases from the prototype's sync.py. */
const OVERRIDE_KEYS: Record<string, 'predlozka' | 'osuskaV' | 'uterakM'> = {
  predlozky: 'predlozka',
  predlozka: 'predlozka',
  'uteraky na nohy': 'predlozka',
  'uterak na nohy': 'predlozka',
  'uteraky na nohy do kupelne': 'predlozka',
  'uterak na nohy do kupelne': 'predlozka',
  osusky: 'osuskaV',
  osuska: 'osuskaV',
  'osusky velke': 'osuskaV',
  'osuska velka': 'osuskaV',
  uteraky: 'uterakM',
  uterak: 'uterakM',
  'uteraky male': 'uterakM',
  'uterak maly': 'uterakM',
};

/** Coffee capsules. "Kapsule do umývačky" is a consumable name, never a coffee line. */
const CAPSULE_KEYS = new Set([
  'kapsule',
  'kapsula',
  'kapsuly',
  'kapsule do kavy',
  'kapsula do kavy',
  'kapsuly do kavy',
  'kapsule do kavovaru',
  'kavove kapsule',
]);
const COFFEE_KEYS = new Set(['kavovar']);
const PRIVATE_KEYS = new Set(['pradlo', 'bielizen']);
const EXTRAS_KEYS = new Set(['navyse', 'checklist', 'extra', 'pribalit']);
const NOTE_KEYS = new Set(['poznamka', 'poznamky', 'pozn']);

/** "nedávať", "žiadne", "nie", "bez", "0" -> no capsules (prefix match on the normalised value). */
const CAPSULES_NONE = /^(ziad|nie\b|bez\b|ned|0$)/;
/** "upresniť" anywhere in the value -> the red "druh treba upresniť" row. */
const CAPSULES_UNSURE = /\bupresn/;

/**
 * Parses one "Kapsule:" value: types separated by ";" or ",", each with an
 * optional count ("10 ks", "10x", "x10"). Count = first integer, type = the rest.
 * A part with a count but no type keeps type "" (the card shows the generic row).
 */
export function parseCapsules(value: string): CapsuleSpec[] {
  const out: CapsuleSpec[] = [];
  for (const rawPart of splitList(value)) {
    const part = rawPart.replace(/^[\s\-–•*]+/, '').trim();
    const n = norm(part);
    if (!n || CAPSULES_NONE.test(n)) continue;
    if (CAPSULES_UNSURE.test(n)) {
      out.push({ type: '', n: null, mode: 'unsure' });
      continue;
    }
    const count = firstInt(part);
    if (count === 0) continue; // "0 ks" = none
    const type = part
      .replace(/(^|\s)[x×]\s*(?=\d)/gi, '$1') // "x10", "× 10" -> "10"
      .replace(/\b\d+\s*(ks|x|×)?\.?/gi, '') // "10", "10 ks", "10x", "10 ks."
      .replace(/^[\s\-–:]+|[\s\-–:]+$/g, '') // separators only, never letters
      .replace(/\s+/g, ' ')
      .trim();
    out.push({ type, n: count, mode: 'ok' });
  }
  return out;
}

/** Does the normalised field text say the owner cleans? Whole-phrase match only. */
export function textSaysOwnerCleans(text: string | null | undefined): boolean {
  const t = norm(text);
  if (!t) return false;
  return OWNER_CLEANS_PHRASES.some((p) => t.includes(p));
}

/**
 * Parses the Guesty field "Informácie do práčovne": one "Key: value" per line,
 * case- and diacritics-insensitive keys. Unknown lines become notes.
 */
export function parseLaundry(text: string | null | undefined): ParsedLaundry {
  const out: ParsedLaundry = {
    duvetCounts: null,
    duvetType: null,
    overrides: {},
    private: false,
    coffee: null,
    capsules: null,
    extras: [],
    notes: [],
    ownerCleans: false,
  };
  let large: number | null = null;
  let small: number | null = null;
  let capsuleLines = 0;
  let capsules: CapsuleSpec[] = [];

  for (const rawLine of String(text ?? '').split(/\r?\n/)) {
    const line = rawLine.replace(/^[\s\-•*]+/, '').trim();
    if (!line) continue;
    const colon = line.indexOf(':');
    if (colon < 0) {
      out.notes.push(line);
      continue;
    }
    const key = norm(line.slice(0, colon));
    const value = line.slice(colon + 1).trim();

    if (EXACT_LARGE.has(key)) {
      const n = firstInt(value);
      if (n !== null) {
        large = n;
        continue;
      }
    }
    if (EXACT_SMALL.has(key)) {
      const n = firstInt(value);
      if (n !== null) {
        small = n;
        continue;
      }
    }
    if (DUVET_TYPE_KEYS.has(key) && value) {
      const tokens = norm(value).split(' ');
      if (tokens.some((t) => DUVET_SMALL.test(t))) out.duvetType = 'male';
      else if (tokens.some((t) => DUVET_LARGE.test(t))) out.duvetType = 'velke';
      else out.notes.push(line);
      continue;
    }
    const override = OVERRIDE_KEYS[key];
    if (override) {
      const n = firstInt(value);
      if (n !== null) {
        out.overrides[override] = n;
        continue;
      }
    }
    if (PRIVATE_KEYS.has(key) && value && norm(value).includes('sukrom')) {
      out.private = true;
      continue;
    }
    if (COFFEE_KEYS.has(key) && value) {
      out.coffee = value;
      continue;
    }
    if (CAPSULE_KEYS.has(key) && value) {
      capsuleLines++;
      capsules = capsules.concat(parseCapsules(value));
      continue;
    }
    if (EXTRAS_KEYS.has(key) && value) {
      out.extras.push(...splitList(value));
      continue;
    }
    if (NOTE_KEYS.has(key)) {
      if (value) out.notes.push(value);
      continue;
    }
    out.notes.push(line);
  }

  if (large !== null || small !== null) out.duvetCounts = { large: large ?? 0, small: small ?? 0 };
  if (capsuleLines > 0) out.capsules = capsules;
  out.extras = uniqueStrings(out.extras);
  out.ownerCleans = textSaysOwnerCleans(text);
  return out;
}
