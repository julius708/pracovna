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
  author: string | null;
  author_name: string;
  created_at: string;
}

export const NOTE_COLUMNS = 'id, text, author, author_name, created_at';

export const BOARD_COLUMNS =
  'id, listing_id, listing_name, date, status, hidden, cancel_reason, same_day, target_people, incoming_reservation_id, computed_items, computed_hash, warnings, note, note_by_name, note_at, checklist, packed_by_name, packed_at, packed_hash';

export interface BoardData {
  today: Ymd;
  dates: [Ymd, Ymd, Ymd];
  packages: BoardPackage[];
  /** "Dôležité info pre Angeliku a Maxa", newest first. */
  notes: BoardNote[];
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
    const [pk, ls, st, nt] = await Promise.all([
      db.from('packages').select(BOARD_COLUMNS).in('date', dates),
      db.from('listings').select('guesty_id, cleaner'),
      db.rpc('board_status'),
      db.from('board_notes').select(NOTE_COLUMNS).is('removed_at', null).order('created_at', { ascending: false }),
    ]);
    if (pk.error) throw new Error(`packages: ${pk.error.message}`);
    if (nt.error) throw new Error(`board_notes: ${nt.error.message}`);
    const cleaners: Record<string, string | null> = {};
    for (const l of (ls.data ?? []) as { guesty_id: string; cleaner: string | null }[]) cleaners[l.guesty_id] = l.cleaner;
    const status = (st.data ?? {}) as { last_ok_sync_at?: string | null; consecutive_failures?: number };
    return {
      today,
      dates,
      packages: (pk.data ?? []) as unknown as BoardPackage[],
      notes: (nt.data ?? []) as BoardNote[],
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
      .filter((n) => !n.removed_at)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((n) => ({ id: n.id, text: n.text, author: n.author, author_name: n.author_name, created_at: n.created_at })),
    cleaners,
    status: { lastOkSyncAt: lastOk, consecutiveFailures: failures ?? 0 },
    loadedAt,
    live: false,
  };
}
