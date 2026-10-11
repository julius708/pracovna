import type { PackingSettings } from '@/core/packing';
import type { TokenStore } from '@/guesty/token';
import type {
  AppStateKey,
  CalendarRow,
  ListingRow,
  PackageComputed,
  PackageEventInsert,
  PackageRow,
  PackageStatus,
  ReservationRow,
  SyncJob,
  SyncRunRow,
  WebhookEventRow,
  WebhookEventStatus,
  Ymd, EarlyArrivalInsert, EarlyArrivalRow, PushSubscriptionRow } from './types';

export interface ReservationFilter {
  checkOutGte?: Ymd;
  checkOutLte?: Ymd;
  checkInGte?: Ymd;
  status?: string;
  listingIds?: string[];
}

export interface LifecyclePatch {
  status?: PackageStatus;
  hidden?: boolean;
  cancel_reason?: string | null;
  cancelled_at?: string | null;
}

export interface WebhookEventInsert {
  svix_id: string | null;
  event_id: string | null;
  event: string | null;
  object_id: string | null;
  status: WebhookEventStatus;
  payload: unknown;
  error?: string | null;
}

export interface RetentionResult {
  sync_runs: number;
  webhook_events: number;
  calendar: number;
  reservations: number;
}

/** Duvet type chosen per listing in Settings. */
export type DuvetTypes = Record<string, 'male' | 'velke'>;

/**
 * Everything the sync engine reads and writes. The Supabase implementation is
 * used in production; the memory implementation in unit tests and seed runs.
 */
export interface SyncRepo {
  // listings
  upsertListings(rows: ListingRow[]): Promise<void>;
  getListings(): Promise<ListingRow[]>;
  getListing(id: string): Promise<ListingRow | null>;

  // reservations (upsert keeps the fresher fetched_at)
  upsertReservations(rows: ReservationRow[]): Promise<void>;
  getReservations(filter: ReservationFilter): Promise<ReservationRow[]>;
  getReservationsByIds(ids: string[]): Promise<ReservationRow[]>;
  incrementNotFound(ids: string[]): Promise<void>;
  resetNotFound(ids: string[]): Promise<void>;

  // early arrivals: derived from the reservations by the sync (src/sync/early-arrivals.ts)
  /** Active rows of the given days. */
  getEarlyArrivals(dates: readonly Ymd[]): Promise<EarlyArrivalRow[]>;
  insertEarlyArrivals(rows: EarlyArrivalInsert[]): Promise<void>;
  /** Marks rows removed (they stay for the record), naming who removed them. */
  removeEarlyArrivals(ids: string[], by: string): Promise<void>;

  // push notifications (src/sync/push.ts)
  /** Subscriptions of active users. */
  getPushSubscriptions(): Promise<PushSubscriptionRow[]>;
  /** Drops subscriptions the push service no longer knows. */
  deletePushSubscriptions(endpoints: string[]): Promise<void>;

  // calendar
  upsertCalendar(rows: CalendarRow[]): Promise<void>;
  getCalendar(listingIds: string[], from: Ymd, to: Ymd): Promise<CalendarRow[]>;

  // packages: only the computed columns and the lifecycle are writable here
  getPackagesInWindow(dates: Ymd[]): Promise<PackageRow[]>;
  getPackagesByReservationIds(ids: string[]): Promise<PackageRow[]>;
  insertPackage(computed: PackageComputed): Promise<PackageRow>;
  updatePackageComputed(id: string, computed: PackageComputed): Promise<void>;
  setPackageLifecycle(id: string, patch: LifecyclePatch): Promise<void>;
  insertEvents(events: PackageEventInsert[]): Promise<void>;

  // settings
  getSetting<T>(key: 'linen_table' | 'duvet_types' | 'checklist' | string): Promise<T | null>;

  // runs, state, locks
  startRun(job: SyncJob, trigger: string): Promise<number>;
  finishRun(id: number, patch: Partial<Pick<SyncRunRow, 'ok' | 'partial' | 'error' | 'guesty_calls' | 'stats'>>): Promise<void>;
  getRecentRuns(job: SyncJob, limit: number): Promise<SyncRunRow[]>;
  getState<T>(key: AppStateKey): Promise<T | null>;
  setState(key: AppStateKey, value: unknown): Promise<void>;
  acquireLock(name: string, ttlSeconds: number, runId: string): Promise<boolean>;
  releaseLock(name: string, runId: string): Promise<void>;

  // webhooks
  insertWebhookEvent(row: WebhookEventInsert): Promise<{ id: number; duplicate: boolean }>;
  getWebhookEvent(id: number): Promise<WebhookEventRow | null>;
  updateWebhookEvent(id: number, patch: Partial<Pick<WebhookEventRow, 'status' | 'error' | 'processed_at' | 'attempts' | 'object_id'>>): Promise<void>;
  getWebhookEventsToRetry(olderThanSeconds: number, maxAttempts: number): Promise<WebhookEventRow[]>;

  // token cache
  readonly tokenStore: TokenStore;

  // nightly retention
  runRetention(now: Date): Promise<RetentionResult>;
}

/** Settings as the recompute needs them. */
export interface LoadedSettings {
  linen: Partial<PackingSettings> | null;
  duvetTypes: DuvetTypes;
}

export async function loadSettings(repo: SyncRepo): Promise<LoadedSettings> {
  const [linen, duvetTypes] = await Promise.all([
    repo.getSetting<Partial<PackingSettings>>('linen_table'),
    repo.getSetting<DuvetTypes>('duvet_types'),
  ]);
  return { linen: linen ?? null, duvetTypes: duvetTypes ?? {} };
}
