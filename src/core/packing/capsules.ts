import { typeKey } from './normalize';
import type { CapsuleLine, ParsedLaundry, WarningCode } from './types';

/** Photo per capsule type; the key is a substring of the normalised type name. Longest first. */
const PHOTOS: readonly [key: string, file: string][] = [
  ['nespresso original', 'kapsula-nespresso-original.png'],
  ['cafissimo', 'kapsula-tchibo-cafissimo.png'],
  ["l'or", 'kapsula-lor-nespresso.png'],
];

export function capsulePhoto(type: string | null | undefined): string | null {
  const k = typeKey(type);
  if (!k) return null;
  const hit = PHOTOS.find(([key]) => k.includes(key));
  return hit ? hit[1] : null;
}

export interface CapsuleRowsResult {
  rows: CapsuleLine[];
  warnings: WarningCode[];
}

/**
 * Capsule rows of a package. Count = people unless a fixed "N ks" is given.
 * No "Kapsule:" line -> a row with the red note "druh nezadaný v Guesty";
 * "upresniť" -> a row with "druh treba upresniť"; "nedávať"/"žiadne" -> no row.
 */
export function capsuleRows(laundry: ParsedLaundry | null, people: number): CapsuleRowsResult {
  const warnings: WarningCode[] = [];
  const specs = laundry?.capsules;
  if (specs === null || specs === undefined) {
    return { rows: [{ type: '', typeKey: '', n: people, fixed: false, state: 'missing', photo: null }], warnings };
  }
  const rows: CapsuleLine[] = [];
  if (specs.some((s) => s.mode === 'unsure')) {
    rows.push({ type: '', typeKey: '', n: people, fixed: false, state: 'unsure', photo: null });
  }
  const real = specs.filter((s) => s.mode === 'ok');
  if (real.length > 1 && real.some((s) => s.n === null)) warnings.push('capsules_multi');
  for (const s of real) {
    const n = s.n !== null ? s.n : people;
    if (n <= 0) continue;
    rows.push({ type: s.type, typeKey: typeKey(s.type), n, fixed: s.n !== null, state: 'ok', photo: capsulePhoto(s.type) });
  }
  return { rows, warnings };
}
