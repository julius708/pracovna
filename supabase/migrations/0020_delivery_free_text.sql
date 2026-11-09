-- "Pre Angeliku" as one free-text field (Martina, 2026-11-09): the flat is
-- written into the text by hand, no flat picker. The flat columns become
-- optional and add_delivery_request takes no flat (a given one is still
-- checked). Nothing is removed; existing rows keep their flat.
-- No bare dollar sign outside the function body: the Supabase SQL editor
-- splits the script on it.

alter table public.delivery_requests alter column listing_id drop not null;
alter table public.delivery_requests alter column listing_name drop not null;

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
  if p_listing_id is not null and p_listing_id <> '' then
    select name into lname from public.listings where guesty_id = p_listing_id and in_scope;
    if lname is null then
      return jsonb_build_object('ok', false, 'status', 'bad_listing');
    end if;
  end if;
  select display_name into me_name from public.profiles where id = me;
  insert into public.delivery_requests (date, listing_id, listing_name, text, author, author_name, client_action_id)
  values (p_date, nullif(p_listing_id, ''), lname, clean, me, coalesce(me_name, '—'), p_action_id)
  returning * into row;
  return jsonb_build_object('ok', true, 'id', row.id);
end $fn$;

revoke execute on function public.add_delivery_request(date, text, text, uuid) from public, anon;
grant execute on function public.add_delivery_request(date, text, text, uuid) to authenticated;
