import { isNonNegInt, packInfo } from './units';
import type { SupplierSku } from './types';

export interface OrderInput {
  /** Demand until the next delivery, base units. */
  need: number;
  /** Safety reserve, base units. */
  reserve: number;
  /** Usable stock (verified), base units. */
  usableStock: number;
  /** Confirmed incoming quantity of open orders, base units. */
  incoming: number;
  sku: SupplierSku | null;
}

export type OrderProposal =
  | { status: 'unverified'; reason: string; rawBase: number }
  | {
      status: 'ok';
      /** max(0, need + reserve - usable - incoming), base units. */
      rawBase: number;
      /** Purchase units (packs, or cartons) after rounding up and the minimum order. */
      units: number;
      packs: number;
      orderedBase: number;
      /** What drove the final number. */
      basis: 'none' | 'pack_rounding' | 'carton_rounding' | 'minimum_order';
      /** Net price in cents of the whole line, or null when the price is unknown. */
      netCents: number | null;
    };

/**
 * need + reserve - usable stock - confirmed incoming, never below 0, rounded UP to
 * verified purchase packs (cartons if the offer is bought by cartons) and then raised
 * to the minimum order. Without a verified pack size there is no final number.
 * A supplier offer is not binding: the proposal is only a proposal until approved.
 */
export function proposeOrder(i: OrderInput): OrderProposal {
  const raw = Math.max(0, i.need + i.reserve - Math.max(0, i.usableStock) - i.incoming);
  const info = packInfo(i.sku);
  if (!info.verified || !i.sku) return { status: 'unverified', reason: info.verified ? 'chýba ponuka dodávateľa' : info.reason, rawBase: raw };
  const sku = i.sku;
  if (raw === 0) return { status: 'ok', rawBase: 0, units: 0, packs: 0, orderedBase: 0, basis: 'none', netCents: 0 };

  let packs = Math.ceil(raw / info.piecesPerPack);
  let basis: 'pack_rounding' | 'carton_rounding' | 'minimum_order' = 'pack_rounding';
  let units = packs;
  if (sku.purchaseUnit === 'carton') {
    if (!isNonNegInt(sku.packsPerCarton) || sku.packsPerCarton < 1) {
      return { status: 'unverified', reason: 'neznámy počet balení v kartóne', rawBase: raw };
    }
    units = Math.ceil(packs / sku.packsPerCarton);
    packs = units * sku.packsPerCarton;
    basis = 'carton_rounding';
  }
  if (sku.minOrder !== null && units < sku.minOrder) {
    units = sku.minOrder;
    packs = sku.purchaseUnit === 'carton' ? units * (sku.packsPerCarton ?? 1) : units;
    basis = 'minimum_order';
  }
  const orderedBase = packs * info.piecesPerPack;
  const netCents = sku.priceCents === null ? null : units * sku.priceCents;
  return { status: 'ok', rawBase: raw, units, packs, orderedBase, basis, netCents };
}

export type OrderStatus = 'draft' | 'review' | 'approved' | 'sent' | 'confirmed' | 'partially_received' | 'received' | 'cancelled';

/** návrh -> kontrola -> schválenie -> odoslanie -> potvrdenie dodávateľa -> príjem. */
const NEXT: Record<OrderStatus, readonly OrderStatus[]> = {
  draft: ['review', 'cancelled'],
  review: ['draft', 'approved', 'cancelled'],
  approved: ['sent', 'cancelled'],
  sent: ['confirmed', 'cancelled'],
  confirmed: ['partially_received', 'received', 'cancelled'],
  partially_received: ['partially_received', 'received'],
  received: [],
  cancelled: [],
};
export const canTransition = (from: OrderStatus, to: OrderStatus) => NEXT[from].includes(to);

/** Status after a receipt: complete when every line has received >= ordered packs. */
export function receiptStatus(lines: readonly { orderedPacks: number; receivedPacks: number }[]): 'partially_received' | 'received' {
  return lines.every((l) => l.receivedPacks >= l.orderedPacks) ? 'received' : 'partially_received';
}
