import 'server-only';
import { todayInTz, windowDates, type PackingResult, type Ymd } from '@/core/packing';
import type { MemoryRepo } from '@/db/memory-repo';
import { createServerSupabase } from '@/db/server';
import type { Checklist, PackageStatus } from '@/db/types';
import { env } from '@/env';
import { createRepoFromEnv } from '@/sync/context';
import { CLEANING_REQUEST_COLUMNS, cleaningRights, type CleaningData, type CleaningRequest } from './cleaning';
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
  /** Set on a reply: the note it answers (shown under it). */
  parent_id: string | null;
}

export const NOTE_COLUMNS = 'id, text, date, author, author_name, created_at, edited_at, parent_id';

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

/** "Skoré odchody": guests leaving a flat early on a board day (Martina, 2026-10-22). */
export interface EarlyDeparture {
  id: string;
  listing_id: string;
  listing_name: string;
  /** The departure day. */
  date: Ymd;
  /** "HH:MM" */
  departure: string;
  note: string;
  author: string | null;
  author_name: string;
  created_at: string;
}

export const DEPARTURE_COLUMNS = 'id, listing_id, listing_name, date, departure, note, author, author_name, created_at';

export const BOARD_COLUMNS =
  'id, listing_id, listing_name, date, status, hidden, cancel_reason, same_day, target_people, incoming_reservation_id, computed_items, computed_hash, warnings, note, note_by_name, note_at, checklist, packed_by_name, packed_at, packed_hash';

export interface BoardData {
  today: Ymd;
  /** The board days, today first (WINDOW_DAYS of them). */
  dates: Ymd[];
  packages: BoardPackage[];
  /** "Dôležité info" for the board days, newest first. */
  notes: BoardNote[];
  /** "Skoré príchody" typed in for the board days (migration 0016), by day and time. */
  arrivals: EarlyArrival[];
  /** "Skoré odchody" typed in for the board days (migration 0017), by day and time. */
  departures: EarlyDeparture[];
  /** In-scope flats for the early-arrival picker, by name. */
  listings: { id: string; name: string }[];
  /** listing id -> cleaning company (null when none). */
  cleaners: Record<string, string | null>;
  /** "Info pre upratovačov" for the viewer's app roles (empty when the viewer may not see it). */
  cleaning: CleaningData;
  /** Flats whose Guesty laundry field says "Kapsule: nedávať" (Martina, 2026-10-19): the card says so in red. */
  noCapsules: string[];
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
    const [pk, ls, st, nt, ea, ed] = await Promise.all([
      db.from('packages').select(BOARD_COLUMNS).in('date', dates),
      db.from('listings').select('guesty_id, name, cleaner, in_scope, capsules:laundry->capsules'),
      db.rpc('board_status'),
      db.from('board_notes').select(NOTE_COLUMNS).in('date', dates).is('removed_at', null).order('created_at', { ascending: false }),
      db.from('early_arrivals').select(ARRIVAL_COLUMNS).in('date', dates).is('removed_at', null).eq('source', 'manual').order('date').order('arrival').order('created_at'),
      db.from('early_departures').select(DEPARTURE_COLUMNS).in('date', dates).is('removed_at', null).order('date').order('departure').order('created_at'),
    ]);
    if (pk.error) throw new Error(`packages: ${pk.error.message}`);
    if (nt.error) throw new Error(`board_notes: ${nt.error.message}`);
    if (ea.error) throw new Error(`early_arrivals: ${ea.error.message}`);
    if (ed.error) throw new Error(`early_departures: ${ed.error.message}`);
    const cleaners: Record<string, string | null> = {};
    const listingRows = (ls.data ?? []) as { guesty_id: string; name: string; cleaner: string | null; in_scope: boolean; capsules: unknown }[];
    for (const l of listingRows) cleaners[l.guesty_id] = l.cleaner;
    const status = (st.data ?? {}) as { last_ok_sync_at?: string | null; consecutive_failures?: number };
    const cleaning = await loadCleaning(db, dates);
    return {
      today,
      dates,
      packages: (pk.data ?? []) as unknown as BoardPackage[],
      notes: (nt.data ?? []) as BoardNote[],
      arrivals: ((ea.data ?? []) as EarlyArrival[]).map((a) => ({ ...a, date: String(a.date).slice(0, 10) })),
      departures: ((ed.data ?? []) as EarlyDeparture[]).map((d) => ({ ...d, date: String(d.date).slice(0, 10) })),
      listings: pickerListings(listingRows.map((l) => ({ guesty_id: l.guesty_id, name: l.name, in_scope: l.in_scope }))),
      cleaners,
      noCapsules: listingRows.filter((l) => capsulesRefused(l.capsules)).map((l) => l.guesty_id),
      cleaning,
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
      .map((n) => ({ id: n.id, text: n.text, date: n.date, author: n.author, author_name: n.author_name, created_at: n.created_at, edited_at: n.edited_at, parent_id: n.parent_id ?? null })),
    arrivals: ((repo as MemoryRepo).earlyArrivals ?? [])
      .filter((a) => !a.removed_at && a.source === 'manual' && (dates as readonly string[]).includes(a.date))
      .sort((a, b) => a.date.localeCompare(b.date) || a.arrival.localeCompare(b.arrival) || a.created_at.localeCompare(b.created_at))
      .map((a) => ({ id: a.id, listing_id: a.listing_id, listing_name: a.listing_name, date: a.date, arrival: a.arrival, note: a.note, author: a.author, author_name: a.author_name, created_at: a.created_at })),
    departures: ((repo as MemoryRepo).earlyDepartures ?? [])
      .filter((d) => !d.removed_at && (dates as readonly string[]).includes(d.date))
      .sort((a, b) => a.date.localeCompare(b.date) || a.departure.localeCompare(b.departure) || a.created_at.localeCompare(b.created_at))
      .map((d) => ({ id: d.id, listing_id: d.listing_id, listing_name: d.listing_name, date: d.date, departure: d.departure, note: d.note, author: d.author, author_name: d.author_name, created_at: d.created_at })),
    listings: pickerListings(listings),
    cleaners,
    noCapsules: listings.filter((l) => l.in_scope && capsulesRefused(l.laundry?.capsules)).map((l) => l.guesty_id),
    cleaning: memoryCleaning(repo as MemoryRepo, listings, dates, viewer),
    status: { lastOkSyncAt: lastOk, consecutiveFailures: failures ?? 0 },
    loadedAt,
    live: false,
  };
}

/** The early-arrival picker: in-scope flats by name. */
function pickerListings(rows: { guesty_id: string; name: string; in_scope: boolean }[]): { id: string; name: string }[] {
  return rows
    .filter((l) => l.in_scope)
    .map((l) => ({ id: l.guesty_id, name: l.name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'sk'));
}

/** The parsed "Kapsule:" line is an explicit none ("nedávať", "žiadne"): an empty list, not a missing line (null). */
function capsulesRefused(capsules: unknown): boolean {
  return Array.isArray(capsules) && capsules.length === 0;
}

type ServerDb = NonNullable<Awaited<ReturnType<typeof createServerSupabase>>>;

/** "Info pre upratovačov": the viewer's app roles decide; nothing is read for anyone else (RLS checks the same). */
async function loadCleaning(db: ServerDb, dates: readonly Ymd[]): Promise<CleaningData> {
  const roles = await db.rpc('current_app_roles');
  const rights = cleaningRights(Array.isArray(roles.data) ? (roles.data as string[]) : []);
  if (!rights.read) return { rights, info: {}, requests: [] };
  const [li, rq] = await Promise.all([
    db.from('listings').select('guesty_id, cleaning_info').eq('in_scope', true).not('cleaning_info', 'is', null),
    db.from('cleaning_requests').select(CLEANING_REQUEST_COLUMNS).in('date', dates as Ymd[]).is('removed_at', null).order('created_at'),
  ]);
  if (li.error) throw new Error(`listings.cleaning_info: ${li.error.message}`);
  if (rq.error) throw new Error(`cleaning_requests: ${rq.error.message}`);
  const info: Record<string, string> = {};
  for (const l of (li.data ?? []) as { guesty_id: string; cleaning_info: string | null }[]) if (l.cleaning_info?.trim()) info[l.guesty_id] = l.cleaning_info;
  return { rights, info, requests: ((rq.data ?? []) as CleaningRequest[]).map((r) => ({ ...r, date: String(r.date).slice(0, 10) })) };
}

/** Seed mode: the admin stand-in has the app role admin, the staff stand-in none. */
function memoryCleaning(repo: MemoryRepo, listings: { guesty_id: string; in_scope: boolean; cleaning_info?: string | null }[], dates: readonly Ymd[], viewer: Viewer): CleaningData {
  const rights = cleaningRights(viewer.role === 'admin' ? ['admin'] : []);
  if (!rights.read) return { rights, info: {}, requests: [] };
  const info: Record<string, string> = {};
  for (const l of listings) if (l.in_scope && l.cleaning_info?.trim()) info[l.guesty_id] = l.cleaning_info;
  const requests = (repo.cleaningRequests ?? [])
    .filter((r) => !r.removed_at && (dates as readonly string[]).includes(r.date))
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((r) => ({ id: r.id, date: r.date, listing_id: r.listing_id, listing_name: r.listing_name, text: r.text, author: r.author, author_name: r.author_name, created_at: r.created_at, parent_id: r.parent_id, done_at: r.done_at, done_by_name: r.done_by_name }));
  return { rights, info, requests };
}
