import 'server-only';
import { NOTE_MAX_LENGTH } from '@/core/packing';
import type { MemoryRepo } from '@/db/memory-repo';
import type { PackageEventInsert } from '@/db/types';
import type { Viewer } from './viewer';

/**
 * The staff RPCs (pack_package, unpack_package, set_note, toggle_check) as
 * they behave in Postgres, for the in-memory repo used without a database.
 */
export interface StaffResult {
  ok: boolean;
  status?: string;
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

export async function memoryPack(repo: MemoryRepo, viewer: Viewer, id: string, actionId: string | null): Promise<StaffResult> {
  const p = repo.packages.get(id);
  if (!p) throw new Error('package not found');
  if (replayed(repo, actionId)) return { ok: true, replayed: true, status: p.status };
  if (p.status === 'packed') return { ok: false, already_packed: true, packed_by_name: p.packed_by_name, status: p.status };
  if (p.status !== 'todo') return { ok: false, status: p.status };
  const now = repo.now().toISOString();
  Object.assign(p, { status: 'packed', packed_by: viewer.id, packed_by_name: viewer.name, packed_at: now, packed_hash: p.computed_hash, updated_at: now });
  await event(repo, p, viewer, 'packed', actionId, {});
  return { ok: true, status: 'packed', packed_by_name: viewer.name };
}

export async function memoryUnpack(repo: MemoryRepo, viewer: Viewer, id: string, actionId: string | null): Promise<StaffResult> {
  const p = repo.packages.get(id);
  if (!p) throw new Error('package not found');
  if (replayed(repo, actionId)) return { ok: true, replayed: true };
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
  if (p.status !== 'todo') return { ok: false, status: p.status };
  const map = { ...(p.checklist?.checked ?? {}) };
  if (checked) map[item] = true;
  else delete map[item];
  p.checklist = { items: p.checklist?.items ?? [], checked: map };
  p.updated_at = repo.now().toISOString();
  await event(repo, p, viewer, 'checklist', actionId, { item, checked });
  return { ok: true, checked: map };
}
