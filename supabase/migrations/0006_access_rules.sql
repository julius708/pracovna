-- Access rules from the UI/security review (2026-10-02).
--
-- 1. A deactivated user may read their own profile row, so the app can show
--    "Účet je deaktivovaný." instead of bouncing between / and /login. Every
--    other row still needs an active profile.
-- 2. An admin cannot deactivate or demote their own account. Because every
--    caller of admin_set_profile is an active admin, this is also the only way
--    the last admin could disappear.
-- 3. The staff RPCs accept only the rows the board shows to staff: visible rows
--    from yesterday to the day after tomorrow (Bratislava). Admins may touch any
--    row. This mirrors the packages_select policy. The result for a refused row
--    is {ok:false, status:'out_of_window'}.
--
-- CREATE OR REPLACE keeps the grants from 0004/0005.

-- ---------------------------------------------------------------- 1. own profile row
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_active_user());

-- ---------------------------------------------------------------- 2. no self lock-out
create or replace function public.admin_set_profile(p_id uuid, p_role text, p_active boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  cur public.profiles;
  new_role text;
  new_active boolean;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  select * into cur from public.profiles where id = p_id for update;
  if not found then
    raise exception 'profile not found' using errcode = 'P0002';
  end if;
  new_role := coalesce(p_role, cur.role);
  new_active := coalesce(p_active, cur.active);
  if p_id = auth.uid() and (new_role <> 'admin' or not new_active) then
    raise exception 'self_change: an admin cannot deactivate or demote their own account' using errcode = 'P0001';
  end if;
  update public.profiles set role = new_role, active = new_active where id = p_id;
end $$;

-- ---------------------------------------------------------------- 3. staff RPCs act only inside the visible window
create or replace function public.staff_may_change(p public.packages) returns boolean
language sql stable set search_path = '' as $$
  select public.is_admin() or (not p.hidden and p.date between public.today_ba() - 1 and public.today_ba() + 2)
$$;
revoke execute on function public.staff_may_change(public.packages) from public, anon, authenticated;

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
  if not public.staff_may_change(row) then
    return jsonb_build_object('ok', false, 'status', 'out_of_window');
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
  if not public.staff_may_change(row) then
    return jsonb_build_object('ok', false, 'status', 'out_of_window');
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
  if not public.staff_may_change(row) then
    return jsonb_build_object('ok', false, 'status', 'out_of_window');
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
  if not public.staff_may_change(row) then
    return jsonb_build_object('ok', false, 'status', 'out_of_window');
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
