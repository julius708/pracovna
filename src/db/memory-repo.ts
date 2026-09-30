import { createMemoryTokenStore, type TokenStore } from '@/guesty/token';
import type { LifecyclePatch, ReservationFilter, RetentionResult, SyncRepo, WebhookEventInsert } from './repo';
import type {
  AppStateKey,
  CalendarRow,
  ListingRow,
  PackageComputed,
  PackageEventInsert,
  PackageEventRow,
  PackageRow,
  ReservationRow,
  SyncJob,
  SyncRunRow,
  WebhookEventRow,
  Ymd,
} from './types';

let seq = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

/**
 * In-memory SyncRepo for unit tests and local experiments. Mirrors the
 * behaviour of the Supabase implementation (freshness guard, unique keys,
 * staff columns untouched by computed updates).
 */
export class MemoryRepo implements SyncRepo {
  listings = new Map<string, ListingRow>();
  reservations = new Map<string, ReservationRow>();
  calendar = new Map<string, CalendarRow>();
  packages = new Map<string, PackageRow>();
  events: PackageEventRow[] = [];
  settings = new Map<string, unknown>();
  runs: SyncRunRow[] = [];
  state = new Map<string, unknown>();
  locks = new Map<string, { until: number; runId: string }>();
  webhookEvents: WebhookEventRow[] = [];
  readonly tokenStore: TokenStore = createMemoryTokenStore();
  now: () => Date = () => new Date();

  private nowIso() {
    return this.now().toISOString();
  }

  async upsertListings(rows: ListingRow[]) {
    for (const r of rows) this.listings.set(r.guesty_id, { ...r });
  }
  async getListings() {
    return [...this.listings.values()].map((r) => ({ ...r }));
  }
  async getListing(id: string) {
    const r = this.listings.get(id);
    return r ? { ...r } : null;
  }

  async upsertReservations(rows: ReservationRow[]) {
    for (const r of rows) {
      const cur = this.reservations.get(r.guesty_id);
      if (cur && cur.fetched_at > r.fetched_at) continue;
      this.reservations.set(r.guesty_id, { ...r, not_found_runs: cur?.not_found_runs ?? 0 });
    }
  }
  async getReservations(f: ReservationFilter) {
    return [...this.reservations.values()]
      .filter((r) => !f.checkOutGte || r.check_out_date >= f.checkOutGte)
      .filter((r) => !f.checkOutLte || r.check_out_date <= f.checkOutLte)
      .filter((r) => !f.checkInGte || r.check_in_date >= f.checkInGte)
      .filter((r) => !f.status || r.status === f.status)
      .filter((r) => !f.listingIds || f.listingIds.includes(r.listing_id) || f.listingIds.includes(r.arrival_listing_id))
      .map((r) => ({ ...r }));
  }
  async getReservationsByIds(ids: string[]) {
    return ids.map((id) => this.reservations.get(id)).filter((r): r is ReservationRow => !!r).map((r) => ({ ...r }));
  }
  async incrementNotFound(ids: string[]) {
    for (const id of ids) {
      const r = this.reservations.get(id);
      if (r) r.not_found_runs += 1;
    }
  }
  async resetNotFound(ids: string[]) {
    for (const id of ids) {
      const r = this.reservations.get(id);
      if (r) r.not_found_runs = 0;
    }
  }

  async upsertCalendar(rows: CalendarRow[]) {
    for (const r of rows) this.calendar.set(`${r.listing_id}|${r.date}`, { ...r });
  }
  async getCalendar(listingIds: string[], from: Ymd, to: Ymd) {
    const ids = new Set(listingIds);
    return [...this.calendar.values()].filter((c) => ids.has(c.listing_id) && c.date >= from && c.date <= to).map((c) => ({ ...c }));
  }

  async getPackagesInWindow(dates: Ymd[]) {
    const set = new Set(dates);
    return [...this.packages.values()].filter((p) => set.has(p.date)).map((p) => ({ ...p }));
  }
  async getPackagesByReservationIds(ids: string[]) {
    const set = new Set(ids);
    return [...this.packages.values()].filter((p) => set.has(p.outgoing_reservation_id)).map((p) => ({ ...p }));
  }
  async insertPackage(computed: PackageComputed) {
    for (const p of this.packages.values()) {
      if (p.outgoing_reservation_id === computed.outgoing_reservation_id) throw new Error('duplicate outgoing_reservation_id');
    }
    const ts = this.nowIso();
    const row: PackageRow = {
      ...computed,
      id: uuid(),
      status: 'todo',
      hidden: false,
      cancel_reason: null,
      cancelled_at: null,
      note: '',
      note_by: null,
      note_by_name: null,
      note_at: null,
      checklist: { items: [], checked: {} },
      packed_by: null,
      packed_by_name: null,
      packed_at: null,
      packed_hash: null,
      computed_at: ts,
      created_at: ts,
      updated_at: ts,
    };
    this.packages.set(row.id, row);
    return { ...row };
  }
  async updatePackageComputed(id: string, computed: PackageComputed) {
    const p = this.packages.get(id);
    if (!p) throw new Error(`package ${id} not found`);
    Object.assign(p, computed, { computed_at: this.nowIso(), updated_at: this.nowIso() });
  }
  async setPackageLifecycle(id: string, patch: LifecyclePatch) {
    const p = this.packages.get(id);
    if (!p) throw new Error(`package ${id} not found`);
    Object.assign(p, patch, { updated_at: this.nowIso() });
  }
  async insertEvents(events: PackageEventInsert[]) {
    for (const e of events) this.events.push({ ...e, id: this.events.length + 1, created_at: this.nowIso() });
  }

  async getSetting<T>(key: string) {
    return (this.settings.get(key) as T | undefined) ?? null;
  }

  async startRun(job: SyncJob, trigger: string) {
    const row: SyncRunRow = {
      id: this.runs.length + 1,
      job,
      trigger,
      started_at: this.nowIso(),
      finished_at: null,
      ok: null,
      partial: [],
      error: null,
      guesty_calls: 0,
      stats: {},
    };
    this.runs.push(row);
    return row.id;
  }
  async finishRun(id: number, patch: Partial<Pick<SyncRunRow, 'ok' | 'partial' | 'error' | 'guesty_calls' | 'stats'>>) {
    const r = this.runs.find((x) => x.id === id);
    if (r) Object.assign(r, patch, { finished_at: this.nowIso() });
  }
  async getRecentRuns(job: SyncJob, limit: number) {
    return this.runs
      .filter((r) => r.job === job)
      .slice(-limit)
      .reverse()
      .map((r) => ({ ...r }));
  }
  async getState<T>(key: AppStateKey) {
    return (this.state.get(key) as T | undefined) ?? null;
  }
  async setState(key: AppStateKey, value: unknown) {
    this.state.set(key, value);
  }
  async acquireLock(name: string, ttlSeconds: number, runId: string) {
    const t = this.now().getTime();
    const cur = this.locks.get(name);
    if (cur && cur.until > t && cur.runId !== runId) return false;
    this.locks.set(name, { until: t + ttlSeconds * 1000, runId });
    return true;
  }
  async releaseLock(name: string, runId: string) {
    const cur = this.locks.get(name);
    if (cur && cur.runId === runId) this.locks.delete(name);
  }

  async insertWebhookEvent(row: WebhookEventInsert) {
    const dup = this.webhookEvents.find(
      (e) => (row.svix_id && e.svix_id === row.svix_id) || (row.event_id && e.event_id === row.event_id),
    );
    if (dup) return { id: dup.id, duplicate: true };
    const e: WebhookEventRow = {
      id: this.webhookEvents.length + 1,
      svix_id: row.svix_id,
      event_id: row.event_id,
      event: row.event,
      object_id: row.object_id,
      received_at: this.nowIso(),
      processed_at: null,
      status: row.status,
      attempts: 0,
      error: row.error ?? null,
      payload: row.payload,
    };
    this.webhookEvents.push(e);
    return { id: e.id, duplicate: false };
  }
  async getWebhookEvent(id: number) {
    const e = this.webhookEvents.find((x) => x.id === id);
    return e ? { ...e } : null;
  }
  async updateWebhookEvent(id: number, patch: Partial<WebhookEventRow>) {
    const e = this.webhookEvents.find((x) => x.id === id);
    if (e) Object.assign(e, patch);
  }
  async getWebhookEventsToRetry(olderThanSeconds: number, maxAttempts: number) {
    const cutoff = this.now().getTime() - olderThanSeconds * 1000;
    return this.webhookEvents
      .filter((e) => (e.status === 'received' || e.status === 'failed') && e.attempts < maxAttempts && Date.parse(e.received_at) < cutoff)
      .map((e) => ({ ...e }));
  }

  async runRetention(now: Date): Promise<RetentionResult> {
    const days = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString();
    const before = { runs: this.runs.length, wh: this.webhookEvents.length, cal: this.calendar.size, res: this.reservations.size };
    this.runs = this.runs.filter((r) => r.started_at > days(r.ok === false ? 90 : 30));
    this.webhookEvents = this.webhookEvents.filter((e) => e.received_at > days(90));
    for (const e of this.webhookEvents) if (e.received_at < days(30)) e.payload = null;
    const yesterday = days(1).slice(0, 10);
    for (const [k, c] of this.calendar) if (c.date < yesterday) this.calendar.delete(k);
    const referenced = new Set([...this.packages.values()].flatMap((p) => [p.outgoing_reservation_id, p.incoming_reservation_id ?? '']));
    for (const [k, r] of this.reservations) if (r.check_out_date < days(60).slice(0, 10) && !referenced.has(k)) this.reservations.delete(k);
    return {
      sync_runs: before.runs - this.runs.length,
      webhook_events: before.wh - this.webhookEvents.length,
      calendar: before.cal - this.calendar.size,
      reservations: before.res - this.reservations.size,
    };
  }
}
