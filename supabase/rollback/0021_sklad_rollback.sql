-- Návrat migrácie 0021_sklad.sql (NEJDE do supabase/migrations: spúšťa sa ručne, len po rozhodnutí).
--
-- Krok A (bezpečný, vždy najprv): vráti balenie a "Späť" na pôvodné definície z 0011 a 0006.
-- Sklad ostane v databáze nedotknutý (len sa prestane napájať na balenie). Odpočty sa zároveň vypnú.
-- Krok B (deštruktívny): zmaže všetky skladové objekty a dáta. Spúšťaj len ak je sklad naozaj nepotrebný,
-- najprv si urob export (CSV z obrazoviek Sklad alebo kópiu tabuliek stock_*).

-- ---------------------------------------------------------------- krok A
update public.stock_config set deduction_enabled = false, updated_at = now() where id;

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

-- ---------------------------------------------------------------- krok B (deštruktívny, v SQL editore označ a spusti samostatne)
-- drop view if exists public.stock_incoming, public.stock_on_hand;
-- drop table if exists public.stock_receipt_lines, public.stock_receipts, public.stock_order_events, public.stock_order_lines, public.stock_orders,
--   public.stock_inventory_lines, public.stock_inventories, public.stock_discrepancies, public.stock_issue_errors, public.stock_unmapped_issues,
--   public.stock_movements, public.stock_issue_batches, public.stock_aliases, public.stock_supplier_skus, public.stock_items, public.stock_warehouses,
--   public.stock_audit, public.stock_config cascade;
-- drop function if exists public.stock_issue_for_package(uuid, bigint, jsonb, uuid, text, timestamptz), public.stock_note_unpack(uuid), public.stock_retry_issue(bigint),
--   public.stock_confirm_return(uuid, jsonb, text, uuid), public.stock_resolve_discrepancy(bigint, text), public.stock_record_movement(uuid, uuid, text, int, text, timestamptz, text, uuid),
--   public.stock_transfer(uuid, uuid, uuid, int, text, uuid), public.stock_save_warehouse(jsonb), public.stock_save_item(jsonb), public.stock_save_sku(jsonb),
--   public.stock_save_alias(text, text, uuid, int), public.stock_seed_catalog(), public.stock_inventory_open(uuid, date, text, uuid),
--   public.stock_inventory_save_line(uuid, uuid, int, int, boolean, text, uuid, text, text), public.stock_inventory_close(uuid, timestamptz, uuid),
--   public.stock_inventory_approve(uuid), public.stock_backfill_since_baseline(), public.stock_set_deduction(boolean), public.stock_set_approvers(uuid[]),
--   public.stock_units_for(int, int, text, int, int), public.stock_order_create(text, date, jsonb, text, uuid), public.stock_order_step(uuid, text, uuid),
--   public.stock_order_mark_exported(uuid, text, uuid), public.stock_order_mark_sent(uuid, text, text, text, uuid), public.stock_order_reconcile_send(uuid, text, text, uuid),
--   public.stock_order_confirm(uuid, text, uuid), public.stock_order_receive(uuid, jsonb, text, uuid), public.stock_plan(jsonb), public.stock_plan_unmapped(jsonb),
--   public.stock_snapshot_rows(jsonb), public.stock_is_approver(), public.stock_me_name(), public.stock_log(text, text, text, jsonb), public.stock_append_only();
