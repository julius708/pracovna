-- Packing history (owner request 2026-10-10: "who packed and how much of what").
-- The "packed" audit event now records the card as it was at that moment:
-- people, linen, consumables and capsules from computed_items. Later recomputes
-- change the package, never the event, so the history keeps what was really packed.
-- Everything else in pack_package is unchanged from 0006.

create or replace function public.pack_package(p_id uuid, p_action_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  me_name text;
  row public.packages;
  snapshot jsonb;
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
  if not public.staff_may_change(row) then
    return jsonb_build_object('ok', false, 'status', 'out_of_window');
  end if;
  if row.status = 'packed' then
    return jsonb_build_object('ok', false, 'already_packed', true, 'packed_by_name', row.packed_by_name, 'status', row.status);
  end if;
  if row.status <> 'todo' then
    return jsonb_build_object('ok', false, 'status', row.status);
  end if;
  snapshot := jsonb_build_object(
    'people', row.target_people,
    'linen', coalesce(row.computed_items -> 'linen', '[]'::jsonb),
    'consumables', coalesce(row.computed_items -> 'consumables', '[]'::jsonb),
    'capsules', coalesce(row.computed_items -> 'capsules', '[]'::jsonb),
    'private', coalesce(row.computed_items -> 'private', 'false'::jsonb)
  );
  perform set_config('app.write_scope', 'staff', true);
  update public.packages set
    status = 'packed', packed_by = me, packed_by_name = me_name, packed_at = now(), packed_hash = computed_hash
  where id = p_id;
  insert into public.package_events (package_id, package_date, listing_id, listing_name, event, actor, actor_name, client_action_id, data)
  values (p_id, row.date, row.listing_id, row.listing_name, 'packed', me, coalesce(me_name, '—'), p_action_id, snapshot);
  return jsonb_build_object('ok', true, 'status', 'packed', 'packed_by_name', me_name);
end $$;
