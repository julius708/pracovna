import { typeKey } from './normalize';
import type { CapsuleLine, ParsedLaundry, WarningCode } from './types';

/**
 * Display names that replace what the Guesty field says (owner, 2026-10-05):
 * every L'OR entry is in fact L'OR Tassimo, whatever the field calls it. The
 * key is a substring of the normalised type name.
 */
const CANONICAL: readonly [key: string, display: string][] = [["l'or", "L'OR Tassimo"]];

/** The capsule type as the card shows it. */
export function canonicalCapsuleType(type: string): string {
  const k = typeKey(type);
  const hit = CANONICAL.find(([key]) => k.includes(key));
  return hit ? hit[1] : type;
}

/** Photo per capsule type; the key is a substring of the normalised type name. Longest first. */
const PHOTOS: readonly [key: string, file: string][] = [
  ['nespresso original', 'kapsula-nespresso-original.png'],
  ['cafissimo', 'kapsula-tchibo-cafissimo.png'],
  ["l'or", 'kapsula-lor-tassimo.png'],
];

export function capsulePhoto(type: string | null | undefined): string | null {
  const k = typeKey(canonicalCapsuleType(String(type ?? '')));
  if (!k) return null;
  const hit = PHOTOS.find(([key]) => k.includes(key));
  return hit ? hit[1] : null;
}

export interface CapsuleRowsResult {
  rows: CapsuleLine[];
  warnings: WarningCode[];
}

function genericRow(state: 'missing' | 'unsure', n: number, fixed = false): CapsuleLine {
  return { type: '', typeKey: '', n, fixed, state, photo: null };
}

/**
 * Capsule rows of a package. Count = people unless a fixed "N ks" is given.
 * No "Kapsule:" line -> a row with the red note "druh nezadaný v Guesty";
 * a count without a type -> the same red row with the fixed count;
 * "upresniť" -> a row with "druh treba upresniť"; "nedávať"/"žiadne" -> no row.
 * Types are shown under their canonical name (see CANONICAL).
 */
export function capsuleRows(laundry: ParsedLaundry | null, people: number): CapsuleRowsResult {
  const warnings: WarningCode[] = [];
  const specs = laundry?.capsules;
  if (specs === null || specs === undefined) return { rows: [genericRow('missing', people)], warnings };

  const rows: CapsuleLine[] = [];
  if (specs.some((s) => s.mode === 'unsure')) rows.push(genericRow('unsure', people));

  const ok = specs.filter((s) => s.mode === 'ok');
  const typed = ok.filter((s) => s.type.trim() !== '');
  const typeless = ok.filter((s) => s.type.trim() === '');
  if (typed.length > 1 && typed.some((s) => s.n === null)) warnings.push('capsules_multi');

  for (const s of typeless) {
    const n = s.n ?? people;
    if (n > 0) rows.push(genericRow('missing', n, s.n !== null));
  }
  for (const s of typed) {
    const n = s.n !== null ? s.n : people;
    if (n <= 0) continue;
    const type = canonicalCapsuleType(s.type);
    rows.push({ type, typeKey: typeKey(type), n, fixed: s.n !== null, state: 'ok', photo: capsulePhoto(type) });
  }
  return { rows, warnings };
}
