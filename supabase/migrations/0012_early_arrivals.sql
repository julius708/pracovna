-- "Skoré príchody" (owner request 2026-10-11): when a guest arrives before
-- 16:00 the office records it in the app, in its own box under the notice
-- board, for the arrival day. Everyone who opens the board sees it, the flat's
-- card for that day shows it, and every open device gets a notice. Any active
-- user may add an entry; the author's name and time are recorded; the author or
-- an admin removes it (removed rows stay for the record). Writes go only
-- through the two RPCs; every change is broadcast on the "board" topic.

create table if not exists public.early_arrivals (
  id uuid primary key default gen_random_uuid(),
  listing_id text not null,
  listing_name text not null,
  -- the arrival day (Bratislava calendar date)
  date date not null,
  -- "HH:MM"
  arrival text not null check (arrival ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
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
create index if not exists early_arrivals_active on public.early_arrivals (date, arrival) where removed_at is null;

alter table public.early_arrivals enable row level security;
drop policy if exists early_arrivals_select on public.early_arrivals;
create policy early_arrivals_select on public.early_arrivals for select to authenticated
  using (public.is_active_user() and (removed_at is null or public.is_admin()));
revoke all on public.early_arrivals from public, anon;
revoke insert, update, delete, truncate, references, trigger on public.early_arrivals from authenticated;
grant select on public.early_arrivals to authenticated;

create or replace function public.add_early_arrival(p_listing_id text, p_date date, p_arrival text, p_note text, p_action_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  me_name text;
  lname text;
  clean_note text := left(btrim(coalesce(p_note, '')), 300);
  existing public.early_arrivals;
  row public.early_arrivals;
begin
  if not public.is_active_user() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_action_id is not null then
    select * into existing from public.early_arrivals where client_action_id = p_action_id;
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
  if p_arrival is null or p_arrival !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    return jsonb_build_object('ok', false, 'status', 'bad_time');
  end if;
  -- one entry per flat and day: remove the old one to change the time
  if exists (select 1 from public.early_arrivals where listing_id = p_listing_id and date = p_date and removed_at is null) then
    return jsonb_build_object('ok', false, 'status', 'duplicate');
  end if;
  select display_name into me_name from public.profiles where id = me;
  insert into public.early_arrivals (listing_id, listing_name, date, arrival, note, author, author_name, client_action_id)
  values (p_listing_id, lname, p_date, p_arrival, clean_note, me, coalesce(me_name, '—'), p_action_id)
  returning * into row;
  return jsonb_build_object('ok', true, 'id', row.id);
end $$;

create or replace function public.remove_early_arrival(p_id uuid, p_action_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  me_name text;
  row public.early_arrivals;
begin
  if not public.is_active_user() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into row from public.early_arrivals where id = p_id for update;
  if not found then
    raise exception 'early arrival not found' using errcode = 'P0002';
  end if;
  if row.removed_at is not null then
    return jsonb_build_object('ok', true, 'replayed', true);
  end if;
  if row.author is distinct from me and not public.is_admin() then
    return jsonb_build_object('ok', false, 'status', 'not_author');
  end if;
  select display_name into me_name from public.profiles where id = me;
  update public.early_arrivals
    set removed_at = now(), removed_by = me, removed_by_name = coalesce(me_name, '—')
    where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

revoke execute on function public.add_early_arrival(text, date, text, text, uuid) from public, anon;
revoke execute on function public.remove_early_arrival(uuid, uuid) from public, anon;
grant execute on function public.add_early_arrival(text, date, text, text, uuid) to authenticated;
grant execute on function public.remove_early_arrival(uuid, uuid) to authenticated;

drop trigger if exists early_arrivals_notify on public.early_arrivals;
create trigger early_arrivals_notify after insert or update or delete on public.early_arrivals
  for each row execute function public.notify_board();
