-- "Info pre upratovačov" (Martina, 2026-10-30; database change approved by
-- Július, 2026-10-30): a grey box on the board above the packing section.
--  1. listings.cleaning_info: the standing note from the Guesty custom field
--     "INFO PRE UPRATOVAČOV", written by the listings sync.
--  2. cleaning_requests: messages for the cleaners on a board day (optionally
--     about one flat), with replies one level deep and a "vybavené" tick.
-- Roles come from the shared LIVE-IN users (public.app_users through the
-- existing public.current_app_roles(); read only, nothing about roles or
-- sign-in changes here):
--   read     cleaning, admin, customer_service, operations
--   write    admin, customer_service (a message), all readers (a reply)
--   tick     cleaning, admin, customer_service
--   remove   the author, or an app admin
-- Purely additive: one nullable column, one new table, one helper, four RPCs.
-- No bare dollar sign outside the function bodies: the Supabase SQL editor
-- splits the script on it.

alter table public.listings add column if not exists cleaning_info text;

create table if not exists public.cleaning_requests (
  id uuid primary key default gen_random_uuid(),
  -- the board day the message belongs to (Bratislava calendar date)
  date date not null,
  -- the flat it is about, if any
  listing_id text,
  listing_name text,
  text text not null check (char_length(text) between 1 and 500),
  author uuid references public.profiles(id) on delete set null,
  author_name text not null,
  created_at timestamptz not null default now(),
  -- a reply: the message it answers (same day, one level only)
  parent_id uuid references public.cleaning_requests(id) on delete cascade,
  done_at timestamptz,
  done_by uuid references public.profiles(id) on delete set null,
  done_by_name text,
  removed_at timestamptz,
  removed_by uuid references public.profiles(id) on delete set null,
  removed_by_name text,
  -- idempotency key of the add action (retries after a lost response)
  client_action_id uuid unique
);
create index if not exists cleaning_requests_day on public.cleaning_requests (date) where removed_at is null;
create index if not exists cleaning_requests_parent on public.cleaning_requests (parent_id) where parent_id is not null;

-- true when the signed-in person has one of the given LIVE-IN app roles
create or replace function public.has_cleaning_role(p_roles text[]) returns boolean
language sql stable security definer set search_path = '' as $fn$
  select public.current_app_roles() && p_roles
$fn$;
revoke execute on function public.has_cleaning_role(text[]) from public, anon;
grant execute on function public.has_cleaning_role(text[]) to authenticated;

alter table public.cleaning_requests enable row level security;
drop policy if exists cleaning_requests_select on public.cleaning_requests;
create policy cleaning_requests_select on public.cleaning_requests for select to authenticated
  using (
    public.is_active_user()
    and public.has_cleaning_role(array['cleaning', 'admin', 'customer_service', 'operations'])
    and (removed_at is null or public.is_admin())
  );
revoke all on public.cleaning_requests from public, anon;
revoke insert, update, delete, truncate, references, trigger on public.cleaning_requests from authenticated;
grant select on public.cleaning_requests to authenticated;

-- a new message for a board day (admin, customer_service)
create or replace function public.add_cleaning_request(p_date date, p_listing_id text, p_text text, p_action_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare
  me uuid := auth.uid();
  me_name text;
  lname text;
  clean text := left(btrim(coalesce(p_text, '')), 500);
  existing public.cleaning_requests;
  row public.cleaning_requests;
begin
  if not public.is_active_user() or not public.has_cleaning_role(array['admin', 'customer_service']) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_action_id is not null then
    select * into existing from public.cleaning_requests where client_action_id = p_action_id;
    if found then
      return jsonb_build_object('ok', true, 'replayed', true, 'id', existing.id);
    end if;
  end if;
  if clean = '' then
    return jsonb_build_object('ok', false, 'status', 'empty');
  end if;
  if p_date is null or p_date < public.today_ba() - 1 or p_date > public.today_ba() + 60 then
    return jsonb_build_object('ok', false, 'status', 'bad_date');
  end if;
  if p_listing_id is not null and p_listing_id <> '' then
    select name into lname from public.listings where guesty_id = p_listing_id and in_scope;
    if lname is null then
      return jsonb_build_object('ok', false, 'status', 'bad_listing');
    end if;
  end if;
  select display_name into me_name from public.profiles where id = me;
  insert into public.cleaning_requests (date, listing_id, listing_name, text, author, author_name, client_action_id)
  values (p_date, nullif(p_listing_id, ''), lname, clean, me, coalesce(me_name, '—'), p_action_id)
  returning * into row;
  return jsonb_build_object('ok', true, 'id', row.id);
end $fn$;

-- a reply under a message (everyone who sees the box)
create or replace function public.add_cleaning_reply(p_parent uuid, p_text text, p_action_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare
  me uuid := auth.uid();
  me_name text;
  clean text := left(btrim(coalesce(p_text, '')), 500);
  parent public.cleaning_requests;
  existing public.cleaning_requests;
  row public.cleaning_requests;
begin
  if not public.is_active_user() or not public.has_cleaning_role(array['cleaning', 'admin', 'customer_service', 'operations']) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_action_id is not null then
    select * into existing from public.cleaning_requests where client_action_id = p_action_id;
    if found then
      return jsonb_build_object('ok', true, 'replayed', true, 'id', existing.id);
    end if;
  end if;
  if clean = '' then
    return jsonb_build_object('ok', false, 'status', 'empty');
  end if;
  select * into parent from public.cleaning_requests where id = p_parent;
  if not found or parent.removed_at is not null then
    return jsonb_build_object('ok', false, 'status', 'removed');
  end if;
  if parent.parent_id is not null then
    return jsonb_build_object('ok', false, 'status', 'nested');
  end if;
  select display_name into me_name from public.profiles where id = me;
  insert into public.cleaning_requests (date, listing_id, listing_name, text, author, author_name, client_action_id, parent_id)
  values (parent.date, parent.listing_id, parent.listing_name, clean, me, coalesce(me_name, '—'), p_action_id, parent.id)
  returning * into row;
  return jsonb_build_object('ok', true, 'id', row.id);
end $fn$;

-- tick a message as done, or take the tick back (cleaning, admin, customer_service)
create or replace function public.set_cleaning_request_done(p_id uuid, p_done boolean) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare
  me uuid := auth.uid();
  me_name text;
  row public.cleaning_requests;
begin
  if not public.is_active_user() or not public.has_cleaning_role(array['cleaning', 'admin', 'customer_service']) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into row from public.cleaning_requests where id = p_id for update;
  if not found then
    raise exception 'request not found' using errcode = 'P0002';
  end if;
  if row.removed_at is not null then
    return jsonb_build_object('ok', false, 'status', 'removed');
  end if;
  if coalesce(p_done, false) then
    if row.done_at is not null then
      return jsonb_build_object('ok', true, 'replayed', true);
    end if;
    select display_name into me_name from public.profiles where id = me;
    update public.cleaning_requests set done_at = now(), done_by = me, done_by_name = coalesce(me_name, '—') where id = p_id;
  else
    update public.cleaning_requests set done_at = null, done_by = null, done_by_name = null where id = p_id;
  end if;
  return jsonb_build_object('ok', true);
end $fn$;

-- remove a message or a reply (its author, or an app admin); the row stays for the record
create or replace function public.remove_cleaning_request(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare
  me uuid := auth.uid();
  me_name text;
  row public.cleaning_requests;
begin
  if not public.is_active_user() or not public.has_cleaning_role(array['cleaning', 'admin', 'customer_service', 'operations']) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into row from public.cleaning_requests where id = p_id for update;
  if not found then
    raise exception 'request not found' using errcode = 'P0002';
  end if;
  if row.removed_at is not null then
    return jsonb_build_object('ok', true, 'replayed', true);
  end if;
  if row.author is distinct from me and not public.has_cleaning_role(array['admin']) then
    return jsonb_build_object('ok', false, 'status', 'not_author');
  end if;
  select display_name into me_name from public.profiles where id = me;
  update public.cleaning_requests set removed_at = now(), removed_by = me, removed_by_name = coalesce(me_name, '—') where id = p_id;
  return jsonb_build_object('ok', true);
end $fn$;

revoke execute on function public.add_cleaning_request(date, text, text, uuid) from public, anon;
revoke execute on function public.add_cleaning_reply(uuid, text, uuid) from public, anon;
revoke execute on function public.set_cleaning_request_done(uuid, boolean) from public, anon;
revoke execute on function public.remove_cleaning_request(uuid) from public, anon;
grant execute on function public.add_cleaning_request(date, text, text, uuid) to authenticated;
grant execute on function public.add_cleaning_reply(uuid, text, uuid) to authenticated;
grant execute on function public.set_cleaning_request_done(uuid, boolean) to authenticated;
grant execute on function public.remove_cleaning_request(uuid) to authenticated;

drop trigger if exists cleaning_requests_notify on public.cleaning_requests;
create trigger cleaning_requests_notify after insert or update or delete on public.cleaning_requests
  for each row execute function public.notify_board();
