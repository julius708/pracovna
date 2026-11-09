-- "Pre Angeliku - prosím dobaliť do tašiek a odkliknúť" (Martina, 2026-11-09):
-- items to bring to a flat, written for a board day, ticked "Dodané" when they
-- are packed into the flat's bags. Every tick is kept (who and when), so the
-- admin "Vyúčtovanie" page lists per month what went to which flat.
--   write and tick: every active user (the office and Angelika's team)
--   remove: the author, or an admin; removed rows stay for the record
-- Purely additive: one new table, three RPCs. No bare dollar sign outside the
-- function bodies: the Supabase SQL editor splits the script on it.

create table if not exists public.delivery_requests (
  id uuid primary key default gen_random_uuid(),
  -- the board day the items are packed for (Bratislava calendar date)
  date date not null,
  listing_id text not null,
  listing_name text not null,
  text text not null check (char_length(text) between 1 and 500),
  author uuid references public.profiles(id) on delete set null,
  author_name text not null,
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  delivered_by uuid references public.profiles(id) on delete set null,
  delivered_by_name text,
  removed_at timestamptz,
  removed_by uuid references public.profiles(id) on delete set null,
  removed_by_name text,
  -- idempotency key of the add action (retries after a lost response)
  client_action_id uuid unique
);
create index if not exists delivery_requests_day on public.delivery_requests (date) where removed_at is null;
create index if not exists delivery_requests_delivered on public.delivery_requests (delivered_at) where removed_at is null and delivered_at is not null;

alter table public.delivery_requests enable row level security;
drop policy if exists delivery_requests_select on public.delivery_requests;
create policy delivery_requests_select on public.delivery_requests for select to authenticated
  using (public.is_active_user() and (removed_at is null or public.is_admin()));
revoke all on public.delivery_requests from public, anon;
revoke insert, update, delete, truncate, references, trigger on public.delivery_requests from authenticated;
grant select on public.delivery_requests to authenticated;

-- items for a flat on a board day (every active user)
create or replace function public.add_delivery_request(p_date date, p_listing_id text, p_text text, p_action_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare
  me uuid := auth.uid();
  me_name text;
  lname text;
  clean text := left(btrim(coalesce(p_text, '')), 500);
  existing public.delivery_requests;
  row public.delivery_requests;
begin
  if not public.is_active_user() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_action_id is not null then
    select * into existing from public.delivery_requests where client_action_id = p_action_id;
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
  select name into lname from public.listings where guesty_id = p_listing_id and in_scope;
  if lname is null then
    return jsonb_build_object('ok', false, 'status', 'bad_listing');
  end if;
  select display_name into me_name from public.profiles where id = me;
  insert into public.delivery_requests (date, listing_id, listing_name, text, author, author_name, client_action_id)
  values (p_date, p_listing_id, lname, clean, me, coalesce(me_name, '—'), p_action_id)
  returning * into row;
  return jsonb_build_object('ok', true, 'id', row.id);
end $fn$;

-- tick "Dodané", or take the tick back (every active user)
create or replace function public.set_delivery_done(p_id uuid, p_done boolean) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare
  me uuid := auth.uid();
  me_name text;
  row public.delivery_requests;
begin
  if not public.is_active_user() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into row from public.delivery_requests where id = p_id for update;
  if not found then
    raise exception 'request not found' using errcode = 'P0002';
  end if;
  if row.removed_at is not null then
    return jsonb_build_object('ok', false, 'status', 'removed');
  end if;
  if coalesce(p_done, false) then
    if row.delivered_at is not null then
      return jsonb_build_object('ok', true, 'replayed', true);
    end if;
    select display_name into me_name from public.profiles where id = me;
    update public.delivery_requests set delivered_at = now(), delivered_by = me, delivered_by_name = coalesce(me_name, '—') where id = p_id;
  else
    update public.delivery_requests set delivered_at = null, delivered_by = null, delivered_by_name = null where id = p_id;
  end if;
  return jsonb_build_object('ok', true);
end $fn$;

-- remove a request (its author, or an admin); the row stays for the record
create or replace function public.remove_delivery_request(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare
  me uuid := auth.uid();
  me_name text;
  row public.delivery_requests;
begin
  if not public.is_active_user() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into row from public.delivery_requests where id = p_id for update;
  if not found then
    raise exception 'request not found' using errcode = 'P0002';
  end if;
  if row.removed_at is not null then
    return jsonb_build_object('ok', true, 'replayed', true);
  end if;
  if row.author is distinct from me and not public.is_admin() then
    return jsonb_build_object('ok', false, 'status', 'not_author');
  end if;
  select display_name into me_name from public.profiles where id = me;
  update public.delivery_requests set removed_at = now(), removed_by = me, removed_by_name = coalesce(me_name, '—') where id = p_id;
  return jsonb_build_object('ok', true);
end $fn$;

revoke execute on function public.add_delivery_request(date, text, text, uuid) from public, anon;
revoke execute on function public.set_delivery_done(uuid, boolean) from public, anon;
revoke execute on function public.remove_delivery_request(uuid) from public, anon;
grant execute on function public.add_delivery_request(date, text, text, uuid) to authenticated;
grant execute on function public.set_delivery_done(uuid, boolean) to authenticated;
grant execute on function public.remove_delivery_request(uuid) to authenticated;

drop trigger if exists delivery_requests_notify on public.delivery_requests;
create trigger delivery_requests_notify after insert or update or delete on public.delivery_requests
  for each row execute function public.notify_board();
