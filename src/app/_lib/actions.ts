'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { loginErrorKey } from '@/db/auth-errors';
import type { MemoryRepo } from '@/db/memory-repo';
import { createServerSupabase } from '@/db/server';
import { env } from '@/env';
import { createRepoFromEnv } from '@/sync/context';
import { loadBoard, type BoardData } from './board';
import { memoryCheck, memoryNote, memoryPack, memoryUnpack, type StaffResult } from './memory-staff';
import { DEV_ROLE_COOKIE, devLoginAllowed, getViewer, supabaseConfigured } from './viewer';

export interface ActionResult extends StaffResult {
  error?: 'unauthorized' | 'failed' | 'not_found';
}

async function withViewer<T>(fn: (viewer: NonNullable<Awaited<ReturnType<typeof getViewer>>>) => Promise<T>): Promise<T | ActionResult> {
  const viewer = await getViewer();
  if (!viewer || !viewer.active) return { ok: false, error: 'unauthorized' };
  return fn(viewer);
}

async function rpc(name: string, args: Record<string, unknown>): Promise<ActionResult> {
  const db = await createServerSupabase();
  if (!db) return { ok: false, error: 'failed' };
  const { data, error } = await db.rpc(name, args);
  if (error) {
    if (error.code === '42501') return { ok: false, error: 'unauthorized' };
    if (error.code === 'P0002') return { ok: false, error: 'not_found' };
    return { ok: false, error: 'failed' };
  }
  return (data ?? { ok: true }) as ActionResult;
}

function memoryRepo(): MemoryRepo {
  return createRepoFromEnv(env()).repo as MemoryRepo;
}

export async function packAction(packageId: string, actionId: string): Promise<ActionResult> {
  return withViewer(async (viewer) => {
    if (supabaseConfigured()) return rpc('pack_package', { p_id: packageId, p_action_id: actionId });
    return memoryPack(memoryRepo(), viewer, packageId, actionId);
  });
}

export async function unpackAction(packageId: string, actionId: string): Promise<ActionResult> {
  return withViewer(async (viewer) => {
    if (supabaseConfigured()) return rpc('unpack_package', { p_id: packageId, p_action_id: actionId });
    return memoryUnpack(memoryRepo(), viewer, packageId, actionId);
  });
}

export async function noteAction(packageId: string, note: string, actionId: string): Promise<ActionResult> {
  return withViewer(async (viewer) => {
    if (supabaseConfigured()) return rpc('set_note', { p_id: packageId, p_note: note, p_action_id: actionId });
    return memoryNote(memoryRepo(), viewer, packageId, note, actionId);
  });
}

export async function checkAction(packageId: string, item: string, checked: boolean, actionId: string): Promise<ActionResult> {
  return withViewer(async (viewer) => {
    if (supabaseConfigured()) return rpc('toggle_check', { p_id: packageId, p_item: item, p_checked: checked, p_action_id: actionId });
    return memoryCheck(memoryRepo(), viewer, packageId, item, checked, actionId);
  });
}

/** Fresh board data for the live-update refetch. */
export async function refreshBoard(): Promise<BoardData | null> {
  const viewer = await getViewer();
  if (!viewer || !viewer.active) return null;
  return loadBoard(viewer);
}

export async function loginAction(_prev: { error: string | null }, formData: FormData): Promise<{ error: string | null }> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const db = await createServerSupabase();
  if (!db) return { error: 'offline' };
  const { data, error } = await db.auth.signInWithPassword({ email, password });
  if (error) return { error: loginErrorKey(error) };
  // a deactivated account gets no session (RLS lets every user read their own profile row)
  if (data.user) {
    const { data: profile } = await db.from('profiles').select('active').eq('id', data.user.id).maybeSingle();
    if (profile && !(profile as { active: boolean }).active) {
      await db.auth.signOut();
      return { error: 'deactivated' };
    }
  }
  redirect('/');
}

export async function devLoginAction(role: 'admin' | 'staff'): Promise<void> {
  if (!devLoginAllowed()) redirect('/login');
  (await cookies()).set(DEV_ROLE_COOKIE, role, { httpOnly: true, sameSite: 'lax', path: '/' });
  redirect('/');
}

export async function logoutAction(): Promise<void> {
  if (supabaseConfigured()) {
    const db = await createServerSupabase();
    await db?.auth.signOut();
  } else {
    (await cookies()).delete(DEV_ROLE_COOKIE);
  }
  revalidatePath('/');
  redirect('/login');
}
