import { OWNER_CLEANS_PHRASES } from './constants';
import { firstInt, norm, splitList, uniqueStrings } from './normalize';
import type { CapsuleSpec, ParsedLaundry } from './types';

/** Keys (normalised) that give an exact duvet count. */
const EXACT_LARGE = new Set(['paplon velky', 'paplony velke', 'velky paplon', 'velke paplony']);
const EXACT_SMALL = new Set(['paplon maly', 'paplony male', 'maly paplon', 'male paplony']);

/** Keys that give only the duvet type ("Paplóny: malé"). */
const DUVET_TYPE_KEYS = new Set(['paplon', 'paplony', 'obliecky', 'obliecka']);

/** Per-item override keys (normalised) -> item key. Aliases from sync.py. */
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

/** "nedávať", "žiadne", "nie", "bez", "-", "0" */
const CAPSULES_NONE = /^(ziad|nie\b|bez\b|ned|-|0$)/;
const CAPSULES_UNSURE = /^upresn/;

/** Parses one "Kapsule:" value into specs, [] for none, or one unsure entry. */
export function parseCapsules(value: string): CapsuleSpec[] {
  const parts = splitList(value);
  const out: CapsuleSpec[] = [];
  for (const part of parts) {
    const n = norm(part);
    if (CAPSULES_NONE.test(n)) continue;
    if (CAPSULES_UNSURE.test(n)) {
      out.push({ type: '', n: null, mode: 'unsure' });
      continue;
    }
    const count = firstInt(part);
    // remove "10 ks", "10x", "10 ×", "x10" and trailing separators from the type text
    const type = part
      .replace(/\b\d+\s*(ks|x|×)?\.?/gi, '')
      .replace(/(^|\s)[x×]\s*(?=\S)/gi, ' ')
      .replace(/^[\s\-–:x×]+|[\s\-–:x×]+$/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    out.push({ type: type || 'Kapsule', n: count, mode: 'ok' });
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
      const v = norm(value);
      if (v.includes('mal')) out.duvetType = 'male';
      else if (v.includes('velk')) out.duvetType = 'velke';
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
    if (key.startsWith('pradlo') && value) {
      out.private = norm(value).includes('sukrom');
      continue;
    }
    if (key.startsWith('kavovar') && value) {
      out.coffee = value;
      continue;
    }
    if (key.startsWith('kapsul') && value) {
      capsuleLines++;
      capsules = capsules.concat(parseCapsules(value));
      continue;
    }
    if (/^(checklist|navyse|extra|pribalit)/.test(key) && value) {
      out.extras.push(...splitList(value));
      continue;
    }
    if (key.startsWith('poznam')) {
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
