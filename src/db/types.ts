import type { PackingResult, ParsedLaundry, PeopleSource } from '@/core/packing';

/** ISO instant. */
export type Instant = string;
/** YYYY-MM-DD in Europe/Bratislava. */
export type Ymd = string;

export type BedsSource = 'listingRooms' | 'spaces' | 'beds_count' | 'none';

export interface ListingRow {
  guesty_id: string;
  name: string;
  title: string | null;
  city: string | null;
  active: boolean;
  accommodates: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  beds: Record<string, number>;
  beds_source: BedsSource;
  tags: string[];
  laundry_raw: string | null;
  laundry: ParsedLaundry | null;
  cleaner: string | null;
  /** Guesty custom field "INFO PRE UPRATOVAČOV": the standing note for the cleaners (migration 0018). */
  cleaning_info: string | null;
  owner_cleans: boolean;
  in_scope: boolean;
  exclusion_reason: string | null;
  fetched_at: Instant;
}

export interface ReservationRow {
  guesty_id: string;
  /** Listing of the last stay segment (the check-out). */
  listing_id: string;
  /** Listing of the first stay segment (the check-in). */
  arrival_listing_id: string;
  status: string;
  check_in_date: Ymd;
  check_out_date: Ymd;
  guests: number | null;
  adults: number | null;
  children: number | null;
  infants: number | null;
  confirmation_code: string | null;
  source: string | null;
  multi_stay: boolean;
  not_found_runs: number;
  fetched_at: Instant;
  /** Planned arrival "HH:MM" as Guesty writes it (see arrivalClock); null when unknown. Optional: older rows have none. */
  arrival_time?: string | null;
}

export interface CalendarRow {
  listing_id: string;
  date: Ymd;
  min_nights: number | null;
  status: string | null;
  cta: boolean | null;
  source: 'guesty' | 'pricelabs';
  fetched_at: Instant;
}

export type PackageStatus = 'todo' | 'packed' | 'cancelled';

/** The columns the sync is allowed to write. Never a staff column. */
export interface PackageComputed {
  outgoing_reservation_id: string;
  listing_id: string;
  listing_name: string;
  date: Ymd;
  incoming_reservation_id: string | null;
  same_day: boolean;
  gap_nights: number | null;
  gap_blocked: boolean | null;
  target_people: number;
  people_source: PeopleSource;
  computed_items: PackingResult;
  computed_hash: string;
  warnings: string[];
}

export const SYNC_COLUMNS: readonly (keyof PackageComputed)[] = [
  'outgoing_reservation_id',
  'listing_id',
  'listing_name',
  'date',
  'incoming_reservation_id',
  'same_day',
  'gap_nights',
  'gap_blocked',
  'target_people',
  'people_source',
  'computed_items',
  'computed_hash',
  'warnings',
];

export interface Checklist {
  items: string[];
  checked: Record<string, boolean>;
}

export interface PackageRow extends PackageComputed {
  id: string;
  status: PackageStatus;
  hidden: boolean;
  cancel_reason: string | null;
  cancelled_at: Instant | null;
  note: string;
  note_by: string | null;
  note_by_name: string | null;
  note_at: Instant | null;
  checklist: Checklist;
  packed_by: string | null;
  packed_by_name: string | null;
  packed_at: Instant | null;
  packed_hash: string | null;
  computed_at: Instant;
  created_at: Instant;
  updated_at: Instant;
}

export type PackageEventType =
  | 'created'
  | 'recomputed'
  | 'moved'
  | 'cancelled'
  | 'restored'
  | 'packed'
  | 'unpacked'
  | 'note'
  | 'checklist'
  | 'settings_recompute';

export interface PackageEventInsert {
  package_id: string;
  package_date: Ymd;
  listing_id: string;
  listing_name: string;
  event: PackageEventType;
  actor: string | null;
  actor_name: string;
  client_action_id?: string | null;
  data: Record<string, unknown>;
}

export interface PackageEventRow extends PackageEventInsert {
  id: number;
  created_at: Instant;
}

export type SyncJob = 'reconcile' | 'listings' | 'nightly' | 'webhook' | 'recompute';

export interface SyncRunRow {
  id: number;
  job: SyncJob;
  trigger: string;
  started_at: Instant;
  finished_at: Instant | null;
  ok: boolean | null;
  partial: string[];
  error: string | null;
  guesty_calls: number;
  stats: Record<string, unknown>;
}

export type WebhookEventStatus = 'received' | 'processed' | 'failed' | 'ignored' | 'rejected';

export interface WebhookEventRow {
  id: number;
  svix_id: string | null;
  event_id: string | null;
  event: string | null;
  object_id: string | null;
  received_at: Instant;
  processed_at: Instant | null;
  status: WebhookEventStatus;
  attempts: number;
  error: string | null;
  payload: unknown;
}

export interface SettingsRow<T = unknown> {
  key: string;
  value: T;
  version: number;
  updated_by: string | null;
  updated_at: Instant;
}

export interface ProfileRow {
  id: string;
  display_name: string;
  role: 'staff' | 'admin';
  active: boolean;
  created_at: Instant;
}

/** Keys of the app_state table. */
export type AppStateKey =
  | 'last_ok_sync_at'
  | 'consecutive_failures'
  | 'partial_runs'
  | 'listings_synced_at'
  | 'last_webhook_at'
  | 'alert_state'
  | 'custom_field_defs'
  | 'listing_drop'
  | 'webhook_registration'
  | 'listing_filter_supported'
  | 'reconcile_change_at'
  | 'token_quota_warning';

/** A note on the shared notice board ("Dôležité info"). */
/** "Skoré príchody": a guest arriving before 16:00 on `date` (migration 0012). */
export interface EarlyArrivalRow {
  id: string;
  listing_id: string;
  listing_name: string;
  date: Ymd;
  /** "HH:MM" */
  arrival: string;
  note: string;
  author: string | null;
  author_name: string;
  created_at: Instant;
  removed_at: Instant | null;
  removed_by: string | null;
  removed_by_name: string | null;
  client_action_id: string | null;
  /** Where the row came from ('guesty': derived from a reservation by the sync). */
  source: string;
  /** The reservation the row was derived from. */
  reservation_id: string | null;
}

/** "Skoré odchody": guests leaving the flat early on `date` (migration 0017, typed in). */
export interface EarlyDepartureRow {
  id: string;
  listing_id: string;
  listing_name: string;
  date: Ymd;
  /** "HH:MM" */
  departure: string;
  note: string;
  author: string | null;
  author_name: string;
  created_at: Instant;
  removed_at: Instant | null;
  removed_by: string | null;
  removed_by_name: string | null;
  client_action_id: string | null;
}

/** A message for the cleaners on a board day, or a reply to one (migration 0018). */
export interface CleaningRequestRow {
  id: string;
  date: Ymd;
  listing_id: string | null;
  listing_name: string | null;
  text: string;
  author: string | null;
  author_name: string;
  created_at: Instant;
  parent_id: string | null;
  done_at: Instant | null;
  done_by: string | null;
  done_by_name: string | null;
  removed_at: Instant | null;
  removed_by: string | null;
  removed_by_name: string | null;
  client_action_id: string | null;
}

/** A device's Web Push subscription (migration 0014), stored under the signed-in user. */
export interface PushSubscriptionRow {
  id: string;
  user_id: string;
  user_name: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent: string;
  created_at: Instant;
  last_ok_at: Instant | null;
  failed_at: Instant | null;
}

/** What the sync writes when a reservation turns out to arrive early. */
export type EarlyArrivalInsert = Pick<EarlyArrivalRow, 'listing_id' | 'listing_name' | 'date' | 'arrival' | 'note' | 'author_name' | 'source' | 'reservation_id'>;

export interface BoardNoteRow {
  id: string;
  text: string;
  date: Ymd;
  author: string | null;
  author_name: string;
  created_at: Instant;
  removed_at: Instant | null;
  removed_by: string | null;
  removed_by_name: string | null;
  client_action_id: string | null;
  edited_at: Instant | null;
  /** Set on a reply: the note it answers (migration 0015). */
  parent_id: string | null;
}
