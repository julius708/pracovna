import type { Ymd } from '@/core/packing';

/**
 * "Pre Angeliku - prosím dobaliť do tašiek a odkliknúť" (Martina, 2026-11-09):
 * items to bring to a flat on a board day, ticked "Dodané" once packed. The
 * ticks feed the admin "Vyúčtovanie" page (migration 0019).
 */
export interface DeliveryRequest {
  id: string;
  date: Ymd;
  listing_id: string;
  listing_name: string;
  text: string;
  author: string | null;
  author_name: string;
  created_at: string;
  delivered_at: string | null;
  delivered_by_name: string | null;
}

export const DELIVERY_COLUMNS = 'id, date, listing_id, listing_name, text, author, author_name, created_at, delivered_at, delivered_by_name';

/** "2026-11" for the month picker; the month of a day. */
export type YearMonth = string;

export function isYearMonth(s: string | null | undefined): s is YearMonth {
  return !!s && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
}

/** The first day of the month and of the next one, as Bratislava calendar dates. */
export function monthRange(ym: YearMonth): { from: Ymd; to: Ymd } {
  const [y, m] = ym.split('-').map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  return { from: `${ym}-01` as Ymd, to: `${next}-01` as Ymd };
}

/** The delivered requests of a month grouped by flat (flats by name, items by delivery time). */
export function billingByFlat(rows: DeliveryRequest[]): { listing_id: string; listing_name: string; items: DeliveryRequest[] }[] {
  const by = new Map<string, { listing_id: string; listing_name: string; items: DeliveryRequest[] }>();
  for (const r of rows) {
    if (!r.delivered_at) continue;
    let g = by.get(r.listing_id);
    if (!g) {
      g = { listing_id: r.listing_id, listing_name: r.listing_name, items: [] };
      by.set(r.listing_id, g);
    }
    g.items.push(r);
  }
  const out = [...by.values()].sort((a, b) => a.listing_name.localeCompare(b.listing_name, 'sk'));
  for (const g of out) g.items.sort((a, b) => (a.delivered_at ?? '').localeCompare(b.delivered_at ?? ''));
  return out;
}
