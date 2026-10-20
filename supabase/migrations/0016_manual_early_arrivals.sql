-- "Skoré príchody" are typed in again (Martina, 2026-10-19): the box is a field
-- the office writes into, no longer filled from Guesty. The sync stops writing
-- early_arrivals (src/sync/recompute.ts); the board shows only the rows people
-- wrote (source 'manual'); the rows the sync derived earlier (source 'guesty')
-- stay in the table for the record and are simply not shown. The two RPCs of
-- 0012 come back, writing source 'manual'. A notification goes to the other
-- devices when an entry is added (server action, src/app/_lib/actions.ts).

alter table public.early_arrivals alter column source set default 'manual';

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
  if exists (select 1 from public.early_arrivals where listing_id = p_listing_id and date = p_date and removed_at is null and source = 'manual') then
    return jsonb_build_object('ok', false, 'status', 'duplicate');
  end if;
  select display_name into me_name from public.profiles where id = me;
  insert into public.early_arrivals (listing_id, listing_name, date, arrival, note, author, author_name, client_action_id, source)
  values (p_listing_id, lname, p_date, p_arrival, clean_note, me, coalesce(me_name, '—'), p_action_id, 'manual')
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
