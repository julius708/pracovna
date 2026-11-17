import type { SupplierSku, Ymd } from './types';

export type PackInfo = { verified: true; piecesPerPack: number } | { verified: false; reason: string };

/** A positive whole number (pieces cannot be fractional here). */
export const isPositiveInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n > 0;
export const isNonNegInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0;

/**
 * The conversion of a supplier SKU is usable only when pieces per pack is a positive
 * whole number AND it has a verification source and date. Otherwise "Neoverené".
 */
export function packInfo(sku: SupplierSku | null | undefined): PackInfo {
  if (!sku) return { verified: false, reason: 'chýba ponuka dodávateľa' };
  if (!isPositiveInt(sku.piecesPerPack)) return { verified: false, reason: 'neznámy počet kusov v balení' };
  if (!sku.verifiedSource || !sku.verifiedAt) return { verified: false, reason: 'chýba zdroj a dátum overenia' };
  return { verified: true, piecesPerPack: sku.piecesPerPack };
}

/** The offer of an item that was valid on `date` (latest start wins); null when none. */
export function skuAt(skus: readonly SupplierSku[], itemId: string, date: Ymd, supplier?: string): SupplierSku | null {
  const valid = skus
    .filter((s) => s.itemId === itemId && (!supplier || s.supplier === supplier) && s.validFrom <= date && (s.validTo === null || s.validTo >= date))
    .sort((a, b) => (a.validFrom < b.validFrom ? 1 : a.validFrom > b.validFrom ? -1 : 0));
  return valid[0] ?? null;
}

export interface CountInput {
  /** Whole packs counted; null/undefined = left empty. */
  packs?: number | null;
  /** Loose pieces counted; null/undefined = left empty. */
  loose?: number | null;
  /** Explicitly confirmed "overená nula". */
  verifiedZero?: boolean;
}

export type CountResult =
  | { state: 'unset' }
  | { state: 'zero'; total: 0 }
  | { state: 'counted'; total: number }
  | { state: 'unverified'; reason: string }
  | { state: 'invalid'; reason: string };

/**
 * total = packs x pieces per pack + loose. Empty is NOT zero: an untouched line is
 * "unset"; zero counts only when it was typed in or confirmed as "overená nula".
 * Whole packs without a verified conversion cannot be converted: "unverified".
 */
export function countTotal(input: CountInput, pack: PackInfo): CountResult {
  const { packs, loose, verifiedZero } = input;
  const has = (n: number | null | undefined) => n !== null && n !== undefined;
  if (has(packs) && !isNonNegInt(packs)) return { state: 'invalid', reason: 'počet balení musí byť celé číslo od 0' };
  if (has(loose) && !isNonNegInt(loose)) return { state: 'invalid', reason: 'voľné kusy musia byť celé číslo od 0' };
  if (verifiedZero) {
    if ((packs ?? 0) !== 0 || (loose ?? 0) !== 0) return { state: 'invalid', reason: 'overená nula nesmie mať množstvo' };
    return { state: 'zero', total: 0 };
  }
  if (!has(packs) && !has(loose)) return { state: 'unset' };
  const p = packs ?? 0;
  if (p > 0 && !pack.verified) return { state: 'unverified', reason: pack.reason };
  const total = p > 0 && pack.verified ? p * pack.piecesPerPack + (loose ?? 0) : (loose ?? 0);
  return total === 0 ? { state: 'zero', total: 0 } : { state: 'counted', total };
}
