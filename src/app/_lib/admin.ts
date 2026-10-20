import 'server-only';
import { addDays, DEFAULT_SETTINGS, mergeSettings, todayInTz, windowDates, zonedMidnight, type PackingResult, type PackingSettings } from '@/core/packing';
import type { MemoryRepo } from '@/db/memory-repo';
import type { DuvetTypes } from '@/db/repo';
import { createServerSupabase } from '@/db/server';
import type { PackageEventRow, PackageStatus, ProfileRow, SyncRunRow, WebhookEventRow } from '@/db/types';
import { env } from '@/env';
import { createRepoFromEnv } from '@/sync/context';
import { HISTORY_PAGE, type HistoryFilter } from './history-filter';
import { hasSnapshot, isSuperseded, snapshotOf, type PackingDayNote, type PackingLogRow } from './packing-log';
import { DEV_VIEWERS, supabaseConfigured } from './viewer';

export { HISTORY_PAGE, type HistoryFilter } from './history-filter';

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

/** Actor names the sync writes into package_events (recompute triggers), offered in the "Osoba" filter next to the staff. */
export const AUTOMATED_ACTORS = ['sync', 'webhook', 'nightly', 'manual', 'settings'] as const;

export interface HistoryView {
  rows: PackageEventRow[];
  listings: { id: string; name: string }[];
  actors: string[];
  hasMore: boolean;
}

export async function loadHistory(f: HistoryFilter): Promise<HistoryView> {
  // Bratislava calendar days: from local midnight of `from` up to (not including) local midnight after `to`
  const fromIso = zonedMidnight(f.from).toISOString();
  const toIso = zonedMidnight(addDays(f.to, 1)).toISOString();
  const offset = Math.max(0, f.page - 1) * HISTORY_PAGE;
  if (supabaseConfigured()) {
    const c = await db();
    let q = c.from('package_events').select('*').gte('created_at', fromIso).lt('created_at', toIso).order('created_at', { ascending: false }).range(offset, offset + HISTORY_PAGE);
    if (f.listingId) q = q.eq('listing_id', f.listingId);
    if (f.actor) q = q.eq('actor_name', f.actor);
    if (f.event) q = q.eq('event', f.event);
    const [ev, ls, pr] = await Promise.all([q, c.from('listings').select('guesty_id, name').eq('in_scope', true).order('name'), c.from('profiles').select('display_name').order('display_name')]);
    if (ev.error) throw new Error(`package_events: ${ev.error.message}`);
    const rows = (ev.data ?? []) as PackageEventRow[];
    const people = ((pr.data ?? []) as { display_name: string }[]).map((p) => p.display_name);
    return {
      rows: rows.slice(0, HISTORY_PAGE),
      listings: ((ls.data ?? []) as { guesty_id: string; name: string }[]).map((l) => ({ id: l.guesty_id, name: l.name })),
      actors: [...new Set([...people, ...AUTOMATED_ACTORS])],
      hasMore: rows.length > HISTORY_PAGE,
    };
  }
  const repo = memory();
  const all = repo.events
    .filter((e) => e.created_at >= fromIso && e.created_at < toIso)
    .filter((e) => !f.listingId || e.listing_id === f.listingId)
    .filter((e) => !f.actor || e.actor_name === f.actor)
    .filter((e) => !f.event || e.event === f.event)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return {
    rows: all.slice(offset, offset + HISTORY_PAGE),
    listings: (await repo.getListings()).filter((l) => l.in_scope).map((l) => ({ id: l.guesty_id, name: l.name })).sort((a, b) => a.name.localeCompare(b.name, 'sk')),
    actors: [...new Set([...Object.values(DEV_VIEWERS).map((v) => v.name), ...repo.events.map((e) => e.actor_name), ...AUTOMATED_ACTORS])],
    hasMore: all.length > offset + HISTORY_PAGE,
  };
}

/* ---------------- história balenia ---------------- */

export interface PackingLogView {
  rows: PackingLogRow[];
  /** "Dôležité info" of the packing days on this page, oldest first per day. */
  dayNotes: Record<string, PackingDayNote[]>;
  listings: { id: string; name: string }[];
  actors: string[];
  hasMore: boolean;
}

/**
 * "Zabalené balíčky": the packed events of the packing days in the filter,
 * newest day first, with the counts as packed (the event snapshot, or the
 * package's current counts for events from before migration 0011).
 */
export async function loadPackingLog(f: HistoryFilter): Promise<PackingLogView> {
  const offset = Math.max(0, f.page - 1) * HISTORY_PAGE;
  if (supabaseConfigured()) {
    const c = await db();
    let q = c
      .from('package_events')
      .select('*, packages(status, target_people, computed_items, packed_at, note, note_by_name)')
      .eq('event', 'packed')
      .gte('package_date', f.from)
      .lte('package_date', f.to)
      .order('package_date', { ascending: false })
      .order('created_at', { ascending: false })
      .range(offset, offset + HISTORY_PAGE);
    if (f.listingId) q = q.eq('listing_id', f.listingId);
    if (f.actor) q = q.eq('actor_name', f.actor);
    const [ev, ls, pr] = await Promise.all([q, c.from('listings').select('guesty_id, name').eq('in_scope', true).order('name'), c.from('profiles').select('display_name').order('display_name')]);
    if (ev.error) throw new Error(`package_events: ${ev.error.message}`);
    type Joined = PackageEventRow & { packages: { status: PackageStatus; target_people: number; computed_items: PackingResult; packed_at: string | null; note: string | null; note_by_name: string | null } | null };
    const rows = ((ev.data ?? []) as unknown as Joined[]).slice(0, HISTORY_PAGE).map((e) => ({
      id: e.id,
      package_id: e.package_id,
      package_date: String(e.package_date).slice(0, 10),
      listing_id: e.listing_id,
      listing_name: e.listing_name,
      actor_name: e.actor_name,
      created_at: e.created_at,
      snapshot: snapshotOf(e.data, e.packages),
      exact: hasSnapshot(e.data),
      status: e.packages?.status ?? null,
      superseded: e.packages?.status === 'packed' && isSuperseded(e.created_at, e.packages.packed_at),
      note: e.packages?.note ?? '',
      note_by_name: e.packages?.note_by_name ?? null,
    }));
    const days = [...new Set(rows.map((r) => r.package_date))];
    const dayNotes: Record<string, PackingDayNote[]> = {};
    if (days.length) {
      const nt = await c.from('board_notes').select('id, text, date, author_name, created_at, parent_id').in('date', days).is('removed_at', null).order('created_at');
      if (nt.error) throw new Error(`board_notes: ${nt.error.message}`);
      for (const n of (nt.data ?? []) as (PackingDayNote & { date: string })[]) {
        const d = String(n.date).slice(0, 10);
        (dayNotes[d] ??= []).push({ id: n.id, text: n.text, author_name: n.author_name, created_at: n.created_at, parent_id: n.parent_id ?? null });
      }
    }
    return {
      rows,
      dayNotes,
      listings: ((ls.data ?? []) as { guesty_id: string; name: string }[]).map((l) => ({ id: l.guesty_id, name: l.name })),
      actors: ((pr.data ?? []) as { display_name: string }[]).map((p) => p.display_name),
      hasMore: (ev.data ?? []).length > HISTORY_PAGE,
    };
  }
  const repo = memory();
  const all = repo.events
    .filter((e) => e.event === 'packed' && e.package_date >= f.from && e.package_date <= f.to)
    .filter((e) => !f.listingId || e.listing_id === f.listingId)
    .filter((e) => !f.actor || e.actor_name === f.actor)
    .sort((a, b) => b.package_date.localeCompare(a.package_date) || b.created_at.localeCompare(a.created_at));
  const rows = all.slice(offset, offset + HISTORY_PAGE).map((e) => {
    const p = repo.packages.get(e.package_id) ?? null;
    return {
      id: e.id,
      package_id: e.package_id,
      package_date: e.package_date,
      listing_id: e.listing_id,
      listing_name: e.listing_name,
      actor_name: e.actor_name,
      created_at: e.created_at,
      snapshot: snapshotOf(e.data, p),
      exact: hasSnapshot(e.data),
      status: p?.status ?? null,
      superseded: p?.status === 'packed' && isSuperseded(e.created_at, p.packed_at),
      note: p?.note ?? '',
      note_by_name: p?.note_by_name ?? null,
    };
  });
  const days = new Set(rows.map((r) => r.package_date));
  const dayNotes: Record<string, PackingDayNote[]> = {};
  for (const n of [...(repo.boardNotes ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    if (n.removed_at || !days.has(n.date)) continue;
    (dayNotes[n.date] ??= []).push({ id: n.id, text: n.text, author_name: n.author_name, created_at: n.created_at, parent_id: n.parent_id ?? null });
  }
  return {
    rows,
    dayNotes,
    listings: (await repo.getListings()).filter((l) => l.in_scope).map((l) => ({ id: l.guesty_id, name: l.name })).sort((a, b) => a.name.localeCompare(b.name, 'sk')),
    actors: [...new Set([...Object.values(DEV_VIEWERS).map((v) => v.name), ...repo.events.filter((e) => e.event === 'packed').map((e) => e.actor_name)])],
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
  /** Active packages of the board window (what the board shows). */
  packagesInWindow: number;
  /** ISO instant the data was read on the server; the client renders relative times from it first. */
  loadedAt: string;
}

export async function loadStatus(): Promise<StatusView> {
  const loadedAt = new Date().toISOString();
  const dates = windowDates(todayInTz(new Date()));
  const keys =['last_ok_sync_at', 'consecutive_failures', 'partial_runs', 'listings_synced_at', 'last_webhook_at', 'alert_state', 'listing_drop', 'webhook_registration', 'listing_filter_supported', 'token_quota_warning'];
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
      c.from('packages').select('listing_name, warnings, status').eq('hidden', false).in('date', dates),
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
      loadedAt,
    };
  }
  const repo = memory();
  const state: Record<string, unknown> = {};
  for (const k of keys) state[k] = repo.state.get(k) ?? null;
  const packages = [...repo.packages.values()].filter((p) => !p.hidden && dates.includes(p.date));
  collect(packages, await repo.getListings());
  const token = await repo.tokenStore.read();
  return {
    state,
    runs: [...repo.runs].reverse().slice(0, 50),
    webhookEvents: [...repo.webhookEvents].reverse().slice(0, 100),
    issues,
    token: { expiresAt: token.expiresAt, mints24h: token.mints.filter((m) => Date.parse(m) > Date.now() - 24 * 3_600_000).length },
    packagesInWindow: packages.filter((p) => p.status !== 'cancelled').length,
    loadedAt,
  };
}
