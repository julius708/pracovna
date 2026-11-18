import { addDays, ymdToDate } from './dates';
import { norm } from './normalize';
import type { Ymd } from './types';

/**
 * Extra cleanings written as free text (Martina, 2026-11-18): a message in
 * "Dôležité info" or "Info pre upratovačov" that asks for a cleaning outside a
 * check-out ("extra upratovanie", "prosím upratať", "predĺžený pobyt", "nabaliť
 * tašku" …) adds a packing card for the flat it names. Pure and unit-tested.
 */

/** Words that make a message a cleaning request (text already through norm()). */
const TRIGGERS: RegExp[] = [
  /extra\s*-?\s*upratov/,
  /mimoriadn\w*\s+upratov/,
  /medzi\s*-?\s*upratov/,
  /\bupratat\b/,
  /\bupratanie\b/,
  /\bupracte\b/,
  /\b(sa upratuje|upratuje sa) aj\b/,
  /\b(bude|je|mame|treba|potrebujem|potrebujeme)\b[^.!?\n]{0,25}\bupratovanie\b/,
  /\bupratovanie\s+(po|na|o\s*\d|dnes|zajtra|pozajtra)\b/,
];
/** A bag to pack: "nabaliť/zabaliť/nachystať … tašku" or "… prádlo". */
const BAG = /\btas(ka|ku|ky|ke|kou|iek|ok)\b|\bpradlo\b|\bbielizen\b/;
const PACK_VERB = /\b(nabal|zabal|zbal|nachyst|priprav|balit|balte)/;
/** "zabaliť aj Skypark Modern – 2 osoby": only with a number of people ("zabaliť aj žiarovku" is not a cleaning). */
const PACK_ALSO = /\b(nabal|zabal|zbal|nachyst|priprav)\w*\s+(prosim\s+)?aj\b/;
/** "predĺžený / dlhší pobyt" – a cleaning during a long stay, when it says for how many people. */
const LONG_STAY = /\bpredlzen\w*\s+pobyt|\bdlh\w*\s+pobyt|\bdlhodob\w*/;
/** "nebude upratovanie", "neupratujte", "nemusíte ísť", "nebaliť", "zrušené": not a request. */
const NEGATION = /\bne(musi|misi|uprat|bal|treba|bude|vykonav|chod|rob|ist)\w*|\bzrus\w*|\bstorn\w*/;

export function isExtraCleaningText(text: string): boolean {
  const t = norm(text);
  if (!t || NEGATION.test(t)) return false;
  if (TRIGGERS.some((r) => r.test(t))) return true;
  if (BAG.test(t) && PACK_VERB.test(t)) return true;
  return (PACK_ALSO.test(t) || LONG_STAY.test(t)) && extraPeople(t) !== null;
}

/** Words of a text: diacritics-free, lower case, split on anything but letters and digits. */
function words(text: string): string[] {
  return norm(text)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Slovak endings change ("Trnavská" -> "na Trnavskej"): compare the start of the word. */
function stem(w: string): string {
  return w.slice(0, Math.max(3, w.length - 2));
}

/** Roman numbers in names ("Skypark Luxe I", "Luxury II") read as digits, as people write them ("Luxury 1"). */
function roman(w: string): string {
  return w === 'i' ? '1' : w === 'ii' ? '2' : w === 'iii' ? '3' : w;
}

/** A qualifier telling flats of one street apart: one letter, a number or a number+letter ("2F"). */
function isQualifier(w: string): boolean {
  return /^([a-z]|\d{1,3}[a-z]?|i{1,3})$/.test(w);
}

interface FlatKey {
  id: string;
  name: string;
  street: string[];
  /** Street words shortened in the name ("Štef.", "Gross."): the text must start with the whole word. */
  abbr: Set<string>;
  qualifier: string | null;
  nick: string[];
}

/** "Trnavská A, Fabulous" -> street [trnavska], qualifier a, nick [fabulous]. */
export function flatKey(l: { id: string; name: string }): FlatKey {
  const [head, ...rest] = l.name.split(',');
  const clean = head.replace(/\(.*?\)/g, ' ');
  const h = words(clean);
  const abbr = new Set((norm(clean).match(/[a-z]+(?=\.)/g) ?? []).filter((w) => w.length > 1));
  let qualifier: string | null = null;
  if (h.length > 1 && isQualifier(h[h.length - 1])) qualifier = roman(h.pop()!);
  const street = h.filter((w) => w.length >= 3 && !/^\d+$/.test(w));
  const nick = words(rest.join(' ').replace(/\(.*?\)/g, ' '))
    .map(roman)
    .filter((w) => (w.length >= 4 && w !== 'the') || /^\d+$/.test(w));
  return { id: l.id, name: l.name, street: street.length ? street : h, abbr, qualifier, nick };
}

export interface FlatMatch {
  /** Flats the text names without doubt. */
  matched: { id: string; name: string }[];
  /** Streets named without telling which flat (e.g. "Žilinská" without A/B/C): the candidates. */
  unclear: { id: string; name: string }[][];
}

/** The flats a free text names, matched against the in-scope listings. */
export function matchFlats(text: string, listings: readonly { id: string; name: string }[]): FlatMatch {
  const ws = words(text);
  const keys = listings.map(flatKey);
  // a short word only takes a short ending ("Guľa" -> "Guli"), so "Luxe" is not "Luxury"
  const hit = (w: string, s: string, k: FlatKey) => (k.abbr.has(s) ? w.startsWith(s) : w.startsWith(stem(s)) && (s.length > 4 || w.length <= s.length + 1));
  /** Position right after the street words in the text, or -1. */
  const streetEnd = (k: FlatKey): number => {
    for (let i = 0; i < ws.length; i++) {
      let j = i;
      let ok = true;
      for (const s of k.street) {
        // the street words in order, allowing one filler word between ("Trnavská cesta A")
        while (j < ws.length && !hit(ws[j], s, k) && j - i <= k.street.length) j++;
        if (j >= ws.length || !hit(ws[j], s, k)) {
          ok = false;
          break;
        }
        j++;
      }
      if (ok) return j;
    }
    return -1;
  };
  const groups = new Map<string, { k: FlatKey; end: number }[]>();
  for (const k of keys) {
    const end = streetEnd(k);
    if (end < 0) continue;
    const g = k.street.join(' ');
    groups.set(g, [...(groups.get(g) ?? []), { k, end }]);
  }
  const out: FlatMatch = { matched: [], unclear: [] };
  // "Skypark Luxe I" also matches the street "Skypark": the longer street name wins
  const streets = [...groups.keys()];
  for (const [g, list] of groups) {
    const gw = g.split(' ');
    if (streets.some((o) => o !== g && o.split(' ').length > gw.length && gw.every((w) => o.split(' ').includes(w)))) continue;
    const scored: { k: FlatKey; score: number }[] = [];
    for (const { k, end } of list) {
      // the first letter / number within three words after the street ("Trnavsku cestu A", "Gross. 38")
      const q = ws.slice(end, end + 3).find(isQualifier);
      const near = q ? roman(q) : null;
      let score = 0;
      if (k.qualifier) {
        if (near === k.qualifier) score += 2;
        else if (near && list.some((o) => o.k.qualifier === near)) continue;
      }
      for (const n of k.nick) if (/^\d+$/.test(n) ? near === n : ws.some((w) => w.startsWith(stem(n)))) score += 1;
      scored.push({ k, score });
    }
    if (!scored.length) continue;
    const best = Math.max(...scored.map((s) => s.score));
    const top = scored.filter((s) => s.score === best);
    if (top.length === 1) out.matched.push({ id: top[0].k.id, name: top[0].k.name });
    else out.unclear.push(top.map((s) => ({ id: s.k.id, name: s.k.name })));
  }
  return out;
}

/** "na pondelok": only with "na" ("v nedeľu sa nešlo" speaks of the past, "namiesto soboty" of another day). */
const WEEKDAYS: [RegExp, number][] = [
  [/\bna\s+nedel/, 0],
  [/\bna\s+pondel/, 1],
  [/\bna\s+utor/, 2],
  [/\bna\s+stred/, 3],
  [/\bna\s+stvrt/, 4],
  [/\bna\s+piat/, 5],
  [/\bna\s+sobot/, 6],
];

/**
 * The day a message asks for: an explicit "9.11." / "9. 11. 2026", "dnes",
 * "zajtra", "pozajtra" or a weekday ("na pondelok"); otherwise the board day
 * the message was written under.
 */
export function extraDate(text: string, noteDate: Ymd): Ymd {
  const t = norm(text);
  const dm = t.match(/(?<![\d:])(\d{1,2})\.\s?(\d{1,2})\.(?:\s?(20\d\d))?(?![\d:])/);
  if (dm) {
    const d = Number(dm[1]);
    const m = Number(dm[2]);
    if (d >= 1 && d <= 31 && m >= 1 && m <= 12) {
      let y = dm[3] ? Number(dm[3]) : Number(noteDate.slice(0, 4));
      const ymd = (yy: number) => `${yy}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` as Ymd;
      // "2.1." written in late December is next year's
      if (!dm[3] && ymd(y) < addDays(noteDate, -60)) y++;
      return ymd(y);
    }
  }
  if (/\bpozajtra\b/.test(t)) return addDays(noteDate, 2);
  if (/\bzajtra\b/.test(t)) return addDays(noteDate, 1);
  if (/\bdnes\b/.test(t)) return noteDate;
  for (const [re, wd] of WEEKDAYS) {
    if (re.test(t)) {
      const now = ymdToDate(noteDate).getUTCDay();
      return addDays(noteDate, (wd - now + 7) % 7);
    }
  }
  return noteDate;
}

/** "1 osoba", "(1osoba)", "pre 3 osoby", "2 hostia": the number of people, or null. */
export function extraPeople(text: string): number | null {
  const m = norm(text).match(/(?<![\d.:])(\d{1,2})\s*-?\s*(?:extra\s+|dalsi\w*\s+)?(osob\w*|os\b|hostia|hosti|hostov|hosta|ludi|ludia|clovek|ludom)/);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= 20 ? n : null;
}

/** A message on the board ("Dôležité info" or "Info pre upratovačov"). */
export interface ExtraSource {
  id: string;
  from: 'notes' | 'cleaning';
  /** The board day it was written under. */
  date: Ymd;
  text: string;
  /** The flat picked in the form ("Info pre upratovačov"), when there is one. */
  listingId?: string | null;
}

export interface ExtraCleaning {
  listingId: string;
  listingName: string;
  date: Ymd;
  /** People written in the message; null = from the next reservation (or capacity). */
  people: number | null;
  /** The messages that asked for it (one card per flat and day). */
  sources: { id: string; from: 'notes' | 'cleaning'; text: string }[];
}

export interface ExtraUnclear {
  sourceId: string;
  candidates: { id: string; name: string }[];
}

/** What one message asks for: the flats and day, or why no card could be made. */
export function readExtra(src: ExtraSource, listings: readonly { id: string; name: string }[]): { flats: { id: string; name: string }[]; date: Ymd; people: number | null; unclear: { id: string; name: string }[][] } | null {
  if (!isExtraCleaningText(src.text)) return null;
  const date = extraDate(src.text, src.date);
  const people = extraPeople(src.text);
  const picked = src.listingId ? listings.find((l) => l.id === src.listingId) : undefined;
  if (picked) return { flats: [picked], date, people, unclear: [] };
  const m = matchFlats(src.text, listings);
  return { flats: m.matched, date, people, unclear: m.unclear };
}

/** Every extra cleaning the messages ask for, one per flat and day; messages for days outside `dates` are skipped. */
export function collectExtras(sources: readonly ExtraSource[], listings: readonly { id: string; name: string }[], dates: readonly Ymd[]): { extras: ExtraCleaning[]; unclear: ExtraUnclear[] } {
  const byKey = new Map<string, ExtraCleaning>();
  const unclear: ExtraUnclear[] = [];
  for (const src of sources) {
    const r = readExtra(src, listings);
    if (!r) continue;
    for (const u of r.unclear) unclear.push({ sourceId: src.id, candidates: u });
    if (!dates.includes(r.date)) continue;
    for (const f of r.flats) {
      const key = `${f.id}|${r.date}`;
      const e = byKey.get(key) ?? { listingId: f.id, listingName: f.name, date: r.date, people: null, sources: [] };
      if (r.people !== null) e.people = Math.max(e.people ?? 0, r.people);
      e.sources.push({ id: src.id, from: src.from, text: src.text });
      byKey.set(key, e);
    }
  }
  return { extras: [...byKey.values()], unclear };
}

/** Package key of an extra cleaning (packages.outgoing_reservation_id). */
export function extraPackageKey(listingId: string, date: Ymd): string {
  return `extra:${listingId}:${date}`;
}

export function isExtraPackageKey(id: string): boolean {
  return id.startsWith('extra:');
}
