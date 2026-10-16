'use server';

import type { MemoryRepo } from '@/db/memory-repo';
import { createServerSupabase } from '@/db/server';
import { env } from '@/env';
import { createRepoFromEnv } from '@/sync/context';
import { getViewer, supabaseConfigured } from './viewer';

export interface PushSubscriptionJson {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface PushActionResult {
  ok: boolean;
  error?: 'unauthorized' | 'failed' | 'invalid';
}

const ENDPOINT = /^https:\/\/[^\s]{10,2000}$/;

function valid(sub: PushSubscriptionJson | null | undefined): sub is PushSubscriptionJson {
  return !!sub && typeof sub.endpoint === 'string' && ENDPOINT.test(sub.endpoint) && !!sub.keys && typeof sub.keys.p256dh === 'string' && typeof sub.keys.auth === 'string' && sub.keys.p256dh.length > 10 && sub.keys.auth.length > 5;
}

/** Stores this device's Web Push subscription under the signed-in user (upsert by endpoint). */
export async function savePushSubscriptionAction(sub: PushSubscriptionJson, userAgent: string): Promise<PushActionResult> {
  const viewer = await getViewer();
  if (!viewer || !viewer.active) return { ok: false, error: 'unauthorized' };
  if (!valid(sub)) return { ok: false, error: 'invalid' };
  const row = { user_id: viewer.id, user_name: viewer.name, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, user_agent: String(userAgent ?? '').slice(0, 300) };
  if (supabaseConfigured()) {
    const db = await createServerSupabase();
    if (!db) return { ok: false, error: 'failed' };
    // the RPC moves the endpoint to the signed-in user (a shared device) and refreshes the keys
    const { data, error } = await db.rpc('save_push_subscription', { p_endpoint: row.endpoint, p_p256dh: row.p256dh, p_auth: row.auth, p_user_agent: row.user_agent });
    if (error) return { ok: false, error: error.code === '42501' ? 'unauthorized' : 'failed' };
    const res = (data ?? {}) as { ok?: boolean; status?: string };
    return res.ok === false ? { ok: false, error: 'invalid' } : { ok: true };
  }
  const repo = createRepoFromEnv(env()).repo as MemoryRepo;
  repo.pushSubscriptions ??= [];
  const i = repo.pushSubscriptions.findIndex((s) => s.endpoint === row.endpoint);
  const full = { id: `sub-${i < 0 ? repo.pushSubscriptions.length + 1 : i + 1}`, ...row, created_at: new Date().toISOString(), last_ok_at: null, failed_at: null };
  if (i < 0) repo.pushSubscriptions.push(full);
  else repo.pushSubscriptions[i] = full;
  return { ok: true };
}

/** Removes this device's subscription (notifications turned off on the device). */
export async function removePushSubscriptionAction(endpoint: string): Promise<PushActionResult> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, error: 'unauthorized' };
  if (typeof endpoint !== 'string' || !ENDPOINT.test(endpoint)) return { ok: false, error: 'invalid' };
  if (supabaseConfigured()) {
    const db = await createServerSupabase();
    if (!db) return { ok: false, error: 'failed' };
    const { error } = await db.rpc('remove_push_subscription', { p_endpoint: endpoint });
    if (error) return { ok: false, error: error.code === '42501' ? 'unauthorized' : 'failed' };
    return { ok: true };
  }
  const repo = createRepoFromEnv(env()).repo as MemoryRepo;
  repo.pushSubscriptions = (repo.pushSubscriptions ?? []).filter((s) => s.endpoint !== endpoint);
  return { ok: true };
}
