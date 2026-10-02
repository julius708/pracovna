'use server';

import { revalidatePath } from 'next/cache';
import type { PackingSettings } from '@/core/packing';
import type { MemoryRepo } from '@/db/memory-repo';
import { createServerSupabase } from '@/db/server';
import { env } from '@/env';
import { createLogger } from '@/guesty/log';
import { createRepoFromEnv, createSyncContext } from '@/sync/context';
import { syncListings } from '@/sync/listings';
import { reconcile } from '@/sync/reconcile';
import { recomputeWindow } from '@/sync/recompute';
import { getViewer, supabaseConfigured } from './viewer';

export interface SaveResult {
  ok: boolean;
  conflict?: boolean;
  version?: number;
  recomputed?: number;
  /** The value was saved but the recompute of the 3-day window failed; "Prepočítať balíčky" on /stav repeats it. */
  recomputeFailed?: boolean;
  error?: string;
}

async function requireAdmin() {
  const v = await getViewer();
  if (!v || !v.active || v.role !== 'admin') return null;
  return v;
}

/**
 * Recomputes the window after a settings change. It needs only the database
 * (never Guesty) and must not undo the value that was already saved, so any
 * failure is reported instead of thrown.
 */
async function recomputeAfterSettings(): Promise<{ recomputed: number; failed: boolean }> {
  const e = env();
  const log = createLogger({ level: e.LOG_LEVEL, bindings: { job: 'recompute', trigger: 'settings' } });
  try {
    const { repo } = createRepoFromEnv(e);
    const r = await recomputeWindow({ repo, log }, 'settings');
    return { recomputed: r.updated, failed: false };
  } catch (err) {
    log.error('recompute.settings.failed', { error: err instanceof Error ? err.message : String(err) });
    return { recomputed: 0, failed: true };
  }
}

export async function saveSettingsAction(key: 'linen_table' | 'duvet_types', value: Partial<PackingSettings> | Record<string, string>, expectedVersion: number | null): Promise<SaveResult> {
  if (!(await requireAdmin())) return { ok: false, error: 'unauthorized' };
  if (supabaseConfigured()) {
    const db = await createServerSupabase();
    if (!db) return { ok: false, error: 'failed' };
    const { data, error } = await db.rpc('save_settings', { p_key: key, p_value: value, p_expected_version: expectedVersion });
    if (error) return { ok: false, error: error.code === '42501' ? 'unauthorized' : 'failed' };
    const r = data as { ok: boolean; conflict?: boolean; version?: number };
    if (!r.ok) return { ok: false, conflict: r.conflict, version: r.version };
    const rc = await recomputeAfterSettings();
    revalidatePath('/');
    return { ok: true, version: r.version, recomputed: rc.recomputed, recomputeFailed: rc.failed };
  }
  const repo = createRepoFromEnv(env()).repo as MemoryRepo;
  repo.settings.set(key, value);
  const rc = await recomputeAfterSettings();
  revalidatePath('/');
  return { ok: true, version: 1, recomputed: rc.recomputed, recomputeFailed: rc.failed };
}

export type ProfileError = 'unauthorized' | 'self' | 'failed';

export async function setProfileAction(id: string, role: 'staff' | 'admin' | null, active: boolean | null): Promise<{ ok: boolean; error?: ProfileError }> {
  const me = await requireAdmin();
  if (!me) return { ok: false, error: 'unauthorized' };
  // an admin never locks themselves out (the RPC enforces the same rule)
  if (id === me.id && (role === 'staff' || active === false)) return { ok: false, error: 'self' };
  if (!supabaseConfigured()) return { ok: true };
  const db = await createServerSupabase();
  if (!db) return { ok: false, error: 'failed' };
  const { error } = await db.rpc('admin_set_profile', { p_id: id, p_role: role, p_active: active });
  if (error) {
    if (error.message.includes('self_change')) return { ok: false, error: 'self' };
    return { ok: false, error: error.code === '42501' ? 'unauthorized' : 'failed' };
  }
  revalidatePath('/nastavenia');
  return { ok: true };
}

export type SyncJob = 'reconcile' | 'listings' | 'recompute';

/** Buttons on the Stav page. Every failure, including a missing Guesty configuration, comes back as a message. */
export async function syncNowAction(job: SyncJob): Promise<{ ok: boolean; summary: string }> {
  if (!(await requireAdmin())) return { ok: false, summary: 'Nemáš oprávnenie.' };
  try {
    const ctx = createSyncContext();
    const common = { repo: ctx.repo, client: ctx.client, laundryFieldId: ctx.env.GUESTY_LAUNDRY_FIELD_ID, cleanerFieldId: ctx.env.GUESTY_CLEANER_FIELD_ID, log: ctx.log };
    if (job === 'reconcile') {
      const r = await reconcile(common, 'manual');
      revalidatePath('/');
      if (r.skipped) return { ok: true, summary: 'Synchronizácia už beží, skúste o chvíľu.' };
      const rc = r.recompute;
      return {
        ok: r.ok,
        summary: r.ok
          ? `Hotovo: ${rc?.packages ?? 0} balíčkov, nové ${rc?.created ?? 0}, zmenené ${rc?.updated ?? 0}, zrušené ${rc?.cancelled ?? 0}${r.partial.length ? ` (čiastočne: ${r.partial.join(', ')})` : ''}.`
          : `Zlyhalo: ${r.error}`,
      };
    }
    if (job === 'listings') {
      const r = await syncListings(common);
      revalidatePath('/');
      return { ok: r.applied, summary: r.applied ? `Načítaných ${r.fetched} bytov, v práčovni ${r.inScope}.` : `Nepoužité: vyradilo by ${r.dropped} bytov.` };
    }
    const r = await recomputeWindow({ repo: ctx.repo, log: ctx.log }, 'manual');
    revalidatePath('/');
    return { ok: true, summary: `Prepočítané: ${r.packages} balíčkov, zmenené ${r.updated}.` };
  } catch (e) {
    return { ok: false, summary: `Zlyhalo: ${e instanceof Error ? e.message : String(e)}` };
  }
}
