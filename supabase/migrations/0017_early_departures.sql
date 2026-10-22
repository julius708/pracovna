-- "Skoré odchody" (Martina, 2026-10-22): when guests leave earlier than the
-- check-out time (they write so, or the camera shows it), the office records it
-- in the app, in a green box next to "Skoré príchody", for the departure day;
-- the flat's card for that day shows it, so the laundry team can go earlier.
-- Typed in like the early arrivals of 0016; no push notification. Any active
-- user may add an entry; the author's name and time are recorded; the author
-- or an admin removes it (removed rows stay for the record). Writes go only
-- through the two RPCs; every change is broadcast on the "board" topic.
-- Purely additive: one new table, two RPCs. No bare dollar sign outside the function
-- bodies: the Supabase SQL editor splits the script on it (2026-10-22).

create table if not exists public.early_departures (
  id uuid primary key default gen_random_uuid(),
  listing_id text not null,
  listing_name text not null,
  -- the departure day (Bratislava calendar date)
  date date not null,
  -- "HH:MM"
  departure text not null check (char_length(departure) = 5 and departure ~ '^([01][0-9]|2[0-3]):[0-5][0-9]'),
  note text not null default '' check (char_length(note) <= 300),
  author uuid references public.profiles(id) on delete set null,
  author_name text not null,
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_by uuid references public.profiles(id) on delete set null,
  removed_by_name text,
  -- idempotency key of the add action (retries after a lost response)
  client_action_id uuid unique
);
create index if not exists early_departures_active on public.early_departures (date, departure) where removed_at is null;

alter table public.early_departures enable row level security;
drop policy if exists early_departures_select on public.early_departures;
create policy early_departures_select on public.early_departures for select to authenticated
  using (public.is_active_user() and (removed_at is null or public.is_admin()));
revoke all on public.early_departures from public, anon;
revoke insert, update, delete, truncate, references, trigger on public.early_departures from authenticated;
grant select on public.early_departures to authenticated;

create or replace function public.add_early_departure(p_listing_id text, p_date date, p_departure text, p_note text, p_action_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare
  me uuid := auth.uid();
  me_name text;
  lname text;
  clean_note text := left(btrim(coalesce(p_note, '')), 300);
  existing public.early_departures;
  row public.early_departures;
begin
  if not public.is_active_user() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_action_id is not null then
    select * into existing from public.early_departures where client_action_id = p_action_id;
    if found then
      return jsonb_build_object('ok', true, 'replayed', true, 'id', existing.id);
    end if;
  end if;
  select name into lname from public.listings where guesty_id = p_listing_id and in_scope;
  if lname is null then
    return jsonb_build_object('ok', false, 'status', 'bad_listing');
  end if;
  if p_date is null or p_date < public.today_ba() - 1 or p_date > public.today_ba() + 60 then
    return jsonb_build_object('ok', false, 'status', 'bad_date');
  end if;
  if p_departure is null or char_length(p_departure) <> 5 or p_departure !~ '^([01][0-9]|2[0-3]):[0-5][0-9]' then
    return jsonb_build_object('ok', false, 'status', 'bad_time');
  end if;
  -- one entry per flat and day: remove the old one to change the time
  if exists (select 1 from public.early_departures where listing_id = p_listing_id and date = p_date and removed_at is null) then
    return jsonb_build_object('ok', false, 'status', 'duplicate');
  end if;
  select display_name into me_name from public.profiles where id = me;
  insert into public.early_departures (listing_id, listing_name, date, departure, note, author, author_name, client_action_id)
  values (p_listing_id, lname, p_date, p_departure, clean_note, me, coalesce(me_name, '—'), p_action_id)
  returning * into row;
  return jsonb_build_object('ok', true, 'id', row.id);
end $fn$;

create or replace function public.remove_early_departure(p_id uuid, p_action_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare
  me uuid := auth.uid();
  me_name text;
  row public.early_departures;
begin
  if not public.is_active_user() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into row from public.early_departures where id = p_id for update;
  if not found then
    raise exception 'early departure not found' using errcode = 'P0002';
  end if;
  if row.removed_at is not null then
    return jsonb_build_object('ok', true, 'replayed', true);
  end if;
  if row.author is distinct from me and not public.is_admin() then
    return jsonb_build_object('ok', false, 'status', 'not_author');
  end if;
  select display_name into me_name from public.profiles where id = me;
  update public.early_departures
    set removed_at = now(), removed_by = me, removed_by_name = coalesce(me_name, '—')
    where id = p_id;
  return jsonb_build_object('ok', true);
end $fn$;

revoke execute on function public.add_early_departure(text, date, text, text, uuid) from public, anon;
revoke execute on function public.remove_early_departure(uuid, uuid) from public, anon;
grant execute on function public.add_early_departure(text, date, text, text, uuid) to authenticated;
grant execute on function public.remove_early_departure(uuid, uuid) to authenticated;

drop trigger if exists early_departures_notify on public.early_departures;
create trigger early_departures_notify after insert or update or delete on public.early_departures
  for each row execute function public.notify_board();
