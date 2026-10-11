import 'server-only';
import { todayInTz, windowDates, type PackingResult, type Ymd } from '@/core/packing';
import type { MemoryRepo } from '@/db/memory-repo';
import { createServerSupabase } from '@/db/server';
import type { Checklist, PackageStatus } from '@/db/types';
import { env } from '@/env';
import { createRepoFromEnv } from '@/sync/context';
import { supabaseConfigured, type Viewer } from './viewer';

/** The subset of a package the board renders. */
export interface BoardPackage {
  id: string;
  listing_id: string;
  listing_name: string;
  date: Ymd;
  status: PackageStatus;
  hidden: boolean;
  cancel_reason: string | null;
  same_day: boolean;
  target_people: number;
  incoming_reservation_id: string | null;
  computed_items: PackingResult;
  computed_hash: string;
  warnings: string[];
  note: string;
  note_by_name: string | null;
  note_at: string | null;
  checklist: Checklist;
  packed_by_name: string | null;
  packed_at: string | null;
  packed_hash: string | null;
}

/** A note on the notice board above the list. */
export interface BoardNote {
  id: string;
  text: string;
  /** The board day the note belongs to (shown only under that tab). */
  date: Ymd;
  author: string | null;
  author_name: string;
  created_at: string;
  /** Set when the author changed the text. */
  edited_at: string | null;
}

export const NOTE_COLUMNS = 'id, text, date, author, author_name, created_at, edited_at';

/** "Skoré príchody": a guest arriving before 16:00 at a flat on a board day (owner, 2026-10-11). */
export interface EarlyArrival {
  id: string;
  listing_id: string;
  listing_name: string;
  /** The arrival day. */
  date: Ymd;
  /** "HH:MM" */
  arrival: string;
  note: string;
  author: string | null;
  author_name: string;
  created_at: string;
}

export const ARRIVAL_COLUMNS = 'id, listing_id, listing_name, date, arrival, note, author, author_name, created_at';

export const BOARD_COLUMNS =
  'id, listing_id, listing_name, date, status, hidden, cancel_reason, same_day, target_people, incoming_reservation_id, computed_items, computed_hash, warnings, note, note_by_name, note_at, checklist, packed_by_name, packed_at, packed_hash';

export interface BoardData {
  today: Ymd;
  /** The board days, today first (WINDOW_DAYS of them). */
  dates: Ymd[];
  packages: BoardPackage[];
  /** "Dôležité info" for the board days, newest first. */
  notes: BoardNote[];
  /** "Skoré príchody" for the board days, by day and time. */
  arrivals: EarlyArrival[];
  /** In-scope flats for the early-arrival picker, by name. */
  listings: { id: string; name: string }[];
  /** listing id -> cleaning company (null when none). */
  cleaners: Record<string, string | null>;
  status: { lastOkSyncAt: string | null; consecutiveFailures: number };
  /** ISO instant the data was read on the server. */
  loadedAt: string;
  /** Live updates come through Supabase Realtime; otherwise the client polls. */
  live: boolean;
}

/** Everything the board needs for the three days, read with the viewer's rights. */
export async function loadBoard(viewer: Viewer): Promise<BoardData> {
  const e = env();
  const today = todayInTz(new Date());
  const dates = windowDates(today);
  const loadedAt = new Date().toISOString();

  if (supabaseConfigured(e)) {
    const db = await createServerSupabase();
    if (!db) throw new Error('Supabase client unavailable');
    const [pk, ls, st, nt, ea] = await Promise.all([
      db.from('packages').select(BOARD_COLUMNS).in('date', dates),
      db.from('listings').select('guesty_id, name, cleaner, in_scope'),
      db.rpc('board_status'),
      db.from('board_notes').select(NOTE_COLUMNS).in('date', dates).is('removed_at', null).order('created_at', { ascending: false }),
      db.from('early_arrivals').select(ARRIVAL_COLUMNS).in('date', dates).is('removed_at', null).order('date').order('arrival').order('created_at'),
    ]);
    if (pk.error) throw new Error(`packages: ${pk.error.message}`);
    if (nt.error) throw new Error(`board_notes: ${nt.error.message}`);
    if (ea.error) throw new Error(`early_arrivals: ${ea.error.message}`);
    const cleaners: Record<string, string | null> = {};
    const listingRows = (ls.data ?? []) as { guesty_id: string; name: string; cleaner: string | null; in_scope: boolean }[];
    for (const l of listingRows) cleaners[l.guesty_id] = l.cleaner;
    const status = (st.data ?? {}) as { last_ok_sync_at?: string | null; consecutive_failures?: number };
    return {
      today,
      dates,
      packages: (pk.data ?? []) as unknown as BoardPackage[],
      notes: (nt.data ?? []) as BoardNote[],
      arrivals: ((ea.data ?? []) as EarlyArrival[]).map((a) => ({ ...a, date: String(a.date).slice(0, 10) })),
      listings: listingRows
        .filter((l) => l.in_scope)
        .map((l) => ({ id: l.guesty_id, name: l.name }))
        .sort((a, b) => a.name.localeCompare(b.name, 'sk')),
      cleaners,
      status: { lastOkSyncAt: status.last_ok_sync_at ?? null, consecutiveFailures: status.consecutive_failures ?? 0 },
      loadedAt,
      live: true,
    };
  }

  const { repo } = createRepoFromEnv(e);
  const all = await repo.getPackagesInWindow(dates);
  const visible = all.filter((p) => viewer.role === 'admin' || !p.hidden);
  const listings = await repo.getListings();
  const cleaners: Record<string, string | null> = {};
  for (const l of listings) if (l.in_scope) cleaners[l.guesty_id] = l.cleaner;
  const [lastOk, failures] = await Promise.all([repo.getState<string>('last_ok_sync_at'), repo.getState<number>('consecutive_failures')]);
  return {
    today,
    dates,
    packages: visible.map((p) => ({
      id: p.id,
      listing_id: p.listing_id,
      listing_name: p.listing_name,
      date: p.date,
      status: p.status,
      hidden: p.hidden,
      cancel_reason: p.cancel_reason,
      same_day: p.same_day,
      target_people: p.target_people,
      incoming_reservation_id: p.incoming_reservation_id,
      computed_items: p.computed_items,
      computed_hash: p.computed_hash,
      warnings: p.warnings,
      note: p.note,
      note_by_name: p.note_by_name,
      note_at: p.note_at,
      checklist: p.checklist,
      packed_by_name: p.packed_by_name,
      packed_at: p.packed_at,
      packed_hash: p.packed_hash,
    })),
    notes: ((repo as MemoryRepo).boardNotes ?? [])
      .filter((n) => !n.removed_at && (dates as readonly string[]).includes(n.date))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((n) => ({ id: n.id, text: n.text, date: n.date, author: n.author, author_name: n.author_name, created_at: n.created_at, edited_at: n.edited_at })),
    arrivals: ((repo as MemoryRepo).earlyArrivals ?? [])
      .filter((a) => !a.removed_at && (dates as readonly string[]).includes(a.date))
      .sort((a, b) => a.date.localeCompare(b.date) || a.arrival.localeCompare(b.arrival) || a.created_at.localeCompare(b.created_at))
      .map((a) => ({ id: a.id, listing_id: a.listing_id, listing_name: a.listing_name, date: a.date, arrival: a.arrival, note: a.note, author: a.author, author_name: a.author_name, created_at: a.created_at })),
    listings: listings
      .filter((l) => l.in_scope)
      .map((l) => ({ id: l.guesty_id, name: l.name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'sk')),
    cleaners,
    status: { lastOkSyncAt: lastOk, consecutiveFailures: failures ?? 0 },
    loadedAt,
    live: false,
  };
}
