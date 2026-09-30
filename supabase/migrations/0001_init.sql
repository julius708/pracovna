-- LIVE-IN Práčovňa – initial schema (see docs/PROPOSAL.md, Appendix A)
-- Applies to Supabase Postgres. Tests run it on PGlite with stub auth/realtime schemas.

-- ---------------------------------------------------------------- helpers
create or replace function public.today_ba() returns date
language sql stable as $$ select (now() at time zone 'Europe/Bratislava')::date $$;

-- ---------------------------------------------------------------- profiles
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  role text not null default 'staff' check (role in ('staff', 'admin')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- (defined after the table: SQL-language functions are validated at creation time)
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as
$$ select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and active) $$;

create or replace function public.is_active_user() returns boolean
language sql stable security definer set search_path = '' as
$$ select exists (select 1 from public.profiles where id = auth.uid() and active) $$;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), split_part(coalesce(new.email, ''), '@', 1), 'Používateľ')
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- Guesty snapshots
create table if not exists public.listings (
  guesty_id text primary key,
  name text not null,
  title text,
  city text,
  active boolean not null default true,
  accommodates int,
  bedrooms int,
  bathrooms numeric(3,1),
  beds jsonb not null default '{}',
  beds_source text not null default 'none',
  tags text[] not null default '{}',
  laundry_raw text,
  laundry jsonb,
  cleaner text,
  owner_cleans boolean not null default false,
  in_scope boolean not null default false,
  exclusion_reason text,
  fetched_at timestamptz not null,
  updated_at timestamptz not null default now()
);
create index if not exists listings_in_scope_idx on public.listings (name) where in_scope;

create table if not exists public.reservations (
  guesty_id text primary key,
  listing_id text not null,
  arrival_listing_id text not null,
  status text not null,
  check_in_date date not null,
  check_out_date date not null,
  guests int,
  adults int,
  children int,
  infants int,
  confirmation_code text,
  source text,
  multi_stay boolean not null default false,
  not_found_runs smallint not null default 0,
  fetched_at timestamptz not null,
  updated_at timestamptz not null default now()
);
create index if not exists reservations_checkout_idx on public.reservations (check_out_date, status);
create index if not exists reservations_arrival_idx on public.reservations (arrival_listing_id, check_in_date) where status = 'confirmed';

create table if not exists public.calendar_min_nights (
  listing_id text not null,
  date date not null,
  min_nights int,
  status text,
  cta boolean,
  source text not null default 'guesty',
  fetched_at timestamptz not null default now(),
  primary key (listing_id, date)
);

-- ---------------------------------------------------------------- packages
create table if not exists public.packages (
  id uuid primary key default gen_random_uuid(),
  -- computed group (sync only)
  outgoing_reservation_id text not null unique,
  listing_id text not null,
  listing_name text not null,
  date date not null,
  incoming_reservation_id text,
  same_day boolean not null default false,
  gap_nights int,
  gap_blocked boolean,
  target_people int not null,
  people_source text not null check (people_source in ('same_day', 'gap', 'capacity', 'capacity_from_beds')),
  computed_items jsonb not null,
  computed_hash text not null,
  warnings jsonb not null default '[]',
  computed_at timestamptz not null default now(),
  -- lifecycle group (sync)
  status text not null default 'todo' check (status in ('todo', 'packed', 'cancelled')),
  hidden boolean not null default false,
  cancel_reason text,
  cancelled_at timestamptz,
  -- staff group (RPC only)
  note text not null default '',
  note_by uuid,
  note_by_name text,
  note_at timestamptz,
  checklist jsonb not null default '{"items":[],"checked":{}}',
  packed_by uuid,
  packed_by_name text,
  packed_at timestamptz,
  packed_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists packages_date_idx on public.packages (date, status) where not hidden;
create index if not exists packages_listing_date_idx on public.packages (listing_id, date);

-- Guard: computed and lifecycle columns change only under the 'sync' scope,
-- staff columns only under the 'staff' scope. The scope is a transaction-local
-- setting that the RPC functions below set; a plain UPDATE is refused.
create or replace function public.packages_guard() returns trigger
language plpgsql as $$
declare
  scope text := coalesce(current_setting('app.write_scope', true), '');
  computed_changed boolean;
  lifecycle_changed boolean;
  staff_changed boolean;
begin
  computed_changed := new.outgoing_reservation_id is distinct from old.outgoing_reservation_id
    or new.listing_id is distinct from old.listing_id
    or new.listing_name is distinct from old.listing_name
    or new.date is distinct from old.date
    or new.incoming_reservation_id is distinct from old.incoming_reservation_id
    or new.same_day is distinct from old.same_day
    or new.gap_nights is distinct from old.gap_nights
    or new.gap_blocked is distinct from old.gap_blocked
    or new.target_people is distinct from old.target_people
    or new.people_source is distinct from old.people_source
    or new.computed_items is distinct from old.computed_items
    or new.computed_hash is distinct from old.computed_hash
    or new.warnings is distinct from old.warnings;
  lifecycle_changed := new.hidden is distinct from old.hidden
    or new.cancel_reason is distinct from old.cancel_reason
    or new.cancelled_at is distinct from old.cancelled_at
    or (new.status is distinct from old.status and (new.status = 'cancelled' or old.status = 'cancelled'));
  staff_changed := new.note is distinct from old.note
    or new.note_by is distinct from old.note_by
    or new.note_by_name is distinct from old.note_by_name
    or new.note_at is distinct from old.note_at
    or new.checklist is distinct from old.checklist
    or new.packed_by is distinct from old.packed_by
    or new.packed_by_name is distinct from old.packed_by_name
    or new.packed_at is distinct from old.packed_at
    or new.packed_hash is distinct from old.packed_hash
    or (new.status is distinct from old.status and new.status <> 'cancelled' and old.status <> 'cancelled');
  if computed_changed and scope <> 'sync' then
    raise exception 'packages: computed columns can only be changed by the sync' using errcode = '42501';
  end if;
  if lifecycle_changed and scope <> 'sync' then
    raise exception 'packages: lifecycle columns can only be changed by the sync' using errcode = '42501';
  end if;
  if staff_changed and scope <> 'staff' then
    raise exception 'packages: staff columns can only be changed through the staff RPCs' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists packages_guard on public.packages;
create trigger packages_guard before update on public.packages
  for each row execute function public.packages_guard();

-- ---------------------------------------------------------------- audit log
create table if not exists public.package_events (
  id bigint generated always as identity primary key,
  package_id uuid not null references public.packages(id),
  package_date date not null,
  listing_id text not null,
  listing_name text not null,
  event text not null check (event in ('created','recomputed','moved','cancelled','restored','packed','unpacked','note','checklist','settings_recompute')),
  actor uuid,
  actor_name text not null,
  client_action_id uuid unique,
  data jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists package_events_created_idx on public.package_events (created_at desc);
create index if not exists package_events_pkg_idx on public.package_events (package_id, created_at);
create index if not exists package_events_actor_idx on public.package_events (actor, created_at desc);

create or replace function public.package_events_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'package_events is append-only' using errcode = '42501';
end $$;
drop trigger if exists package_events_immutable on public.package_events;
create trigger package_events_immutable before update or delete on public.package_events
  for each row execute function public.package_events_immutable();

-- ---------------------------------------------------------------- settings, operations
create table if not exists public.settings (
  key text primary key,
  value jsonb not null,
  version int not null default 1,
  updated_by uuid,
  updated_at timestamptz not null default now()
);
create table if not exists public.settings_history (
  id bigserial primary key,
  key text not null,
  old_value jsonb,
  new_value jsonb,
  changed_by uuid,
  changed_at timestamptz not null default now()
);
create table if not exists public.sync_runs (
  id bigserial primary key,
  job text not null,
  trigger text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  ok boolean,
  partial text[] not null default '{}',
  error text,
  guesty_calls int not null default 0,
  stats jsonb not null default '{}'
);
create index if not exists sync_runs_job_idx on public.sync_runs (job, started_at desc);
create table if not exists public.webhook_events (
  id bigint generated always as identity primary key,
  svix_id text unique,
  event_id text unique,
  event text,
  object_id text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  status text not null default 'received' check (status in ('received','processed','failed','ignored','rejected')),
  attempts int not null default 0,
  error text,
  payload jsonb
);
create index if not exists webhook_events_received_idx on public.webhook_events (received_at desc);
create table if not exists public.guesty_tokens (
  id smallint primary key default 1 check (id = 1),
  access_token text,
  expires_at timestamptz,
  obtained_at timestamptz,
  mints timestamptz[] not null default '{}',
  lease_until timestamptz
);
insert into public.guesty_tokens (id) values (1) on conflict do nothing;
create table if not exists public.sync_locks (
  name text primary key,
  locked_until timestamptz not null,
  run_id text
);
create table if not exists public.app_state (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- realtime broadcast
-- A tiny message on the private topic 'board' whenever a package or setting changes.
create or replace function public.notify_board() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  payload jsonb;
begin
  if to_regprocedure('realtime.send(jsonb,text,text,boolean)') is null then
    return null;
  end if;
  payload := jsonb_build_object('table', tg_table_name, 'op', tg_op, 'at', now());
  if tg_table_name = 'packages' then
    payload := payload || jsonb_build_object('id', coalesce(new.id, old.id), 'date', coalesce(new.date, old.date));
  end if;
  perform realtime.send(payload, 'change', 'board', true);
  return null;
end $$;

drop trigger if exists packages_notify on public.packages;
create trigger packages_notify after insert or update or delete on public.packages
  for each row execute function public.notify_board();
drop trigger if exists settings_notify on public.settings;
create trigger settings_notify after insert or update on public.settings
  for each row execute function public.notify_board();

-- ---------------------------------------------------------------- sync RPCs (service role)
-- Upserts the computed part of a package; never touches staff columns.
create or replace function public.sync_upsert_package(p jsonb) returns public.packages
language plpgsql security definer set search_path = '' as $$
declare
  row public.packages;
begin
  perform set_config('app.write_scope', 'sync', true);
  insert into public.packages (
    outgoing_reservation_id, listing_id, listing_name, date, incoming_reservation_id, same_day,
    gap_nights, gap_blocked, target_people, people_source, computed_items, computed_hash, warnings, computed_at)
  values (
    p->>'outgoing_reservation_id', p->>'listing_id', p->>'listing_name', (p->>'date')::date, p->>'incoming_reservation_id',
    coalesce((p->>'same_day')::boolean, false), (p->>'gap_nights')::int, (p->>'gap_blocked')::boolean,
    (p->>'target_people')::int, p->>'people_source', p->'computed_items', p->>'computed_hash', coalesce(p->'warnings', '[]'::jsonb), now())
  on conflict (outgoing_reservation_id) do update set
    listing_id = excluded.listing_id,
    listing_name = excluded.listing_name,
    date = excluded.date,
    incoming_reservation_id = excluded.incoming_reservation_id,
    same_day = excluded.same_day,
    gap_nights = excluded.gap_nights,
    gap_blocked = excluded.gap_blocked,
    target_people = excluded.target_people,
    people_source = excluded.people_source,
    computed_items = excluded.computed_items,
    computed_hash = excluded.computed_hash,
    warnings = excluded.warnings,
    computed_at = now()
  returning * into row;
  return row;
end $$;

create or replace function public.sync_set_lifecycle(p_id uuid, p_status text, p_hidden boolean, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('app.write_scope', 'sync', true);
  update public.packages set
    status = coalesce(p_status, status),
    hidden = coalesce(p_hidden, hidden),
    cancel_reason = case when p_status = 'cancelled' then p_reason else null end,
    cancelled_at = case when p_status = 'cancelled' then now() else null end
  where id = p_id;
end $$;

-- ---------------------------------------------------------------- staff RPCs
create or replace function public.pack_package(p_id uuid, p_action_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  me_name text;
  row public.packages;
begin
  if not public.is_active_user() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_action_id is not null and exists (select 1 from public.package_events where client_action_id = p_action_id) then
    select * into row from public.packages where id = p_id;
    return jsonb_build_object('ok', true, 'replayed', true, 'status', row.status);
  end if;
  select display_name into me_name from public.profiles where id = me;
  select * into row from public.packages where id = p_id for update;
  if not found then
    raise exception 'package not found' using errcode = 'P0002';
  end if;
  if row.status = 'packed' then
    return jsonb_build_object('ok', false, 'already_packed', true, 'packed_by_name', row.packed_by_name, 'status', row.status);
  end if;
  if row.status <> 'todo' then
    return jsonb_build_object('ok', false, 'status', row.status);
  end if;
  perform set_config('app.write_scope', 'staff', true);
  update public.packages set
    status = 'packed', packed_by = me, packed_by_name = me_name, packed_at = now(), packed_hash = computed_hash
  where id = p_id;
  insert into public.package_events (package_id, package_date, listing_id, listing_name, event, actor, actor_name, client_action_id, data)
  values (p_id, row.date, row.listing_id, row.listing_name, 'packed', me, coalesce(me_name, '—'), p_action_id, '{}'::jsonb);
  return jsonb_build_object('ok', true, 'status', 'packed', 'packed_by_name', me_name);
end $$;

create or replace function public.unpack_package(p_id uuid, p_action_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  me_name text;
  row public.packages;
begin
  if not public.is_active_user() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_action_id is not null and exists (select 1 from public.package_events where client_action_id = p_action_id) then
    return jsonb_build_object('ok', true, 'replayed', true);
  end if;
  select display_name into me_name from public.profiles where id = me;
  select * into row from public.packages where id = p_id for update;
  if not found then
    raise exception 'package not found' using errcode = 'P0002';
  end if;
  if row.status <> 'packed' then
    return jsonb_build_object('ok', false, 'status', row.status);
  end if;
  perform set_config('app.write_scope', 'staff', true);
  update public.packages set
    status = 'todo', packed_by = null, packed_by_name = null, packed_at = null, packed_hash = null
  where id = p_id;
  insert into public.package_events (package_id, package_date, listing_id, listing_name, event, actor, actor_name, client_action_id, data)
  values (p_id, row.date, row.listing_id, row.listing_name, 'unpacked', me, coalesce(me_name, '—'), p_action_id,
          jsonb_build_object('previously_packed_by', row.packed_by_name));
  return jsonb_build_object('ok', true, 'status', 'todo');
end $$;

create or replace function public.set_note(p_id uuid, p_note text, p_action_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  me_name text;
  row public.packages;
  clean text := left(coalesce(p_note, ''), 200);
begin
  if not public.is_active_user() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_action_id is not null and exists (select 1 from public.package_events where client_action_id = p_action_id) then
    return jsonb_build_object('ok', true, 'replayed', true);
  end if;
  select display_name into me_name from public.profiles where id = me;
  select * into row from public.packages where id = p_id for update;
  if not found then
    raise exception 'package not found' using errcode = 'P0002';
  end if;
  if row.status = 'cancelled' then
    return jsonb_build_object('ok', false, 'status', row.status);
  end if;
  perform set_config('app.write_scope', 'staff', true);
  update public.packages set
    note = clean,
    note_by = case when clean = '' then null else me end,
    note_by_name = case when clean = '' then null else me_name end,
    note_at = case when clean = '' then null else now() end
  where id = p_id;
  insert into public.package_events (package_id, package_date, listing_id, listing_name, event, actor, actor_name, client_action_id, data)
  values (p_id, row.date, row.listing_id, row.listing_name, 'note', me, coalesce(me_name, '—'), p_action_id,
          jsonb_build_object('note', clean, 'previous', row.note));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.toggle_check(p_id uuid, p_item text, p_checked boolean, p_action_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  me_name text;
  row public.packages;
  checked jsonb;
begin
  if not public.is_active_user() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_action_id is not null and exists (select 1 from public.package_events where client_action_id = p_action_id) then
    return jsonb_build_object('ok', true, 'replayed', true);
  end if;
  select display_name into me_name from public.profiles where id = me;
  select * into row from public.packages where id = p_id for update;
  if not found then
    raise exception 'package not found' using errcode = 'P0002';
  end if;
  if row.status <> 'todo' then
    return jsonb_build_object('ok', false, 'status', row.status);
  end if;
  checked := coalesce(row.checklist -> 'checked', '{}'::jsonb);
  if p_checked then checked := checked || jsonb_build_object(p_item, true); else checked := checked - p_item; end if;
  perform set_config('app.write_scope', 'staff', true);
  update public.packages set checklist = jsonb_build_object('items', coalesce(row.checklist -> 'items', '[]'::jsonb), 'checked', checked)
  where id = p_id;
  insert into public.package_events (package_id, package_date, listing_id, listing_name, event, actor, actor_name, client_action_id, data)
  values (p_id, row.date, row.listing_id, row.listing_name, 'checklist', me, coalesce(me_name, '—'), p_action_id,
          jsonb_build_object('item', p_item, 'checked', p_checked));
  return jsonb_build_object('ok', true, 'checked', checked);
end $$;

-- ---------------------------------------------------------------- admin RPCs
create or replace function public.save_settings(p_key text, p_value jsonb, p_expected_version int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  cur public.settings;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  select * into cur from public.settings where key = p_key for update;
  if found and p_expected_version is not null and cur.version <> p_expected_version then
    return jsonb_build_object('ok', false, 'conflict', true, 'version', cur.version);
  end if;
  insert into public.settings_history (key, old_value, new_value, changed_by) values (p_key, cur.value, p_value, auth.uid());
  insert into public.settings (key, value, version, updated_by, updated_at)
  values (p_key, p_value, 1, auth.uid(), now())
  on conflict (key) do update set value = excluded.value, version = public.settings.version + 1, updated_by = excluded.updated_by, updated_at = now();
  return jsonb_build_object('ok', true, 'version', coalesce(cur.version, 0) + 1);
end $$;

create or replace function public.admin_set_profile(p_id uuid, p_role text, p_active boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  update public.profiles set role = coalesce(p_role, role), active = coalesce(p_active, active) where id = p_id;
end $$;

-- ---------------------------------------------------------------- row level security
alter table public.profiles enable row level security;
alter table public.listings enable row level security;
alter table public.reservations enable row level security;
alter table public.calendar_min_nights enable row level security;
alter table public.packages enable row level security;
alter table public.package_events enable row level security;
alter table public.settings enable row level security;
alter table public.settings_history enable row level security;
alter table public.sync_runs enable row level security;
alter table public.webhook_events enable row level security;
alter table public.guesty_tokens enable row level security;
alter table public.sync_locks enable row level security;
alter table public.app_state enable row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (public.is_active_user());

drop policy if exists listings_select on public.listings;
create policy listings_select on public.listings for select to authenticated using (public.is_active_user() and (in_scope or public.is_admin()));

drop policy if exists reservations_select on public.reservations;
create policy reservations_select on public.reservations for select to authenticated using (public.is_admin());

drop policy if exists calendar_select on public.calendar_min_nights;
create policy calendar_select on public.calendar_min_nights for select to authenticated using (public.is_admin());

drop policy if exists packages_select on public.packages;
create policy packages_select on public.packages for select to authenticated using (
  public.is_active_user() and (public.is_admin() or (not hidden and date between public.today_ba() - 1 and public.today_ba() + 2))
);

drop policy if exists package_events_select on public.package_events;
create policy package_events_select on public.package_events for select to authenticated using (public.is_admin());

drop policy if exists settings_select on public.settings;
create policy settings_select on public.settings for select to authenticated using (public.is_active_user());

drop policy if exists settings_history_select on public.settings_history;
create policy settings_history_select on public.settings_history for select to authenticated using (public.is_admin());

drop policy if exists sync_runs_select on public.sync_runs;
create policy sync_runs_select on public.sync_runs for select to authenticated using (public.is_admin());

drop policy if exists webhook_events_select on public.webhook_events;
create policy webhook_events_select on public.webhook_events for select to authenticated using (public.is_admin());

drop policy if exists app_state_select on public.app_state;
create policy app_state_select on public.app_state for select to authenticated using (public.is_admin());

-- guesty_tokens and sync_locks: RLS enabled, no policies -> service role only.

-- Realtime: active users may read the private 'board' topic.
do $$
begin
  if to_regclass('realtime.messages') is not null then
    execute 'drop policy if exists board_read on realtime.messages';
    execute $p$create policy board_read on realtime.messages for select to authenticated
      using (public.is_active_user() and realtime.topic() = 'board')$p$;
  end if;
end $$;
