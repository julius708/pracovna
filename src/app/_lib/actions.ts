'use server';

import { revalidatePath } from 'next/cache';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { isTransientAuthError, loginErrorKey } from '@/db/auth-errors';
import type { MemoryRepo } from '@/db/memory-repo';
import { createServerSupabase } from '@/db/server';
import { env } from '@/env';
import { createLogger } from '@/guesty/log';
import { createRepoFromEnv } from '@/sync/context';
import { loadBoard, type BoardData } from './board';
import { memoryAddBoardNote, memoryCheck, memoryEditBoardNote, memoryNote, memoryPack, memoryRemoveBoardNote, memoryUnpack, type StaffResult } from './memory-staff';
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
/** "Dôležité info": adds a note for one board day under the viewer's name. */
export async function addBoardNoteAction(text: string, date: string, actionId: string): Promise<ActionResult> {
  return withViewer(async (viewer) => {
    if (supabaseConfigured()) return rpc('add_board_note', { p_text: text, p_date: date, p_action_id: actionId });
    return memoryAddBoardNote(memoryRepo(), viewer, text, date, actionId);
  });
}

/** Rewrites a notice-board note (author only). */
export async function editBoardNoteAction(id: string, text: string, actionId: string): Promise<ActionResult> {
  return withViewer(async (viewer) => {
    if (supabaseConfigured()) return rpc('edit_board_note', { p_id: id, p_text: text, p_action_id: actionId });
    return memoryEditBoardNote(memoryRepo(), viewer, id, text);
  });
}

/** Removes a notice-board note (author or admin). */
export async function removeBoardNoteAction(id: string, actionId: string): Promise<ActionResult> {
  return withViewer(async (viewer) => {
    if (supabaseConfigured()) return rpc('remove_board_note', { p_id: id, p_action_id: actionId });
    return memoryRemoveBoardNote(memoryRepo(), viewer, id);
  });
}

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

/** Public origin for links in e-mails: APP_URL, else the request's own origin. */
async function requestOrigin(): Promise<string> {
  const configured = env().APP_URL;
  if (configured) return configured.replace(/\/$/, '');
  const h = await headers();
  const origin = h.get('origin');
  if (origin) return origin;
  const host = h.get('x-forwarded-host') ?? h.get('host');
  return host ? `${h.get('x-forwarded-proto') ?? 'https'}://${host}` : '';
}

export interface ForgotState {
  sent: boolean;
  error: 'email' | 'tooMany' | 'offline' | 'failed' | null;
}

/** Supabase answers these when the project cannot send e-mail at all or the address is malformed. */
const SEND_CONFIG_ERRORS = new Set(['email_address_not_authorized', 'email_provider_disabled', 'smtp_error', 'email_address_invalid', 'validation_failed']);

/**
 * "Zabudnuté heslo": asks Supabase to e-mail a recovery link that lands on
 * /auth/callback and then /nove-heslo. Whether the e-mail exists is never
 * revealed: unknown addresses get the same "sent" answer, and the per-address
 * send limit (which only an existing account can hit) is reported as sent too,
 * because a link really was sent a moment earlier.
 */
export async function forgotPasswordAction(_prev: ForgotState, formData: FormData): Promise<ForgotState> {
  const email = String(formData.get('email') ?? '').trim();
  if (!email) return { sent: false, error: 'email' };
  const db = await createServerSupabase();
  if (!db) return { sent: false, error: 'offline' };
  const { error } = await db.auth.resetPasswordForEmail(email, { redirectTo: `${await requestOrigin()}/auth/callback?next=/nove-heslo` });
  if (!error) return { sent: true, error: null };
  createLogger({ level: env().LOG_LEVEL, bindings: { job: 'auth' } }).warn('auth.recover.failed', { code: error.code ?? null, status: error.status ?? null });
  if (error.code === 'over_email_send_rate_limit') return { sent: true, error: null };
  if (error.status === 429 || error.code === 'over_request_rate_limit') return { sent: false, error: 'tooMany' };
  if (isTransientAuthError(error)) return { sent: false, error: 'offline' };
  if (SEND_CONFIG_ERRORS.has(error.code ?? '')) return { sent: false, error: 'failed' };
  return { sent: true, error: null };
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
