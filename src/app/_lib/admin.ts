import 'server-only';
import { DEFAULT_SETTINGS, mergeSettings, type PackingSettings } from '@/core/packing';
import type { MemoryRepo } from '@/db/memory-repo';
import type { DuvetTypes } from '@/db/repo';
import { createServerSupabase } from '@/db/server';
import type { PackageEventRow, ProfileRow, SyncRunRow, WebhookEventRow } from '@/db/types';
import { env } from '@/env';
import { createRepoFromEnv } from '@/sync/context';
import { DEV_VIEWERS, supabaseConfigured } from './viewer';

async function db() {
  const c = await createServerSupabase();
  if (!c) throw new Error('Supabase client unavailable');
  return c;
}

function memory(): MemoryRepo {
  return createRepoFromEnv(env()).repo as MemoryRepo;
}

/* ---------------- settings ---------------- */

export interface ListingSummary {
  id: string;
  name: string;
  inScope: boolean;
  reason: string | null;
  /** What the Guesty field says about duvets, for the hint next to the dropdown. */
  guestyDuvets: 'exact' | 'male' | 'velke' | null;
  hasLaundryField: boolean;
}

export interface SettingsView {
  linen: PackingSettings;
  linenVersion: number;
  duvetTypes: DuvetTypes;
  duvetVersion: number;
  listings: ListingSummary[];
  profiles: ProfileRow[];
}

function summarise(l: { guesty_id: string; name: string; in_scope: boolean; exclusion_reason: string | null; laundry: { duvetCounts?: unknown; duvetType?: string | null } | null; laundry_raw: string | null }): ListingSummary {
  const g = l.laundry?.duvetCounts ? 'exact' : l.laundry?.duvetType === 'male' ? 'male' : l.laundry?.duvetType === 'velke' ? 'velke' : null;
  return { id: l.guesty_id, name: l.name, inScope: l.in_scope, reason: l.exclusion_reason, guestyDuvets: g, hasLaundryField: !!l.laundry_raw };
}

export async function loadSettingsView(): Promise<SettingsView> {
  if (supabaseConfigured()) {
    const c = await db();
    const [settings, listings, profiles] = await Promise.all([
      c.from('settings').select('key, value, version'),
      c.from('listings').select('guesty_id, name, in_scope, exclusion_reason, laundry, laundry_raw').order('name'),
      c.from('profiles').select('*').order('display_name'),
    ]);
    const rows = (settings.data ?? []) as { key: string; value: unknown; version: number }[];
    const linen = rows.find((r) => r.key === 'linen_table');
    const duvets = rows.find((r) => r.key === 'duvet_types');
    return {
      linen: mergeSettings((linen?.value as Partial<PackingSettings>) ?? null),
      linenVersion: linen?.version ?? 0,
      duvetTypes: (duvets?.value as DuvetTypes) ?? {},
      duvetVersion: duvets?.version ?? 0,
      listings: ((listings.data ?? []) as Parameters<typeof summarise>[0][]).map(summarise).sort((a, b) => a.name.localeCompare(b.name, 'sk')),
      profiles: (profiles.data ?? []) as ProfileRow[],
    };
  }
  const repo = memory();
  const linen = (repo.settings.get('linen_table') as Partial<PackingSettings> | undefined) ?? null;
  return {
    linen: mergeSettings(linen ?? DEFAULT_SETTINGS),
    linenVersion: linen ? 1 : 0,
    duvetTypes: (repo.settings.get('duvet_types') as DuvetTypes | undefined) ?? {},
    duvetVersion: 0,
    listings: (await repo.getListings()).map(summarise).sort((a, b) => a.name.localeCompare(b.name, 'sk')),
    profiles: Object.values(DEV_VIEWERS).map((v) => ({ id: v.id, display_name: v.name, role: v.role, active: v.active, created_at: new Date(0).toISOString() })),
  };
}

/* ---------------- história ---------------- */

export interface HistoryFilter {
  from: string;
  to: string;
  listingId?: string;
  actor?: string;
  event?: string;
  page: number;
}

export const HISTORY_PAGE = 100;

export interface HistoryView {
  rows: PackageEventRow[];
  listings: { id: string; name: string }[];
  actors: string[];
  hasMore: boolean;
}

export async function loadHistory(f: HistoryFilter): Promise<HistoryView> {
  const fromIso = `${f.from}T00:00:00+02:00`;
  const toIso = `${f.to}T23:59:59.999+02:00`;
  const offset = Math.max(0, f.page - 1) * HISTORY_PAGE;
  if (supabaseConfigured()) {
    const c = await db();
    let q = c.from('package_events').select('*').gte('created_at', fromIso).lte('created_at', toIso).order('created_at', { ascending: false }).range(offset, offset + HISTORY_PAGE);
    if (f.listingId) q = q.eq('listing_id', f.listingId);
    if (f.actor) q = q.eq('actor_name', f.actor);
    if (f.event) q = q.eq('event', f.event);
    const [ev, ls, pr] = await Promise.all([q, c.from('listings').select('guesty_id, name').eq('in_scope', true).order('name'), c.from('profiles').select('display_name').order('display_name')]);
    const rows = (ev.data ?? []) as PackageEventRow[];
    return {
      rows: rows.slice(0, HISTORY_PAGE),
      listings: ((ls.data ?? []) as { guesty_id: string; name: string }[]).map((l) => ({ id: l.guesty_id, name: l.name })),
      actors: ((pr.data ?? []) as { display_name: string }[]).map((p) => p.display_name),
      hasMore: rows.length > HISTORY_PAGE,
    };
  }
  const repo = memory();
  const all = repo.events
    .filter((e) => e.created_at >= new Date(fromIso).toISOString() && e.created_at <= new Date(toIso).toISOString())
    .filter((e) => !f.listingId || e.listing_id === f.listingId)
    .filter((e) => !f.actor || e.actor_name === f.actor)
    .filter((e) => !f.event || e.event === f.event)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return {
    rows: all.slice(offset, offset + HISTORY_PAGE),
    listings: (await repo.getListings()).filter((l) => l.in_scope).map((l) => ({ id: l.guesty_id, name: l.name })).sort((a, b) => a.name.localeCompare(b.name, 'sk')),
    actors: [...new Set(repo.events.map((e) => e.actor_name))].sort(),
    hasMore: all.length > offset + HISTORY_PAGE,
  };
}

/* ---------------- stav ---------------- */

export interface StatusView {
  state: Record<string, unknown>;
  runs: SyncRunRow[];
  webhookEvents: WebhookEventRow[];
  issues: {
    minNightsUnknown: string[];
    bedsInsufficient: string[];
    noLaundryField: string[];
    bathroomsMissing: string[];
    multiStay: string[];
  };
  token: { expiresAt: string | null; mints24h: number };
  packagesInWindow: number;
}

export async function loadStatus(): Promise<StatusView> {
  const keys = ['last_ok_sync_at', 'consecutive_failures', 'partial_runs', 'listings_synced_at', 'last_webhook_at', 'alert_state', 'listing_drop', 'webhook_registration', 'listing_filter_supported', 'token_quota_warning'];
  const issues = { minNightsUnknown: [] as string[], bedsInsufficient: [] as string[], noLaundryField: [] as string[], bathroomsMissing: [] as string[], multiStay: [] as string[] };
  const collect = (packages: { listing_name: string; warnings: string[] }[], listings: { name: string; in_scope: boolean; laundry_raw: string | null }[]) => {
    for (const p of packages) {
      if (p.warnings.includes('min_nights_unknown')) issues.minNightsUnknown.push(p.listing_name);
      if (p.warnings.includes('beds_insufficient')) issues.bedsInsufficient.push(p.listing_name);
      if (p.warnings.includes('bathrooms_missing')) issues.bathroomsMissing.push(p.listing_name);
      if (p.warnings.includes('multi_stay')) issues.multiStay.push(p.listing_name);
    }
    for (const l of listings) if (l.in_scope && !l.laundry_raw) issues.noLaundryField.push(l.name);
    for (const k of Object.keys(issues) as (keyof typeof issues)[]) issues[k] = [...new Set(issues[k])].sort((a, b) => a.localeCompare(b, 'sk'));
  };
  if (supabaseConfigured()) {
    const c = await db();
    const [st, runs, wh, pk, ls, tk] = await Promise.all([
      c.from('app_state').select('key, value').in('key', keys),
      c.from('sync_runs').select('*').order('started_at', { ascending: false }).limit(50),
      c.from('webhook_events').select('id, svix_id, event_id, event, object_id, received_at, processed_at, status, attempts, error').order('received_at', { ascending: false }).limit(100),
      c.from('packages').select('listing_name, warnings, status').eq('hidden', false),
      c.from('listings').select('name, in_scope, laundry_raw'),
      c.from('guesty_tokens').select('expires_at, mints').eq('id', 1).maybeSingle(),
    ]);
    const state: Record<string, unknown> = {};
    for (const r of (st.data ?? []) as { key: string; value: unknown }[]) state[r.key] = r.value;
    const packages = (pk.data ?? []) as { listing_name: string; warnings: string[]; status: string }[];
    collect(packages, (ls.data ?? []) as { name: string; in_scope: boolean; laundry_raw: string | null }[]);
    const token = (tk.data ?? null) as { expires_at: string | null; mints: string[] } | null;
    return {
      state,
      runs: (runs.data ?? []) as SyncRunRow[],
      webhookEvents: (wh.data ?? []) as WebhookEventRow[],
      issues,
      token: { expiresAt: token?.expires_at ?? null, mints24h: (token?.mints ?? []).filter((m) => Date.parse(m) > Date.now() - 24 * 3_600_000).length },
      packagesInWindow: packages.filter((p) => p.status !== 'cancelled').length,
    };
  }
  const repo = memory();
  const state: Record<string, unknown> = {};
  for (const k of keys) state[k] = repo.state.get(k) ?? null;
  const packages = [...repo.packages.values()].filter((p) => !p.hidden);
  collect(packages, await repo.getListings());
  const token = await repo.tokenStore.read();
  return {
    state,
    runs: [...repo.runs].reverse().slice(0, 50),
    webhookEvents: [...repo.webhookEvents].reverse().slice(0, 100),
    issues,
    token: { expiresAt: token.expiresAt, mints24h: token.mints.filter((m) => Date.parse(m) > Date.now() - 24 * 3_600_000).length },
    packagesInWindow: packages.filter((p) => p.status !== 'cancelled').length,
  };
}
