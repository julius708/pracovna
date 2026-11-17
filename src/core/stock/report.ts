import { packInfo, skuAt } from './units';
import type { Movement, StockItem, SupplierSku } from './types';

export interface ReportRow {
  month: string;
  city: string;
  warehouseId: string;
  listingId: string | null;
  itemId: string;
  issued: number;
  returned: number;
  netIssue: number;
  /** Cost in cents of the net issue, or null when the conversion/price is unverified. */
  costCents: number | null;
}

export interface MonthContext {
  month: string;
  stays: number;
  guests: number;
  guestNights: number;
  occupiedFlatNights: number;
}

const ISSUE: ReadonlySet<string> = new Set(['issue_package', 'issue_flat', 'issue_manual']);

/** Month of an ISO timestamp in the Bratislava calendar. */
export function monthOf(iso: string): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bratislava', year: 'numeric', month: '2-digit' }).formatToParts(new Date(iso));
  return `${p.find((x) => x.type === 'year')!.value}-${p.find((x) => x.type === 'month')!.value}`;
}

export interface ReportMovement extends Movement {
  city: string;
  listingId: string | null;
}

/**
 * Monthly consumption by city / warehouse / flat / item. This is what was ISSUED from the
 * stock (net of confirmed returns), not what guests consumed. Linen is a loan, not
 * consumption, so it never appears. The report holds no person: nobody is ranked by clicks.
 */
export function monthlyConsumption(movements: readonly ReportMovement[], items: readonly StockItem[], skus: readonly SupplierSku[]): ReportRow[] {
  const kindOf = new Map(items.map((i) => [i.id, i.kind]));
  const rows = new Map<string, ReportRow>();
  for (const m of movements) {
    if (kindOf.get(m.itemId) === 'linen') continue;
    const isIssue = ISSUE.has(m.kind);
    const isReturn = m.kind === 'return';
    if (!isIssue && !isReturn) continue;
    const month = monthOf(m.at);
    const k = [month, m.city, m.warehouseId, m.listingId ?? '', m.itemId].join('|');
    const r = rows.get(k) ?? { month, city: m.city, warehouseId: m.warehouseId, listingId: m.listingId, itemId: m.itemId, issued: 0, returned: 0, netIssue: 0, costCents: 0 };
    if (isIssue) r.issued += -m.qty;
    else r.returned += m.qty;
    r.netIssue = r.issued - r.returned;
    rows.set(k, r);
  }
  for (const r of rows.values()) {
    const sku = skuAt(skus, r.itemId, `${r.month}-28`);
    const info = packInfo(sku);
    r.costCents = info.verified && sku && sku.priceCents !== null ? Math.round((r.netIssue / info.piecesPerPack) * sku.priceCents) : null;
  }
  return [...rows.values()].sort((a, b) => (a.month + a.city + a.itemId < b.month + b.city + b.itemId ? -1 : 1));
}

export interface DataQuality {
  unverifiedSkus: number;
  itemsWithoutOpening: number;
  unmappedRows: number;
  lastSyncAt: string | null;
}

export function dataQuality(items: readonly StockItem[], skus: readonly SupplierSku[], movements: readonly Movement[], unmappedRows: number, lastSyncAt: string | null): DataQuality {
  const opened = new Set(movements.filter((m) => m.kind === 'opening_balance').map((m) => m.itemId));
  return {
    unverifiedSkus: skus.filter((s) => !packInfo(s).verified).length,
    itemsWithoutOpening: items.filter((i) => !opened.has(i.id)).length,
    unmappedRows,
    lastSyncAt,
  };
}
