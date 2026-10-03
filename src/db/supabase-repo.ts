import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { TokenStore } from '@/guesty/token';
import { createRetryingFetch } from './fetch-retry';
import type { LifecyclePatch, ReservationFilter, RetentionResult, SyncRepo, WebhookEventInsert } from './repo';
import type {
  AppStateKey,
  CalendarRow,
  ListingRow,
  PackageComputed,
  PackageEventInsert,
  PackageRow,
  ReservationRow,
  SyncJob,
  SyncRunRow,
  WebhookEventRow,
  Ymd,
} from './types';

/** Service-role client: server only, bypasses RLS. Never import from client components. */
export function createAdminClient(url: string, serviceRoleKey: string): SupabaseClient {
  return createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: createRetryingFetch() } });
}

function must<T>(r: { data: T | null; error: { message: string } | null }, what: string): T {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data as T;
}

/** Last occurrence wins, so a fresher row later in the batch replaces an earlier one. */
function dedupe<T>(rows: T[], key: (r: T) => string): T[] {
  const map = new Map<string, T>();
  for (const r of rows) map.set(key(r), r);
  return [...map.values()];
}

function chunks<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

class SupabaseTokenStore implements TokenStore {
  constructor(private readonly db: SupabaseClient) {}
  async read() {
    const row = must(await this.db.from('guesty_tokens').select('*').eq('id', 1).maybeSingle(), 'guesty_tokens.read') as
      | { access_token: string | null; expires_at: string | null; mints: string[] | null; lease_until: string | null }
      | null;
    return {
      accessToken: row?.access_token ?? null,
      expiresAt: row?.expires_at ?? null,
      mints: row?.mints ?? [],
      leaseUntil: row?.lease_until ?? null,
    };
  }
  async tryLease(untilIso: string, nowIso: string) {
    const r = await this.db
      .from('guesty_tokens')
      .update({ lease_until: untilIso })
      .eq('id', 1)
      .or(`lease_until.is.null,lease_until.lt.${nowIso}`)
      .select('id');
    must(r, 'guesty_tokens.lease');
    return (r.data?.length ?? 0) > 0;
  }
  async releaseLease() {
    must(await this.db.from('guesty_tokens').update({ lease_until: null }).eq('id', 1), 'guesty_tokens.release');
  }
  async save(rec: { accessToken: string; expiresAt: string; mintedAt: string }) {
    const cur = await this.read();
    const since = Date.now() - 48 * 3_600_000;
    const mints = [...cur.mints.filter((m) => Date.parse(m) > since), rec.mintedAt];
    must(
      await this.db
        .from('guesty_tokens')
        .upsert({ id: 1, access_token: rec.accessToken, expires_at: rec.expiresAt, obtained_at: rec.mintedAt, mints }),
      'guesty_tokens.save',
    );
  }
}

/** SyncRepo over Supabase with the service role. Package writes go through the sync RPCs. */
export class SupabaseRepo implements SyncRepo {
  readonly tokenStore: TokenStore;
  constructor(private readonly db: SupabaseClient) {
    this.tokenStore = new SupabaseTokenStore(db);
  }

  async upsertListings(rows: ListingRow[]) {
    const unique = dedupe(rows, (r) => r.guesty_id);
    for (const part of chunks(unique, 200)) must(await this.db.from('listings').upsert(part, { onConflict: 'guesty_id' }), 'listings.upsert');
  }
  async getListings() {
    return must(await this.db.from('listings').select('*'), 'listings.select') as ListingRow[];
  }
  async getListing(id: string) {
    return (must(await this.db.from('listings').select('*').eq('guesty_id', id).maybeSingle(), 'listings.get') as ListingRow | null) ?? null;
  }

  async upsertReservations(rows: ReservationRow[]) {
    if (!rows.length) return;
    // freshness guard: keep the fresher fetch
    const ids = rows.map((r) => r.guesty_id);
    const existing = new Map<string, { guesty_id: string; fetched_at: string; not_found_runs: number }>();
    for (const part of chunks(ids, 200)) {
      const cur = must(await this.db.from('reservations').select('guesty_id, fetched_at, not_found_runs').in('guesty_id', part), 'reservations.select');
      for (const r of cur as { guesty_id: string; fetched_at: string; not_found_runs: number }[]) existing.set(r.guesty_id, r);
    }
    const fresh = dedupe(rows, (r) => r.guesty_id)
      .filter((r) => {
        const cur = existing.get(r.guesty_id);
        return !cur || Date.parse(cur.fetched_at) <= Date.parse(r.fetched_at);
      })
      .map((r) => ({ ...r, not_found_runs: existing.get(r.guesty_id)?.not_found_runs ?? r.not_found_runs ?? 0 }));
    for (const part of chunks(fresh, 200)) must(await this.db.from('reservations').upsert(part, { onConflict: 'guesty_id' }), 'reservations.upsert');
  }
  async getReservations(f: ReservationFilter) {
    const base = () => {
      let q = this.db.from('reservations').select('*');
      if (f.checkOutGte) q = q.gte('check_out_date', f.checkOutGte);
      if (f.checkOutLte) q = q.lte('check_out_date', f.checkOutLte);
      if (f.checkInGte) q = q.gte('check_in_date', f.checkInGte);
      if (f.status) q = q.eq('status', f.status);
      return q;
    };
    if (!f.listingIds) return must(await base(), 'reservations.filter') as ReservationRow[];
    if (!f.listingIds.length) return [];
    // the ids travel in the request URL, twice; a week of check-outs names nearly every flat,
    // so query in chunks to stay far below the 8 KB request line (review of the week view)
    const out: ReservationRow[] = [];
    for (const part of chunks(f.listingIds, 50)) {
      const list = part.map((id) => `"${id.replace(/"/g, '')}"`).join(',');
      out.push(...(must(await base().or(`listing_id.in.(${list}),arrival_listing_id.in.(${list})`), 'reservations.filter') as ReservationRow[]));
    }
    return dedupe(out, (r) => r.guesty_id);
  }
  async getReservationsByIds(ids: string[]) {
    const out: ReservationRow[] = [];
    for (const part of chunks(ids, 200)) out.push(...(must(await this.db.from('reservations').select('*').in('guesty_id', part), 'reservations.byIds') as ReservationRow[]));
    return out;
  }
  async incrementNotFound(ids: string[]) {
    for (const id of ids) must(await this.db.rpc('increment_not_found', { p_id: id }), 'reservations.not_found');
  }
  async resetNotFound(ids: string[]) {
    if (ids.length) must(await this.db.from('reservations').update({ not_found_runs: 0 }).in('guesty_id', ids), 'reservations.reset_not_found');
  }

  async upsertCalendar(rows: CalendarRow[]) {
    const unique = dedupe(rows, (r) => `${r.listing_id}|${r.date}`);
    for (const part of chunks(unique, 500)) must(await this.db.from('calendar_min_nights').upsert(part, { onConflict: 'listing_id,date' }), 'calendar.upsert');
  }
  async getCalendar(listingIds: string[], from: Ymd, to: Ymd) {
    if (!listingIds.length) return [];
    return must(
      await this.db.from('calendar_min_nights').select('*').in('listing_id', listingIds).gte('date', from).lte('date', to),
      'calendar.select',
    ) as CalendarRow[];
  }

  async getPackagesInWindow(dates: Ymd[]) {
    return must(await this.db.from('packages').select('*').in('date', dates), 'packages.window') as PackageRow[];
  }
  async getPackagesByReservationIds(ids: string[]) {
    const out: PackageRow[] = [];
    for (const part of chunks(ids, 200)) out.push(...(must(await this.db.from('packages').select('*').in('outgoing_reservation_id', part), 'packages.byRes') as PackageRow[]));
    return out;
  }
  async insertPackage(computed: PackageComputed) {
    return must(await this.db.rpc('sync_upsert_package', { p: computed }), 'packages.insert') as PackageRow;
  }
  async updatePackageComputed(_id: string, computed: PackageComputed) {
    must(await this.db.rpc('sync_upsert_package', { p: computed }), 'packages.update');
  }
  async setPackageLifecycle(id: string, patch: LifecyclePatch) {
    must(
      await this.db.rpc('sync_set_lifecycle', {
        p_id: id,
        p_status: patch.status ?? null,
        p_hidden: patch.hidden ?? null,
        p_reason: patch.cancel_reason ?? null,
      }),
      'packages.lifecycle',
    );
  }
  async insertEvents(events: PackageEventInsert[]) {
    for (const part of chunks(events, 200)) must(await this.db.from('package_events').insert(part), 'package_events.insert');
  }

  async getSetting<T>(key: string) {
    const row = must(await this.db.from('settings').select('value').eq('key', key).maybeSingle(), 'settings.get') as { value: T } | null;
    return row?.value ?? null;
  }

  async startRun(job: SyncJob, trigger: string) {
    const row = must(await this.db.from('sync_runs').insert({ job, trigger }).select('id').single(), 'sync_runs.insert') as { id: number };
    return row.id;
  }
  async finishRun(id: number, patch: Partial<Pick<SyncRunRow, 'ok' | 'partial' | 'error' | 'guesty_calls' | 'stats'>>) {
    must(await this.db.from('sync_runs').update({ ...patch, finished_at: new Date().toISOString() }).eq('id', id), 'sync_runs.update');
  }
  async getRecentRuns(job: SyncJob, limit: number) {
    return must(await this.db.from('sync_runs').select('*').eq('job', job).order('started_at', { ascending: false }).limit(limit), 'sync_runs.recent') as SyncRunRow[];
  }
  async getState<T>(key: AppStateKey) {
    const row = must(await this.db.from('app_state').select('value').eq('key', key).maybeSingle(), 'app_state.get') as { value: T } | null;
    return row?.value ?? null;
  }
  async setState(key: AppStateKey, value: unknown) {
    if (value === null || value === undefined) {
      must(await this.db.from('app_state').delete().eq('key', key), 'app_state.delete');
      return;
    }
    must(await this.db.from('app_state').upsert({ key, value: value as never, updated_at: new Date().toISOString() }), 'app_state.set');
  }
  async acquireLock(name: string, ttlSeconds: number, runId: string) {
    const r = await this.db.rpc('acquire_lock', { p_name: name, p_ttl_seconds: ttlSeconds, p_run_id: runId });
    return must(r, 'locks.acquire') as boolean;
  }
  async releaseLock(name: string, runId: string) {
    must(await this.db.from('sync_locks').delete().eq('name', name).eq('run_id', runId), 'locks.release');
  }

  async insertWebhookEvent(row: WebhookEventInsert) {
    if (row.svix_id || row.event_id) {
      let q = this.db.from('webhook_events').select('id');
      q = row.svix_id && row.event_id ? q.or(`svix_id.eq.${row.svix_id},event_id.eq.${row.event_id}`) : row.svix_id ? q.eq('svix_id', row.svix_id) : q.eq('event_id', row.event_id!);
      const dup = must(await q.limit(1), 'webhook_events.dup') as { id: number }[];
      if (dup.length) return { id: dup[0].id, duplicate: true };
    }
    const ins = must(await this.db.from('webhook_events').insert({ ...row, error: row.error ?? null }).select('id').single(), 'webhook_events.insert') as { id: number };
    return { id: ins.id, duplicate: false };
  }
  async getWebhookEvent(id: number) {
    return (must(await this.db.from('webhook_events').select('*').eq('id', id).maybeSingle(), 'webhook_events.get') as WebhookEventRow | null) ?? null;
  }
  async updateWebhookEvent(id: number, patch: Partial<WebhookEventRow>) {
    must(await this.db.from('webhook_events').update(patch).eq('id', id), 'webhook_events.update');
  }
  async getWebhookEventsToRetry(olderThanSeconds: number, maxAttempts: number) {
    const cutoff = new Date(Date.now() - olderThanSeconds * 1000).toISOString();
    return must(
      await this.db.from('webhook_events').select('*').in('status', ['received', 'failed']).lt('attempts', maxAttempts).lt('received_at', cutoff).limit(20),
      'webhook_events.retry',
    ) as WebhookEventRow[];
  }

  async runRetention(now: Date): Promise<RetentionResult> {
    const r = await this.db.rpc('run_retention', { p_now: now.toISOString() });
    return must(r, 'retention') as RetentionResult;
  }
}
