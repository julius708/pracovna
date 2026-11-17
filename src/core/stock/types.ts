/**
 * Types of the pure stock domain ("Sklad v appke", zadanie 17. 11. 2026).
 * Nothing here imports Next, Supabase or Guesty.
 *
 * Rule of the whole domain: a number that is not verified is never guessed.
 * A missing conversion (pieces per pack) makes a value "unverified" (Neoverené),
 * and nothing is calculated from it.
 */

export type Ymd = string;

/** Base unit of a stock card; all quantities in the ledger are in it. */
export type BaseUnit = 'ks' | 'rolka' | 'ml' | 'g';

/** consumable = toilet paper, bags...; capsule = coffee; linen = bed linen (a loan, not consumption). */
export type ItemKind = 'consumable' | 'capsule' | 'linen';

export interface StockItem {
  id: string;
  kind: ItemKind;
  product: string;
  category: string;
  /** Size / thickness / roll type... Different variants are different cards. */
  variant: string | null;
  /** Coffee system ("Nespresso Original", "Nespresso Vertuo", "Tchibo Cafissimo", "L'OR Tassimo"). */
  system: string | null;
  baseUnit: BaseUnit;
}

/** One supplier offer for an item; versioned by validity (a supplier may change the pack). */
export interface SupplierSku {
  id: string;
  itemId: string;
  supplier: string;
  sku: string | null;
  /** What is bought: one "pack" or one "carton" of packs. */
  purchaseUnit: 'pack' | 'carton';
  /** Base units in one pack. null = not verified. */
  piecesPerPack: number | null;
  /** Packs in one carton. null = unknown. */
  packsPerCarton: number | null;
  priceCents: number | null;
  currency: string;
  vatRate: number | null;
  validFrom: Ymd;
  validTo: Ymd | null;
  /** Minimum order, in purchase units. */
  minOrder: number | null;
  leadTimeDays: number | null;
  verifiedSource: string | null;
  verifiedAt: Ymd | null;
}

export type MovementKind =
  | 'opening_balance'
  | 'receipt'
  | 'issue_package'
  | 'issue_flat'
  | 'issue_manual'
  | 'return'
  | 'transfer_out'
  | 'transfer_in'
  | 'damage'
  | 'inventory_difference'
  | 'linen_issue'
  | 'linen_return';

/** The ledger row as the domain sees it; qty is signed, in the base unit. */
export interface Movement {
  id: string;
  itemId: string;
  warehouseId: string;
  kind: MovementKind;
  qty: number;
  /** ISO timestamp of the physical event. */
  at: string;
  /** Key that makes the physical event unique (a second insert is a no-op). */
  uniqueKey: string | null;
  sourceType: string | null;
  sourceId: string | null;
}

/** Maps a packing-card row to a stock card (data, not code: nothing is guessed). */
export interface IssueAlias {
  kind: ItemKind;
  /** consumable: key; capsule: normalised typeKey; linen: key|size. */
  sourceKey: string;
  itemId: string;
  /** Base units per card unit (default 1). */
  factor: number;
}

/** Snapshot stored by pack_package in package_events.data. */
export interface PackSnapshot {
  people?: number;
  linen?: { key: string; label?: string; size?: string; n: number }[];
  consumables?: { key: string; label?: string; size?: string; n: number }[];
  capsules?: { type?: string; typeKey?: string; n: number; state?: 'ok' | 'unsure' | 'missing' }[];
  private?: boolean;
}
