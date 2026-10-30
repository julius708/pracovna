import type { Ymd } from '@/core/packing';

/**
 * "Info pre upratovačov" (Martina, 2026-10-30): the grey box on the board above
 * the packing section. Rights come from the shared LIVE-IN app roles
 * (public.current_app_roles(), migration 0018 checks the same lists).
 */
export const CLEANING_READ_ROLES = ['cleaning', 'admin', 'customer_service', 'operations'] as const;
export const CLEANING_WRITE_ROLES = ['admin', 'customer_service'] as const;
export const CLEANING_TICK_ROLES = ['cleaning', 'admin', 'customer_service'] as const;

export interface CleaningRights {
  /** Sees the box (and may reply). */
  read: boolean;
  /** Writes a new message. */
  write: boolean;
  /** Ticks a message as done. */
  tick: boolean;
  /** Removes anyone's message (an app admin). */
  admin: boolean;
}

export function cleaningRights(roles: readonly string[]): CleaningRights {
  const has = (list: readonly string[]) => roles.some((r) => list.includes(r));
  return { read: has(CLEANING_READ_ROLES), write: has(CLEANING_WRITE_ROLES), tick: has(CLEANING_TICK_ROLES), admin: roles.includes('admin') };
}

/** A message for the cleaners on a board day, or a reply to one. */
export interface CleaningRequest {
  id: string;
  date: Ymd;
  listing_id: string | null;
  listing_name: string | null;
  text: string;
  author: string | null;
  author_name: string;
  created_at: string;
  parent_id: string | null;
  done_at: string | null;
  done_by_name: string | null;
}

export const CLEANING_REQUEST_COLUMNS = 'id, date, listing_id, listing_name, text, author, author_name, created_at, parent_id, done_at, done_by_name';

export interface CleaningData {
  rights: CleaningRights;
  /** listing id -> the Guesty "INFO PRE UPRATOVAČOV" text (flats in scope with a non-empty note). */
  info: Record<string, string>;
  /** Messages and replies of the board days, oldest first. */
  requests: CleaningRequest[];
}

/** The flats of a day's check-outs that carry a Guesty note, by name (the board's order). */
export function cleaningInfoFlats(packages: { listing_id: string; listing_name: string; date: Ymd; status: string }[], info: Record<string, string>, date: Ymd): { listing_id: string; listing_name: string; info: string }[] {
  const seen = new Set<string>();
  const out: { listing_id: string; listing_name: string; info: string }[] = [];
  for (const p of packages) {
    if (p.date !== date || p.status === 'cancelled' || seen.has(p.listing_id)) continue;
    const text = info[p.listing_id]?.trim();
    if (!text) continue;
    seen.add(p.listing_id);
    out.push({ listing_id: p.listing_id, listing_name: p.listing_name, info: text });
  }
  return out.sort((a, b) => a.listing_name.localeCompare(b.listing_name, 'sk'));
}
