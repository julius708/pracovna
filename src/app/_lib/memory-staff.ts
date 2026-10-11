import 'server-only';
import { addDays, isYmd, NOTE_MAX_LENGTH, todayInTz, WINDOW_DAYS } from '@/core/packing';
import type { MemoryRepo } from '@/db/memory-repo';
import type { EarlyArrivalRow, PackageEventInsert, PackageRow } from '@/db/types';
import { randomUUID } from 'node:crypto';
import { packSnapshot } from './packing-log';
import type { Viewer } from './viewer';

/**
 * The staff RPCs (pack_package, unpack_package, set_note, toggle_check) as
 * they behave in Postgres, for the in-memory repo used without a database.
 */
export interface StaffResult {
  ok: boolean;
  status?: string;
  /** add_board_note: the id of the note. */
  id?: string;
  already_packed?: boolean;
  packed_by_name?: string | null;
  replayed?: boolean;
  checked?: Record<string, boolean>;
}

function event(repo: MemoryRepo, p: { id: string; date: string; listing_id: string; listing_name: string }, viewer: Viewer, e: PackageEventInsert['event'], actionId: string | null, data: Record<string, unknown>) {
  return repo.insertEvents([
    { package_id: p.id, package_date: p.date, listing_id: p.listing_id, listing_name: p.listing_name, event: e, actor: viewer.id, actor_name: viewer.name, client_action_id: actionId, data },
  ]);
}

function replayed(repo: MemoryRepo, actionId: string | null): boolean {
  return !!actionId && repo.events.some((e) => e.client_action_id === actionId);
}

/**
 * Staff may change only what the board shows them: visible rows from yesterday
 * to the last board day (Bratislava). Admins may touch any row. Mirrors the
 * check inside the Postgres RPCs.
 */
export function outOfWindow(repo: MemoryRepo, viewer: Viewer, p: PackageRow): boolean {
  if (viewer.role === 'admin') return false;
  const today = todayInTz(repo.now());
  return p.hidden || p.date < addDays(today, -1) || p.date > addDays(today, WINDOW_DAYS - 1);
}

export async function memoryPack(repo: MemoryRepo, viewer: Viewer, id: string, actionId: string | null): Promise<StaffResult> {
  const p = repo.packages.get(id);
  if (!p) throw new Error('package not found');
  if (replayed(repo, actionId)) return { ok: true, replayed: true, status: p.status };
  if (outOfWindow(repo, viewer, p)) return { ok: false, status: 'out_of_window' };
  if (p.status === 'packed') return { ok: false, already_packed: true, packed_by_name: p.packed_by_name, status: p.status };
  if (p.status !== 'todo') return { ok: false, status: p.status };
  const now = repo.now().toISOString();
  // the card as packed goes into the event (migration 0011), so the history keeps it whatever is recomputed later
  const snapshot = packSnapshot(p.target_people, p.computed_items) as unknown as Record<string, unknown>;
  Object.assign(p, { status: 'packed', packed_by: viewer.id, packed_by_name: viewer.name, packed_at: now, packed_hash: p.computed_hash, updated_at: now });
  await event(repo, p, viewer, 'packed', actionId, snapshot);
  return { ok: true, status: 'packed', packed_by_name: viewer.name };
}

export async function memoryUnpack(repo: MemoryRepo, viewer: Viewer, id: string, actionId: string | null): Promise<StaffResult> {
  const p = repo.packages.get(id);
  if (!p) throw new Error('package not found');
  if (replayed(repo, actionId)) return { ok: true, replayed: true };
  if (outOfWindow(repo, viewer, p)) return { ok: false, status: 'out_of_window' };
  if (p.status !== 'packed') return { ok: false, status: p.status };
  const previously = p.packed_by_name;
  Object.assign(p, { status: 'todo', packed_by: null, packed_by_name: null, packed_at: null, packed_hash: null, updated_at: repo.now().toISOString() });
  await event(repo, p, viewer, 'unpacked', actionId, { previously_packed_by: previously });
  return { ok: true, status: 'todo' };
}

export async function memoryNote(repo: MemoryRepo, viewer: Viewer, id: string, note: string, actionId: string | null): Promise<StaffResult> {
  const p = repo.packages.get(id);
  if (!p) throw new Error('package not found');
  if (replayed(repo, actionId)) return { ok: true, replayed: true };
  if (outOfWindow(repo, viewer, p)) return { ok: false, status: 'out_of_window' };
  if (p.status === 'cancelled') return { ok: false, status: p.status };
  const clean = (note ?? '').slice(0, NOTE_MAX_LENGTH);
  const previous = p.note;
  const now = repo.now().toISOString();
  Object.assign(p, { note: clean, note_by: clean ? viewer.id : null, note_by_name: clean ? viewer.name : null, note_at: clean ? now : null, updated_at: now });
  await event(repo, p, viewer, 'note', actionId, { note: clean, previous });
  return { ok: true };
}

export async function memoryCheck(repo: MemoryRepo, viewer: Viewer, id: string, item: string, checked: boolean, actionId: string | null): Promise<StaffResult> {
  const p = repo.packages.get(id);
  if (!p) throw new Error('package not found');
  if (replayed(repo, actionId)) return { ok: true, replayed: true };
  if (outOfWindow(repo, viewer, p)) return { ok: false, status: 'out_of_window' };
  if (p.status !== 'todo') return { ok: false, status: p.status };
  const map = { ...(p.checklist?.checked ?? {}) };
  if (checked) map[item] = true;
  else delete map[item];
  p.checklist = { items: p.checklist?.items ?? [], checked: map };
  p.updated_at = repo.now().toISOString();
  await event(repo, p, viewer, 'checklist', actionId, { item, checked });
  return { ok: true, checked: map };
}

/** add_board_note: a note on the shared notice board, replay-safe on the action id. */
export async function memoryAddBoardNote(repo: MemoryRepo, viewer: Viewer, text: string, date: string, actionId: string | null): Promise<StaffResult> {
  const existing = actionId ? repo.boardNotes.find((n) => n.client_action_id === actionId) : undefined;
  if (existing) return { ok: true, replayed: true, id: existing.id };
  const clean = text.trim().slice(0, 500);
  if (!clean) return { ok: false, status: 'empty' };
  const today = todayInTz(repo.now());
  if (!isYmd(date) || date < addDays(today, -1) || date > addDays(today, 30)) return { ok: false, status: 'bad_date' };
  const row = {
    id: randomUUID(),
    text: clean,
    date,
    author: viewer.id,
    author_name: viewer.name,
    created_at: repo.now().toISOString(),
    removed_at: null,
    removed_by: null,
    removed_by_name: null,
    client_action_id: actionId,
    edited_at: null,
  };
  repo.boardNotes.push(row);
  return { ok: true, id: row.id };
}

/** edit_board_note: the author rewrites their own note; admins do not rewrite other people's words. */
export async function memoryEditBoardNote(repo: MemoryRepo, viewer: Viewer, id: string, text: string): Promise<StaffResult> {
  const n = repo.boardNotes.find((x) => x.id === id);
  if (!n) throw new Error('note not found');
  if (n.removed_at) return { ok: false, status: 'removed' };
  if (n.author !== viewer.id) return { ok: false, status: 'not_author' };
  const clean = text.trim().slice(0, 500);
  if (!clean) return { ok: false, status: 'empty' };
  if (clean === n.text) return { ok: true, replayed: true };
  n.text = clean;
  n.edited_at = repo.now().toISOString();
  return { ok: true };
}

/** remove_board_note: by the author or an admin; removing twice is a no-op. */
const ARRIVAL_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** add_early_arrival as in Postgres (migration 0012): the flat must be in scope, the day near, the time "HH:MM". */
export async function memoryAddEarlyArrival(repo: MemoryRepo, viewer: Viewer, listingId: string, date: string, arrival: string, note: string, actionId: string | null): Promise<StaffResult> {
  repo.earlyArrivals ??= []; // a dev-server singleton created before this field existed
  const existing = actionId ? repo.earlyArrivals.find((a) => a.client_action_id === actionId) : undefined;
  if (existing) return { ok: true, replayed: true, id: existing.id };
  const listing = repo.listings.get(listingId);
  if (!listing || !listing.in_scope) return { ok: false, status: 'bad_listing' };
  const today = todayInTz(repo.now());
  if (!isYmd(date) || date < addDays(today, -1) || date > addDays(today, 60)) return { ok: false, status: 'bad_date' };
  if (!ARRIVAL_TIME.test(arrival)) return { ok: false, status: 'bad_time' };
  if (repo.earlyArrivals.some((a) => a.listing_id === listingId && a.date === date && !a.removed_at)) return { ok: false, status: 'duplicate' };
  const row: EarlyArrivalRow = {
    id: randomUUID(),
    listing_id: listingId,
    listing_name: listing.name,
    date,
    arrival,
    note: note.trim().slice(0, 300),
    author: viewer.id,
    author_name: viewer.name,
    created_at: repo.now().toISOString(),
    removed_at: null,
    removed_by: null,
    removed_by_name: null,
    client_action_id: actionId,
  };
  repo.earlyArrivals.push(row);
  return { ok: true, id: row.id };
}

export async function memoryRemoveEarlyArrival(repo: MemoryRepo, viewer: Viewer, id: string): Promise<StaffResult> {
  repo.earlyArrivals ??= [];
  const a = repo.earlyArrivals.find((x) => x.id === id);
  if (!a) throw new Error('early arrival not found');
  if (a.removed_at) return { ok: true, replayed: true };
  if (a.author !== viewer.id && viewer.role !== 'admin') return { ok: false, status: 'not_author' };
  a.removed_at = repo.now().toISOString();
  a.removed_by = viewer.id;
  a.removed_by_name = viewer.name;
  return { ok: true };
}

export async function memoryRemoveBoardNote(repo: MemoryRepo, viewer: Viewer, id: string): Promise<StaffResult> {
  const n = repo.boardNotes.find((x) => x.id === id);
  if (!n) throw new Error('note not found');
  if (n.removed_at) return { ok: true, replayed: true };
  if (n.author !== viewer.id && viewer.role !== 'admin') return { ok: false, status: 'not_author' };
  n.removed_at = repo.now().toISOString();
  n.removed_by = viewer.id;
  n.removed_by_name = viewer.name;
  return { ok: true };
}
