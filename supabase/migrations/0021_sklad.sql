-- "Sklad v appke" (zadanie 17. 11. 2026): prepojený sklad, inventúra a objednávky.
--
-- NÁVRH NA REVIEW: súbor NIE JE nasadený do produkcie. Je čisto aditívny a po nasadení
-- nič nemení v prevádzke: odpočty zo skladu sú VYPNUTÉ (stock_config.deduction_enabled =
-- false) a dajú sa zapnúť až po schválenej začiatočnej inventúre (nie k dátumu).
--
--  1. Kniha pohybov (stock_movements) je append-only. Fyzický výdaj má jedinečný kľúč
--     (unique_key), takže opakovanie, dvojklik, viac zariadení alebo synchronizácia nikdy
--     neodpočítajú dvakrát.
--  2. "Zabalené" vydá zo skladu v tej istej transakcii, a to zo snapshotu uloženého v
--     udalosti 'packed' (package_events.data), nie z prepočítaných potrieb.
--  3. "Späť" (unpack) NEvracia tovar. Dávka výdaja ide do stavu return_pending a vznikne
--     nezrovnalosť na kontrolu. Skutočný návrat potvrdí stock_confirm_return; až potom
--     môže nové zabalenie otvoriť nový cyklus výdaja. História sa nikdy nepremazáva.
--  4. Stav zásob = súčet pohybov od začiatočného stavu (opening_balance). Staršie výdaje sa
--     nikdy nedopočítavajú. Spätné doplnenie (backfill) pri zapnutí berie len balenia
--     po čase uzávierky inventúry a je idempotentné.
--  5. Neoverený prepočet balení (kusov v balení) = "Neoverené": nič sa z neho nepočíta.
--  6. Oprávnenia sa vynucujú v DB (rovnaké roly ako doteraz: profiles.role staff/admin).
--     Personál: zabalí a zapíše výdaj/poškodenie/vrátenie. Správca (koordinátor): inventúra,
--     katalóg, príjem, presuny. Schvaľovateľ objednávok: správca zo zoznamu
--     stock_config.order_approvers (prázdny zoznam = každý správca).
--
-- Žiadne holé znaky dolára mimo tiel funkcií: SQL editor Supabase skript podľa nich delí.

-- ---------------------------------------------------------------- konfigurácia
create table if not exists public.stock_config (
  id boolean primary key default true check (id),
  deduction_enabled boolean not null default false,
  baseline_inventory_id uuid,
  baseline_at timestamptz,
  order_approvers uuid[] not null default '{}',
  -- true = chyba pri výdaji zo skladu zruší aj zabalenie (prísna atomicita); false (predvolené) = balenie hostí nikdy nezablokuje
  strict_atomic boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
insert into public.stock_config (id) values (true) on conflict (id) do nothing;

-- ---------------------------------------------------------------- katalóg
create table if not exists public.stock_warehouses (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  city text not null default 'Bratislava',
  -- warehouse = bežný sklad, clean = čistá bielizeň, flats = zabalené v bytoch, laundry = práčovňa, damaged = poškodené
  kind text not null default 'warehouse' check (kind in ('warehouse', 'clean', 'flats', 'laundry', 'damaged')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (name, city)
);

create table if not exists public.stock_items (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('consumable', 'capsule', 'linen')),
  product text not null check (char_length(product) between 1 and 160),
  category text not null default '',
  -- veľkosť, hrúbka, typ rolky...: iný variant je iná karta
  variant text,
  -- kávový systém: Nespresso Original, Nespresso Vertuo, Tchibo Cafissimo, L'OR Tassimo sú oddelené karty
  system text,
  base_unit text not null default 'ks' check (base_unit in ('ks', 'rolka', 'ml', 'g')),
  -- z ktorého skladu sa pri balení vydáva
  home_warehouse_id uuid references public.stock_warehouses(id),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists stock_items_identity on public.stock_items (product, coalesce(variant, ''), coalesce(system, ''));

-- ponuka dodávateľa, verzovaná platnosťou (dodávateľ môže balenie v čase zmeniť)
create table if not exists public.stock_supplier_skus (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.stock_items(id),
  supplier text not null check (char_length(supplier) between 1 and 160),
  sku text,
  purchase_unit text not null default 'pack' check (purchase_unit in ('pack', 'carton')),
  pieces_per_pack int check (pieces_per_pack is null or pieces_per_pack > 0),
  packs_per_carton int check (packs_per_carton is null or packs_per_carton > 0),
  price_cents int check (price_cents is null or price_cents >= 0),
  currency text not null default 'EUR',
  vat_rate numeric(5, 4) check (vat_rate is null or (vat_rate >= 0 and vat_rate < 1)),
  valid_from date not null,
  valid_to date,
  min_order int check (min_order is null or min_order > 0),
  lead_time_days int check (lead_time_days is null or lead_time_days >= 0),
  -- bez zdroja a dátumu overenia je prepočet "Neoverené"
  verified_source text,
  verified_at date,
  created_at timestamptz not null default now(),
  check (valid_to is null or valid_to >= valid_from),
  unique (item_id, supplier, valid_from)
);
create index if not exists stock_skus_item on public.stock_supplier_skus (item_id, valid_from);

-- priradenie riadku zo snapshotu karty ku skladovej karte (dáta, nie kód; nič sa nehádá)
--   consumable: key | capsule: normalizovaný typeKey | linen: key|veľkosť
create table if not exists public.stock_aliases (
  kind text not null check (kind in ('consumable', 'capsule', 'linen')),
  source_key text not null check (source_key <> ''),
  item_id uuid not null references public.stock_items(id),
  factor int not null default 1 check (factor > 0),
  primary key (kind, source_key)
);

-- ---------------------------------------------------------------- dávky výdaja
create table if not exists public.stock_issue_batches (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references public.packages(id),
  package_date date not null,
  listing_id text not null,
  -- 'packed' udalosť, z ktorej dávka vznikla (jedinečná: jedno zabalenie = jedna dávka)
  packed_event_id bigint not null unique,
  status text not null default 'issued' check (status in ('issued', 'return_pending', 'returned', 'closed_kept')),
  snapshot jsonb not null,
  -- čo dávka drží: {item_id: množstvo v základnej jednotke}
  held jsonb not null default '{}',
  opened_at timestamptz not null default now(),
  closed_at timestamptz
);
-- na balíku môže byť naraz najviac jedna otvorená dávka
create unique index if not exists stock_batches_one_open on public.stock_issue_batches (package_id) where status in ('issued', 'return_pending');

create table if not exists public.stock_movements (
  id bigint generated always as identity primary key,
  item_id uuid not null references public.stock_items(id),
  warehouse_id uuid not null references public.stock_warehouses(id),
  kind text not null check (kind in ('opening_balance', 'receipt', 'issue_package', 'issue_flat', 'issue_manual', 'return',
    'transfer_out', 'transfer_in', 'damage', 'inventory_difference', 'linen_issue', 'linen_return')),
  -- so znamienkom, v základnej jednotke
  qty int not null check (qty <> 0 or kind = 'opening_balance'),
  occurred_at timestamptz not null default now(),
  booked_at timestamptz not null default now(),
  actor uuid,
  actor_name text not null default '—',
  reason text,
  source_type text,
  source_id text,
  -- jedinečný fyzický výdaj/príjem: druhý pokus je bez účinku
  unique_key text unique,
  client_action_id uuid,
  batch_id uuid references public.stock_issue_batches(id),
  listing_id text,
  meta jsonb not null default '{}'
);
create index if not exists stock_movements_item on public.stock_movements (item_id, warehouse_id, occurred_at);
create index if not exists stock_movements_time on public.stock_movements (occurred_at desc);
create unique index if not exists stock_movements_action on public.stock_movements (client_action_id, item_id, kind, qty) where client_action_id is not null;

create or replace function public.stock_append_only() returns trigger
language plpgsql as $fn$
begin
  raise exception '% is append-only (opravy len novým pohybom)', tg_table_name using errcode = '42501';
end $fn$;
drop trigger if exists stock_movements_immutable on public.stock_movements;
create trigger stock_movements_immutable before update or delete on public.stock_movements
  for each row execute function public.stock_append_only();

-- riadky snapshotu, ktoré sa nedali vydať (bez priradenia, neurčený druh kávy...): na kontrolu, nikdy odhad
create table if not exists public.stock_unmapped_issues (
  id bigint generated always as identity primary key,
  packed_event_id bigint not null,
  package_id uuid not null,
  source_kind text not null,
  source_key text not null,
  label text not null,
  n numeric not null,
  reason text not null,
  created_at timestamptz not null default now(),
  unique (packed_event_id, source_kind, source_key)
);

-- chyba pri výdaji nikdy nezablokuje balenie hostí; ide do fronty a opakuje sa idempotentne
create table if not exists public.stock_issue_errors (
  id bigint generated always as identity primary key,
  packed_event_id bigint not null,
  package_id uuid not null,
  error text not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create unique index if not exists stock_issue_errors_open on public.stock_issue_errors (packed_event_id) where resolved_at is null;

-- nezrovnalosti: Späť bez vrátenia, prebytok po zmene požiadavky, čiastočné vrátenie
create table if not exists public.stock_discrepancies (
  id bigint generated always as identity primary key,
  batch_id uuid not null references public.stock_issue_batches(id),
  kind text not null check (kind in ('unpack_without_return', 'surplus_after_repack', 'partial_return')),
  item_id uuid references public.stock_items(id),
  qty int,
  status text not null default 'open' check (status in ('open', 'resolved')),
  resolution text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid,
  resolved_by_name text
);
create unique index if not exists stock_discrepancies_open_unpack on public.stock_discrepancies (batch_id, kind) where status = 'open' and item_id is null;

-- ---------------------------------------------------------------- inventúra
create table if not exists public.stock_inventories (
  id uuid primary key default gen_random_uuid(),
  title text not null default '',
  -- dátum určuje správca (Július)
  inventory_date date not null,
  warehouse_id uuid not null references public.stock_warehouses(id),
  status text not null default 'draft' check (status in ('draft', 'closed', 'approved')),
  cut_at timestamptz,
  created_by uuid,
  created_by_name text not null default '—',
  created_at timestamptz not null default now(),
  closed_by_name text,
  closed_at timestamptz,
  approved_by uuid,
  approved_by_name text,
  approved_at timestamptz,
  client_action_id uuid unique
);

create table if not exists public.stock_inventory_lines (
  id bigint generated always as identity primary key,
  inventory_id uuid not null references public.stock_inventories(id),
  item_id uuid not null references public.stock_items(id),
  shelf text not null default '',
  packs int check (packs is null or packs >= 0),
  loose int check (loose is null or loose >= 0),
  verified_zero boolean not null default false,
  sku_id uuid references public.stock_supplier_skus(id),
  -- prepočet použitý pri počítaní (snapshot)
  pieces_per_pack int,
  total int,
  -- unset = nechané prázdne (NIE nula); zero = overená nula; counted; unverified = balenia bez overeného prepočtu
  state text not null default 'unset' check (state in ('unset', 'zero', 'counted', 'unverified')),
  counted_by uuid,
  counted_by_name text,
  counted_at timestamptz not null default now(),
  source text not null default 'app',
  note text not null default '',
  unique (inventory_id, item_id, shelf)
);

-- ---------------------------------------------------------------- objednávky
create table if not exists public.stock_orders (
  id uuid primary key default gen_random_uuid(),
  supplier text not null,
  status text not null default 'draft' check (status in ('draft', 'review', 'approved', 'sent', 'confirmed', 'partially_received', 'received', 'cancelled')),
  delivery_target_date date,
  note text not null default '',
  created_by uuid,
  created_by_name text not null default '—',
  created_at timestamptz not null default now(),
  approved_by uuid,
  approved_by_name text,
  approved_at timestamptz,
  -- not_sent = nič neodišlo (export/pripravený e-mail neznamená odoslané)
  send_state text not null default 'not_sent' check (send_state in ('not_sent', 'sent', 'ambiguous')),
  send_method text check (send_method in ('export', 'email', 'api')),
  sent_at timestamptz,
  supplier_ref text,
  confirmed_at timestamptz,
  client_action_id uuid unique
);

create table if not exists public.stock_order_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.stock_orders(id),
  item_id uuid not null references public.stock_items(id),
  sku_id uuid not null references public.stock_supplier_skus(id),
  need_base int not null check (need_base >= 0),
  reserve_base int not null default 0 check (reserve_base >= 0),
  usable_base int not null default 0,
  incoming_base int not null default 0 check (incoming_base >= 0),
  raw_base int not null,
  suggested_units int not null,
  final_units int not null check (final_units >= 0),
  packs int not null,
  pieces_per_pack int not null check (pieces_per_pack > 0),
  purchase_unit text not null,
  price_cents int,
  currency text not null default 'EUR',
  basis text not null,
  manual_reason text
);

create table if not exists public.stock_order_events (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.stock_orders(id),
  event text not null,
  actor uuid,
  actor_name text not null default '—',
  data jsonb not null default '{}',
  created_at timestamptz not null default now(),
  client_action_id uuid unique
);

create table if not exists public.stock_receipts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.stock_orders(id),
  received_at timestamptz not null default now(),
  received_by uuid,
  received_by_name text not null default '—',
  note text not null default '',
  client_action_id uuid unique
);
create table if not exists public.stock_receipt_lines (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.stock_receipts(id),
  order_line_id uuid not null references public.stock_order_lines(id),
  packs int not null check (packs > 0),
  base_qty int not null check (base_qty > 0)
);

create table if not exists public.stock_audit (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid,
  actor_name text not null default '—',
  action text not null,
  entity text not null,
  entity_id text,
  data jsonb not null default '{}'
);
drop trigger if exists stock_audit_immutable on public.stock_audit;
create trigger stock_audit_immutable before update or delete on public.stock_audit
  for each row execute function public.stock_append_only();
drop trigger if exists stock_order_events_immutable on public.stock_order_events;
create trigger stock_order_events_immutable before update or delete on public.stock_order_events
  for each row execute function public.stock_append_only();

-- ---------------------------------------------------------------- pomocné funkcie
create or replace function public.stock_is_approver() returns boolean
language sql stable security definer set search_path = '' as $fn$
  select public.is_admin() and (
    cardinality(coalesce((select order_approvers from public.stock_config where id), '{}'::uuid[])) = 0
    or auth.uid() = any (coalesce((select order_approvers from public.stock_config where id), '{}'::uuid[]))
  )
$fn$;

create or replace function public.stock_me_name() returns text
language sql stable security definer set search_path = '' as $fn$
  select coalesce((select display_name from public.profiles where id = auth.uid()), '—')
$fn$;

create or replace function public.stock_log(p_action text, p_entity text, p_entity_id text, p_data jsonb) returns void
language plpgsql security definer set search_path = '' as $fn$
begin
  insert into public.stock_audit (actor, actor_name, action, entity, entity_id, data)
  values (auth.uid(), public.stock_me_name(), p_action, p_entity, p_entity_id, coalesce(p_data, '{}'::jsonb));
end $fn$;

-- riadky snapshotu 'packed' udalosti v jednotnom tvare
create or replace function public.stock_snapshot_rows(p_snapshot jsonb) returns table (kind text, skey text, label text, n numeric, state text)
language sql immutable set search_path = '' as $fn$
  select 'consumable'::text, coalesce(c ->> 'key', ''), coalesce(c ->> 'label', c ->> 'key', ''),
         case when (c ->> 'n') ~ '^[0-9]+(\.[0-9]+)?$' then (c ->> 'n')::numeric else 0 end, 'ok'::text
    from jsonb_array_elements(coalesce(p_snapshot -> 'consumables', '[]'::jsonb)) c
  union all
  select 'capsule', coalesce(c ->> 'typeKey', ''), coalesce(nullif(c ->> 'type', ''), 'kapsuly'),
         case when (c ->> 'n') ~ '^[0-9]+(\.[0-9]+)?$' then (c ->> 'n')::numeric else 0 end, coalesce(c ->> 'state', 'ok')
    from jsonb_array_elements(coalesce(p_snapshot -> 'capsules', '[]'::jsonb)) c
  union all
  select 'linen', coalesce(l ->> 'key', '') || case when coalesce(l ->> 'size', '') <> '' then '|' || (l ->> 'size') else '' end,
         coalesce(l ->> 'label', l ->> 'key', ''),
         case when (l ->> 'n') ~ '^[0-9]+(\.[0-9]+)?$' then (l ->> 'n')::numeric else 0 end, 'ok'
    from jsonb_array_elements(coalesce(p_snapshot -> 'linen', '[]'::jsonb)) l
$fn$;

-- čo sa zo snapshotu vydá: len namapované riadky s kartou aj skladom
create or replace function public.stock_plan(p_snapshot jsonb) returns table (item_id uuid, warehouse_id uuid, item_kind text, qty int)
language sql stable set search_path = '' as $fn$
  select a.item_id, i.home_warehouse_id, i.kind, sum(s.n * a.factor)::int
    from public.stock_snapshot_rows(p_snapshot) s
    join public.stock_aliases a on a.kind = s.kind and a.source_key = s.skey
    join public.stock_items i on i.id = a.item_id and i.active and i.home_warehouse_id is not null
   where s.n > 0 and s.state = 'ok' and s.skey <> ''
   group by a.item_id, i.home_warehouse_id, i.kind
  having sum(s.n * a.factor) > 0
$fn$;

-- čo sa vydať nedá (bez priradenia, neurčený druh, karta bez skladu): ide na kontrolu
create or replace function public.stock_plan_unmapped(p_snapshot jsonb) returns table (kind text, skey text, label text, n numeric, reason text)
language sql stable set search_path = '' as $fn$
  select s.kind, s.skey, s.label, s.n,
         case when s.state <> 'ok' or s.skey = '' then 'druh nie je určený'
              when not exists (select 1 from public.stock_aliases a where a.kind = s.kind and a.source_key = s.skey) then 'bez priradenia ku skladovej karte'
              else 'karta nemá sklad alebo je neaktívna' end
    from public.stock_snapshot_rows(p_snapshot) s
   where s.n > 0
     and (s.state <> 'ok' or s.skey = ''
          or not exists (select 1 from public.stock_aliases a join public.stock_items i on i.id = a.item_id and i.active and i.home_warehouse_id is not null
                          where a.kind = s.kind and a.source_key = s.skey))
$fn$;

-- ---------------------------------------------------------------- výdaj pri zabalení (interná funkcia)
create or replace function public.stock_issue_for_package(p_package_id uuid, p_event_id bigint, p_snapshot jsonb, p_actor uuid, p_actor_name text, p_at timestamptz) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare
  cfg public.stock_config;
  pk public.packages;
  b public.stock_issue_batches;
  r record;
  held_new jsonb;
  prev jsonb;
  d int;
  flats uuid;
  moved int := 0;
  ukey text;
  mkind text;
begin
  -- zdieľaný zámok: zapnutie odpočtov (for update) počká na rozbehnuté balenia
  select * into cfg from public.stock_config where id for share;
  if not cfg.deduction_enabled or cfg.baseline_at is null or p_at < cfg.baseline_at then
    return jsonb_build_object('issued', false, 'reason', 'off');
  end if;
  select * into pk from public.packages where id = p_package_id;

  select * into b from public.stock_issue_batches where package_id = p_package_id and status in ('issued', 'return_pending') for update;
  if b.id is null then
    insert into public.stock_issue_batches (package_id, package_date, listing_id, packed_event_id, snapshot, opened_at)
    values (p_package_id, pk.date, pk.listing_id, p_event_id, p_snapshot, p_at)
    on conflict (packed_event_id) do nothing
    returning * into b;
    if b.id is null then
      return jsonb_build_object('issued', false, 'reason', 'replay');
    end if;
    held_new := '{}'::jsonb;
    for r in select * from public.stock_plan(p_snapshot) loop
      mkind := case when r.item_kind = 'linen' then 'linen_issue' else 'issue_package' end;
      ukey := 'pkg:' || p_event_id || ':' || r.item_id;
      insert into public.stock_movements (item_id, warehouse_id, kind, qty, occurred_at, actor, actor_name, reason, source_type, source_id, unique_key, batch_id, listing_id)
      values (r.item_id, r.warehouse_id, mkind, -r.qty, p_at, p_actor, coalesce(p_actor_name, '—'), 'zabalené', 'package_event', p_event_id::text, ukey, b.id, pk.listing_id)
      on conflict (unique_key) do nothing;
      held_new := held_new || jsonb_build_object(r.item_id::text, r.qty);
      moved := moved + 1;
      -- posteľná bielizeň sa len presúva do bytov (nie je to spotreba ani nákup)
      if r.item_kind = 'linen' then
        select w2.id into flats from public.stock_warehouses w1 join public.stock_warehouses w2 on w2.city = w1.city and w2.kind = 'flats' and w2.active
         where w1.id = r.warehouse_id order by w2.name limit 1;
        if flats is not null then
          insert into public.stock_movements (item_id, warehouse_id, kind, qty, occurred_at, actor, actor_name, reason, source_type, source_id, unique_key, batch_id, listing_id)
          values (r.item_id, flats, 'transfer_in', r.qty, p_at, p_actor, coalesce(p_actor_name, '—'), 'zabalené do bytu', 'package_event', p_event_id::text, ukey || ':flat', b.id, pk.listing_id)
          on conflict (unique_key) do nothing;
        end if;
      end if;
    end loop;
    update public.stock_issue_batches set held = held_new where id = b.id;
  else
    if b.packed_event_id = p_event_id then
      return jsonb_build_object('issued', false, 'reason', 'replay');
    end if;
    -- opakované zabalenie na otvorenej dávke (Späť bez vrátenia): vydá sa len doplnenie
    prev := b.held;
    held_new := b.held;
    for r in select * from public.stock_plan(p_snapshot) loop
      d := r.qty - coalesce((prev ->> r.item_id::text)::int, 0);
      if d > 0 then
        mkind := case when r.item_kind = 'linen' then 'linen_issue' else 'issue_package' end;
        insert into public.stock_movements (item_id, warehouse_id, kind, qty, occurred_at, actor, actor_name, reason, source_type, source_id, unique_key, batch_id, listing_id)
        values (r.item_id, r.warehouse_id, mkind, -d, p_at, p_actor, coalesce(p_actor_name, '—'), 'doplnenie po zmene požiadavky', 'package_event', p_event_id::text,
                'pkg:' || p_event_id || ':' || r.item_id || ':x', b.id, pk.listing_id)
        on conflict (unique_key) do nothing;
        held_new := held_new || jsonb_build_object(r.item_id::text, coalesce((prev ->> r.item_id::text)::int, 0) + d);
        moved := moved + 1;
      elsif d < 0 then
        insert into public.stock_discrepancies (batch_id, kind, item_id, qty) values (b.id, 'surplus_after_repack', r.item_id, -d);
      end if;
    end loop;
    -- položky, ktoré nové zabalenie už nepotrebuje, ostávajú v dávke ako prebytok na potvrdené vrátenie
    for r in select k as item_id, v::int as qty from jsonb_each_text(prev) as e(k, v)
              where not exists (select 1 from public.stock_plan(p_snapshot) p where p.item_id::text = e.k) loop
      insert into public.stock_discrepancies (batch_id, kind, item_id, qty) values (b.id, 'surplus_after_repack', r.item_id::uuid, r.qty);
    end loop;
    update public.stock_issue_batches set held = held_new, status = 'issued', snapshot = p_snapshot where id = b.id;
  end if;

  insert into public.stock_unmapped_issues (packed_event_id, package_id, source_kind, source_key, label, n, reason)
  select p_event_id, p_package_id, u.kind, u.skey, u.label, u.n, u.reason from public.stock_plan_unmapped(p_snapshot) u
  on conflict (packed_event_id, source_kind, source_key) do nothing;

  return jsonb_build_object('issued', true, 'batch_id', b.id, 'movements', moved);
end $fn$;

-- Späť: tovar sa fyzicky nevrátil, dávka čaká na potvrdenie vrátenia (interná funkcia)
create or replace function public.stock_note_unpack(p_package_id uuid) returns void
language plpgsql security definer set search_path = '' as $fn$
declare
  bid uuid;
begin
  update public.stock_issue_batches set status = 'return_pending'
   where package_id = p_package_id and status = 'issued' returning id into bid;
  if bid is not null then
    insert into public.stock_discrepancies (batch_id, kind) values (bid, 'unpack_without_return') on conflict do nothing;
  end if;
end $fn$;

-- ---------------------------------------------------------------- pack_package / unpack_package (0011 + výdaj)
create or replace function public.pack_package(p_id uuid, p_action_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare
  me uuid := auth.uid();
  me_name text;
  row public.packages;
  snapshot jsonb;
  ev_id bigint;
  ev_at timestamptz;
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
  values (p_id, row.date, row.listing_id, row.listing_name, 'packed', me, coalesce(me_name, '—'), p_action_id, snapshot)
  returning id, created_at into ev_id, ev_at;
  -- Zabalené = výdaj zo skladu, v tej istej transakcii. Chyba skladu nikdy nezablokuje balenie hostí:
  -- ide do fronty stock_issue_errors a stock_retry_issue ju zopakuje (jedinečné kľúče = bez dvojitého odpočtu).
  begin
    perform public.stock_issue_for_package(p_id, ev_id, snapshot, me, me_name, ev_at);
  exception when others then
    if coalesce((select strict_atomic from public.stock_config where id), false) then
      raise;
    end if;
    insert into public.stock_issue_errors (packed_event_id, package_id, error) values (ev_id, p_id, left(sqlerrm, 500)) on conflict do nothing;
  end;
  return jsonb_build_object('ok', true, 'status', 'packed', 'packed_by_name', me_name);
end $fn$;

create or replace function public.unpack_package(p_id uuid, p_action_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
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
  -- Späť NEvracia tovar do skladu: dávka len čaká na potvrdené vrátenie
  begin
    perform public.stock_note_unpack(p_id);
  exception when others then
    null;
  end;
  return jsonb_build_object('ok', true, 'status', 'todo');
end $fn$;

-- opakovanie výdaja pre zabalenie, ktoré ho nedostalo (fronta chýb); idempotentné
create or replace function public.stock_retry_issue(p_event_id bigint) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare
  ev public.package_events;
  res jsonb;
begin
  if not public.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into ev from public.package_events where id = p_event_id and event = 'packed';
  if not found then
    return jsonb_build_object('ok', false, 'status', 'not_found');
  end if;
  res := public.stock_issue_for_package(ev.package_id, ev.id, ev.data, ev.actor, ev.actor_name, ev.created_at);
  update public.stock_issue_errors set resolved_at = now() where packed_event_id = p_event_id and resolved_at is null;
  return jsonb_build_object('ok', true, 'result', res);
end $fn$;

-- ---------------------------------------------------------------- vrátenie a nezrovnalosti
create or replace function public.stock_confirm_return(p_batch uuid, p_lines jsonb, p_note text, p_action_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare
  me uuid := auth.uid();
  me_name text := public.stock_me_name();
  b public.stock_issue_batches;
  r record;
  q int;
  wh uuid;
  ok_lines int := 0;
begin
  if not public.is_active_user() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into b from public.stock_issue_batches where id = p_batch for update;
  if not found then
    raise exception 'batch not found' using errcode = 'P0002';
  end if;
  if b.status not in ('issued', 'return_pending') then
    return jsonb_build_object('ok', true, 'replayed', true, 'status', b.status);
  end if;
  for r in select k as item_id, v::int as held from jsonb_each_text(b.held) as e(k, v) loop
    -- bez zoznamu sa vracia všetko, čo dávka drží
    if p_lines is null then
      q := r.held;
    else
      select least(r.held, greatest(0, (l ->> 'qty')::int)) into q from jsonb_array_elements(p_lines) l where l ->> 'item_id' = r.item_id;
      q := coalesce(q, 0);
    end if;
    if q > 0 then
      select warehouse_id into wh from public.stock_movements where batch_id = b.id and item_id = r.item_id::uuid and qty < 0 order by id limit 1;
      if wh is not null then
        insert into public.stock_movements (item_id, warehouse_id, kind, qty, actor, actor_name, reason, source_type, source_id, unique_key, batch_id, listing_id, client_action_id)
        values (r.item_id::uuid, wh, 'return', q, me, me_name, coalesce(nullif(btrim(p_note), ''), 'potvrdené vrátenie'), 'issue_batch', b.id::text,
                'ret:' || b.id || ':' || r.item_id, b.id, b.listing_id, p_action_id)
        on conflict (unique_key) do nothing;
        ok_lines := ok_lines + 1;
      end if;
    end if;
    if q < r.held then
      insert into public.stock_discrepancies (batch_id, kind, item_id, qty) values (b.id, 'partial_return', r.item_id::uuid, r.held - q);
    end if;
  end loop;
  update public.stock_issue_batches set status = 'returned', closed_at = now() where id = b.id;
  update public.stock_discrepancies set status = 'resolved', resolution = 'vrátené do skladu', resolved_at = now(), resolved_by = me, resolved_by_name = me_name
   where batch_id = b.id and kind = 'unpack_without_return' and status = 'open';
  perform public.stock_log('return_confirmed', 'issue_batch', b.id::text, jsonb_build_object('lines', ok_lines));
  return jsonb_build_object('ok', true, 'status', 'returned', 'lines', ok_lines);
end $fn$;

-- správca uzavrie nezrovnalosť (napr. tovar ostal v byte; bez zmeny stavu) s dôvodom
create or replace function public.stock_resolve_discrepancy(p_id bigint, p_resolution text) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare
  d public.stock_discrepancies;
  reason text := left(btrim(coalesce(p_resolution, '')), 300);
begin
  if not public.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if reason = '' then
    return jsonb_build_object('ok', false, 'status', 'reason_required');
  end if;
  select * into d from public.stock_discrepancies where id = p_id for update;
  if not found then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  if d.status = 'resolved' then
    return jsonb_build_object('ok', true, 'replayed', true);
  end if;
  update public.stock_discrepancies set status = 'resolved', resolution = reason, resolved_at = now(), resolved_by = auth.uid(), resolved_by_name = public.stock_me_name() where id = p_id;
  -- Späť bez vrátenia uzavretý ako "tovar ostal": dávka sa zatvorí, nový výdaj môže začať nový cyklus
  if d.kind = 'unpack_without_return' then
    update public.stock_issue_batches set status = 'closed_kept', closed_at = now() where id = d.batch_id and status = 'return_pending';
  end if;
  perform public.stock_log('discrepancy_resolved', 'discrepancy', p_id::text, jsonb_build_object('resolution', reason));
  return jsonb_build_object('ok', true);
end $fn$;

-- ---------------------------------------------------------------- ručné pohyby
-- Personál: výdaj do bytu / ručný výdaj, poškodenie, vrátenie. Správca: aj príjem. Presun a rozdiel inventúry majú vlastné cesty.
create or replace function public.stock_record_movement(
  p_item uuid, p_warehouse uuid, p_kind text, p_qty int, p_reason text, p_occurred_at timestamptz,
  p_listing_id text, p_action_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare
  me uuid := auth.uid();
  me_name text := public.stock_me_name();
  reason text := left(btrim(coalesce(p_reason, '')), 300);
  signed int;
  at_ts timestamptz := coalesce(p_occurred_at, now());
  cut timestamptz;
  shifted boolean := false;
  mv public.stock_movements;
begin
  if not public.is_active_user() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_kind not in ('issue_manual', 'issue_flat', 'damage', 'return', 'receipt') then
    return jsonb_build_object('ok', false, 'status', 'bad_kind');
  end if;
  if p_kind = 'receipt' and not public.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_qty is null or p_qty <= 0 then
    return jsonb_build_object('ok', false, 'status', 'bad_qty');
  end if;
  if reason = '' then
    return jsonb_build_object('ok', false, 'status', 'reason_required');
  end if;
  if at_ts > now() + interval '1 minute' then
    return jsonb_build_object('ok', false, 'status', 'future');
  end if;
  if not exists (select 1 from public.stock_items where id = p_item and active)
     or not exists (select 1 from public.stock_warehouses where id = p_warehouse and active) then
    return jsonb_build_object('ok', false, 'status', 'bad_item');
  end if;
  if p_action_id is not null then
    select * into mv from public.stock_movements where client_action_id = p_action_id and item_id = p_item and kind = p_kind limit 1;
    if found then
      return jsonb_build_object('ok', true, 'replayed', true, 'id', mv.id);
    end if;
  end if;
  signed := case when p_kind in ('return', 'receipt') then p_qty else -p_qty end;
  -- minulosť pred uzavretou inventúrou sa nepreráta: pohyb sa zapíše na čas uzávierky
  select max(cut_at) into cut from public.stock_inventories where warehouse_id = p_warehouse and status in ('closed', 'approved');
  if cut is not null and at_ts < cut then
    shifted := true;
  end if;
  insert into public.stock_movements (item_id, warehouse_id, kind, qty, occurred_at, actor, actor_name, reason, source_type, listing_id, client_action_id, meta)
  values (p_item, p_warehouse, p_kind, signed, case when shifted then cut else at_ts end, me, me_name, reason, 'manual', p_listing_id, p_action_id,
          case when shifted then jsonb_build_object('stated_at', at_ts, 'shifted_to_cut', true) else '{}'::jsonb end)
  returning * into mv;
  return jsonb_build_object('ok', true, 'id', mv.id, 'shifted', shifted);
end $fn$;

create or replace function public.stock_transfer(p_item uuid, p_from uuid, p_to uuid, p_qty int, p_reason text, p_action_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare
  me uuid := auth.uid();
  me_name text := public.stock_me_name();
  reason text := left(btrim(coalesce(p_reason, '')), 300);
begin
  if not public.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_qty is null or p_qty <= 0 or p_from = p_to then
    return jsonb_build_object('ok', false, 'status', 'bad_qty');
  end if;
  if reason = '' then
    return jsonb_build_object('ok', false, 'status', 'reason_required');
  end if;
  if p_action_id is not null and exists (select 1 from public.stock_movements where unique_key = 'act:' || p_action_id || ':out') then
    return jsonb_build_object('ok', true, 'replayed', true);
  end if;
  insert into public.stock_movements (item_id, warehouse_id, kind, qty, actor, actor_name, reason, source_type, unique_key, client_action_id)
  values (p_item, p_from, 'transfer_out', -p_qty, me, me_name, reason, 'transfer', 'act:' || p_action_id || ':out', p_action_id);
  insert into public.stock_movements (item_id, warehouse_id, kind, qty, actor, actor_name, reason, source_type, unique_key, client_action_id)
  values (p_item, p_to, 'transfer_in', p_qty, me, me_name, reason, 'transfer', 'act:' || p_action_id || ':in', p_action_id);
  return jsonb_build_object('ok', true);
end $fn$;

-- ---------------------------------------------------------------- katalóg (správca)
create or replace function public.stock_save_warehouse(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare
  w public.stock_warehouses;
begin
  if not public.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if nullif(p ->> 'id', '') is null then
    insert into public.stock_warehouses (name, city, kind) values (p ->> 'name', coalesce(nullif(p ->> 'city', ''), 'Bratislava'), coalesce(nullif(p ->> 'kind', ''), 'warehouse')) returning * into w;
  else
    update public.stock_warehouses set name = coalesce(p ->> 'name', name), city = coalesce(p ->> 'city', city), kind = coalesce(p ->> 'kind', kind),
           active = coalesce((p ->> 'active')::boolean, active) where id = (p ->> 'id')::uuid returning * into w;
  end if;
  perform public.stock_log('warehouse_saved', 'warehouse', w.id::text, p);
  return jsonb_build_object('ok', true, 'id', w.id);
end $fn$;

create or replace function public.stock_save_item(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare
  i public.stock_items;
begin
  if not public.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if nullif(p ->> 'id', '') is null then
    insert into public.stock_items (kind, product, category, variant, system, base_unit, home_warehouse_id)
    values (p ->> 'kind', p ->> 'product', coalesce(p ->> 'category', ''), nullif(p ->> 'variant', ''), nullif(p ->> 'system', ''),
            coalesce(nullif(p ->> 'base_unit', ''), 'ks'), nullif(p ->> 'home_warehouse_id', '')::uuid)
    returning * into i;
  else
    update public.stock_items set product = coalesce(p ->> 'product', product), category = coalesce(p ->> 'category', category),
           variant = case when p ? 'variant' then nullif(p ->> 'variant', '') else variant end,
           system = case when p ? 'system' then nullif(p ->> 'system', '') else system end,
           home_warehouse_id = case when p ? 'home_warehouse_id' then nullif(p ->> 'home_warehouse_id', '')::uuid else home_warehouse_id end,
           active = coalesce((p ->> 'active')::boolean, active)
     where id = (p ->> 'id')::uuid returning * into i;
  end if;
  perform public.stock_log('item_saved', 'item', i.id::text, p);
  return jsonb_build_object('ok', true, 'id', i.id);
end $fn$;

-- nová verzia ponuky uzavrie predchádzajúcu otvorenú verziu rovnakého dodávateľa dňom pred začiatkom
create or replace function public.stock_save_sku(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare
  s public.stock_supplier_skus;
  vf date := (p ->> 'valid_from')::date;
begin
  if not public.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if nullif(p ->> 'id', '') is null then
    update public.stock_supplier_skus set valid_to = vf - 1
     where item_id = (p ->> 'item_id')::uuid and supplier = p ->> 'supplier' and valid_to is null and valid_from < vf;
    insert into public.stock_supplier_skus (item_id, supplier, sku, purchase_unit, pieces_per_pack, packs_per_carton, price_cents, currency, vat_rate,
                                            valid_from, valid_to, min_order, lead_time_days, verified_source, verified_at)
    values ((p ->> 'item_id')::uuid, p ->> 'supplier', nullif(p ->> 'sku', ''), coalesce(nullif(p ->> 'purchase_unit', ''), 'pack'),
            nullif(p ->> 'pieces_per_pack', '')::int, nullif(p ->> 'packs_per_carton', '')::int, nullif(p ->> 'price_cents', '')::int,
            coalesce(nullif(p ->> 'currency', ''), 'EUR'), nullif(p ->> 'vat_rate', '')::numeric, vf, nullif(p ->> 'valid_to', '')::date,
            nullif(p ->> 'min_order', '')::int, nullif(p ->> 'lead_time_days', '')::int, nullif(btrim(p ->> 'verified_source'), ''), nullif(p ->> 'verified_at', '')::date)
    returning * into s;
  else
    update public.stock_supplier_skus set
      pieces_per_pack = case when p ? 'pieces_per_pack' then nullif(p ->> 'pieces_per_pack', '')::int else pieces_per_pack end,
      packs_per_carton = case when p ? 'packs_per_carton' then nullif(p ->> 'packs_per_carton', '')::int else packs_per_carton end,
      price_cents = case when p ? 'price_cents' then nullif(p ->> 'price_cents', '')::int else price_cents end,
      min_order = case when p ? 'min_order' then nullif(p ->> 'min_order', '')::int else min_order end,
      lead_time_days = case when p ? 'lead_time_days' then nullif(p ->> 'lead_time_days', '')::int else lead_time_days end,
      verified_source = case when p ? 'verified_source' then nullif(btrim(p ->> 'verified_source'), '') else verified_source end,
      verified_at = case when p ? 'verified_at' then nullif(p ->> 'verified_at', '')::date else verified_at end,
      valid_to = case when p ? 'valid_to' then nullif(p ->> 'valid_to', '')::date else valid_to end
     where id = (p ->> 'id')::uuid returning * into s;
  end if;
  perform public.stock_log('sku_saved', 'sku', s.id::text, p);
  return jsonb_build_object('ok', true, 'id', s.id);
end $fn$;

create or replace function public.stock_save_alias(p_kind text, p_source_key text, p_item uuid, p_factor int) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
begin
  if not public.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  insert into public.stock_aliases (kind, source_key, item_id, factor) values (p_kind, p_source_key, p_item, coalesce(p_factor, 1))
  on conflict (kind, source_key) do update set item_id = excluded.item_id, factor = excluded.factor;
  perform public.stock_log('alias_saved', 'alias', p_kind || ':' || p_source_key, jsonb_build_object('item', p_item, 'factor', p_factor));
  return jsonb_build_object('ok', true);
end $fn$;

-- základné karty bez vymyslených čísel: žiadne ponuky, žiadny prepočet, sklad priradí správca
create or replace function public.stock_seed_catalog() returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare
  n int := 0;
  r record;
  iid uuid;
begin
  if not public.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  for r in select * from (values
    ('consumable', 'Toaletný papier', 'toaletak', null::text, null::text, 'rolka'),
    ('consumable', 'Kuchynské utierky', 'utierky', null, null, 'rolka'),
    ('consumable', 'Špongia na riad', 'spongia', null, null, 'ks'),
    ('consumable', 'Kapsule do umývačky', 'myckaKaps', null, null, 'ks'),
    ('consumable', 'Vrecko do koša veľké', 'vreckoV', 'veľké', null, 'ks'),
    ('consumable', 'Vrecko do koša malé', 'vreckoM', 'malé', null, 'ks'),
    ('capsule', 'Kávové kapsule', 'nespresso original', null, 'Nespresso Original', 'ks'),
    ('capsule', 'Kávové kapsule', 'nespresso vertuo', null, 'Nespresso Vertuo', 'ks'),
    ('capsule', 'Kávové kapsule', 'tchibo cafissimo', null, 'Tchibo Cafissimo', 'ks'),
    ('capsule', 'Kávové kapsule', 'l''or tassimo', null, 'L''OR Tassimo', 'ks')
  ) as t(kind, product, skey, variant, system, unit) loop
    insert into public.stock_items (kind, product, category, variant, system, base_unit)
    values (r.kind, r.product, case when r.kind = 'capsule' then 'káva' else 'spotrebný materiál' end, r.variant, r.system, r.unit)
    on conflict (product, coalesce(variant, ''), coalesce(system, '')) do nothing;
    select id into iid from public.stock_items where product = r.product and coalesce(variant, '') = coalesce(r.variant, '') and coalesce(system, '') = coalesce(r.system, '');
    insert into public.stock_aliases (kind, source_key, item_id) values (r.kind, r.skey, iid) on conflict (kind, source_key) do nothing;
    n := n + 1;
  end loop;
  perform public.stock_log('catalog_seeded', 'catalog', null, jsonb_build_object('cards', n));
  return jsonb_build_object('ok', true, 'cards', n);
end $fn$;

-- ---------------------------------------------------------------- inventúra (správca)
create or replace function public.stock_inventory_open(p_warehouse uuid, p_date date, p_title text, p_action_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare
  inv public.stock_inventories;
begin
  if not public.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_action_id is not null then
    select * into inv from public.stock_inventories where client_action_id = p_action_id;
    if found then
      return jsonb_build_object('ok', true, 'replayed', true, 'id', inv.id);
    end if;
  end if;
  if p_date is null or not exists (select 1 from public.stock_warehouses where id = p_warehouse and active) then
    return jsonb_build_object('ok', false, 'status', 'bad_input');
  end if;
  insert into public.stock_inventories (title, inventory_date, warehouse_id, created_by, created_by_name, client_action_id)
  values (left(coalesce(p_title, ''), 160), p_date, p_warehouse, auth.uid(), public.stock_me_name(), p_action_id) returning * into inv;
  return jsonb_build_object('ok', true, 'id', inv.id);
end $fn$;

-- p_sku: ktorý typ balenia sa počíta; bez neho sa použije jediný platný overený prepočet, inak je riadok "unverified"
create or replace function public.stock_inventory_save_line(
  p_inventory uuid, p_item uuid, p_packs int, p_loose int, p_verified_zero boolean, p_shelf text, p_sku uuid, p_note text, p_source text) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare
  inv public.stock_inventories;
  sk public.stock_supplier_skus;
  ppp int;
  st text;
  tot int;
  v_shelf text := left(btrim(coalesce(p_shelf, '')), 80);
  pk int := p_packs;
  ls int := p_loose;
  distinct_ppp int;
begin
  if not public.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into inv from public.stock_inventories where id = p_inventory for update;
  if not found then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  if inv.status <> 'draft' then
    return jsonb_build_object('ok', false, 'status', 'closed');
  end if;
  if (pk is not null and pk < 0) or (ls is not null and ls < 0) then
    return jsonb_build_object('ok', false, 'status', 'bad_qty');
  end if;
  if coalesce(p_verified_zero, false) and (coalesce(pk, 0) <> 0 or coalesce(ls, 0) <> 0) then
    return jsonb_build_object('ok', false, 'status', 'bad_zero');
  end if;

  if coalesce(pk, 0) > 0 then
    if p_sku is not null then
      select * into sk from public.stock_supplier_skus where id = p_sku and item_id = p_item;
    else
      select count(distinct pieces_per_pack) into distinct_ppp from public.stock_supplier_skus
       where item_id = p_item and verified_source is not null and verified_at is not null and pieces_per_pack is not null
         and valid_from <= public.today_ba() and (valid_to is null or valid_to >= public.today_ba());
      if distinct_ppp = 1 then
        select * into sk from public.stock_supplier_skus
         where item_id = p_item and verified_source is not null and verified_at is not null and pieces_per_pack is not null
           and valid_from <= public.today_ba() and (valid_to is null or valid_to >= public.today_ba()) order by valid_from desc limit 1;
      end if;
    end if;
    if sk.id is not null and sk.pieces_per_pack is not null and sk.verified_source is not null and sk.verified_at is not null then
      ppp := sk.pieces_per_pack;
    end if;
  end if;

  if coalesce(p_verified_zero, false) then
    st := 'zero'; tot := 0;
  elsif pk is null and ls is null then
    st := 'unset'; tot := null;
  elsif coalesce(pk, 0) > 0 and ppp is null then
    st := 'unverified'; tot := null;
  else
    tot := coalesce(pk, 0) * coalesce(ppp, 0) + coalesce(ls, 0);
    st := case when tot = 0 then 'zero' else 'counted' end;
  end if;

  insert into public.stock_inventory_lines (inventory_id, item_id, shelf, packs, loose, verified_zero, sku_id, pieces_per_pack, total, state, counted_by, counted_by_name, counted_at, source, note)
  values (p_inventory, p_item, v_shelf, pk, ls, coalesce(p_verified_zero, false), sk.id, ppp, tot, st, auth.uid(), public.stock_me_name(), now(), coalesce(nullif(p_source, ''), 'app'), left(coalesce(p_note, ''), 300))
  on conflict (inventory_id, item_id, shelf) do update set
    packs = excluded.packs, loose = excluded.loose, verified_zero = excluded.verified_zero, sku_id = excluded.sku_id, pieces_per_pack = excluded.pieces_per_pack,
    total = excluded.total, state = excluded.state, counted_by = excluded.counted_by, counted_by_name = excluded.counted_by_name,
    counted_at = excluded.counted_at, source = excluded.source, note = excluded.note;
  return jsonb_build_object('ok', true, 'state', st, 'total', tot);
end $fn$;

-- uzávierka v presnom čase: spočítané vs očakávané k tomuto času; opravy len novým auditovaným pohybom
create or replace function public.stock_inventory_close(p_inventory uuid, p_cut_at timestamptz, p_action_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare
  inv public.stock_inventories;
  cut timestamptz;
  prev_cut timestamptz;
  r record;
  opening_at timestamptz;
  expected int;
  blockers jsonb;
  me uuid := auth.uid();
  me_name text := public.stock_me_name();
  booked int := 0;
begin
  if not public.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into inv from public.stock_inventories where id = p_inventory for update;
  if not found then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  if inv.status <> 'draft' then
    return jsonb_build_object('ok', true, 'replayed', true, 'status', inv.status);
  end if;
  cut := coalesce(p_cut_at, now());
  if cut > now() + interval '1 minute' then
    return jsonb_build_object('ok', false, 'status', 'future_cut');
  end if;
  select max(cut_at) into prev_cut from public.stock_inventories where warehouse_id = inv.warehouse_id and status in ('closed', 'approved');
  if prev_cut is not null and cut < prev_cut then
    return jsonb_build_object('ok', false, 'status', 'cut_before_previous');
  end if;
  select coalesce(jsonb_agg(item_id), '[]'::jsonb) into blockers from public.stock_inventory_lines where inventory_id = p_inventory and state = 'unverified';
  if jsonb_array_length(blockers) > 0 then
    return jsonb_build_object('ok', false, 'status', 'unverified_lines', 'items', blockers);
  end if;

  for r in select item_id, sum(total)::int as total from public.stock_inventory_lines
            where inventory_id = p_inventory and state in ('zero', 'counted') group by item_id loop
    select min(occurred_at) into opening_at from public.stock_movements
     where item_id = r.item_id and warehouse_id = inv.warehouse_id and kind = 'opening_balance' and occurred_at <= cut;
    if opening_at is null then
      -- prvé spočítanie položky = začiatočný stav (aj overená nula je stav 0, nie neznámy)
      insert into public.stock_movements (item_id, warehouse_id, kind, qty, occurred_at, actor, actor_name, reason, source_type, source_id, unique_key)
      values (r.item_id, inv.warehouse_id, 'opening_balance', r.total, cut, me, me_name, 'začiatočný stav z inventúry', 'inventory', p_inventory::text, 'inv:' || p_inventory || ':' || r.item_id)
      on conflict (unique_key) do nothing;
    else
      select coalesce(sum(qty), 0)::int into expected from public.stock_movements
       where item_id = r.item_id and warehouse_id = inv.warehouse_id and occurred_at >= opening_at and occurred_at <= cut;
      if r.total <> expected then
        insert into public.stock_movements (item_id, warehouse_id, kind, qty, occurred_at, actor, actor_name, reason, source_type, source_id, unique_key, meta)
        values (r.item_id, inv.warehouse_id, 'inventory_difference', r.total - expected, cut, me, me_name, 'rozdiel inventúry', 'inventory', p_inventory::text,
                'inv:' || p_inventory || ':' || r.item_id, jsonb_build_object('expected', expected, 'counted', r.total))
        on conflict (unique_key) do nothing;
        booked := booked + 1;
      end if;
    end if;
  end loop;

  update public.stock_inventories set status = 'closed', cut_at = cut, closed_by_name = me_name, closed_at = now() where id = p_inventory;
  perform public.stock_log('inventory_closed', 'inventory', p_inventory::text, jsonb_build_object('cut_at', cut, 'differences', booked));
  return jsonb_build_object('ok', true, 'status', 'closed', 'cut_at', cut, 'differences', booked);
end $fn$;

-- schválenie: prvé schválené uzavretie je začiatočný stav (baseline); odpočty sa tým ešte nezapnú
create or replace function public.stock_inventory_approve(p_inventory uuid) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare
  inv public.stock_inventories;
  cfg public.stock_config;
begin
  if not public.stock_is_approver() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into inv from public.stock_inventories where id = p_inventory for update;
  if not found then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  if inv.status = 'approved' then
    return jsonb_build_object('ok', true, 'replayed', true);
  end if;
  if inv.status <> 'closed' then
    return jsonb_build_object('ok', false, 'status', 'not_closed');
  end if;
  update public.stock_inventories set status = 'approved', approved_by = auth.uid(), approved_by_name = public.stock_me_name(), approved_at = now() where id = p_inventory;
  select * into cfg from public.stock_config where id for update;
  if cfg.baseline_inventory_id is null then
    update public.stock_config set baseline_inventory_id = p_inventory, baseline_at = inv.cut_at, updated_at = now(), updated_by = auth.uid() where id;
  end if;
  perform public.stock_log('inventory_approved', 'inventory', p_inventory::text, jsonb_build_object('baseline', cfg.baseline_inventory_id is null));
  return jsonb_build_object('ok', true, 'baseline', cfg.baseline_inventory_id is null);
end $fn$;

-- spätné doplnenie výdajov balení po uzávierke baseline (idempotentné; staršie balenia sa nikdy nedotknú)
create or replace function public.stock_backfill_since_baseline() returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare
  cfg public.stock_config;
  ev record;
  res jsonb;
  done int := 0;
begin
  if not public.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into cfg from public.stock_config where id;
  if cfg.baseline_at is null or not cfg.deduction_enabled then
    return jsonb_build_object('ok', false, 'status', 'not_enabled');
  end if;
  -- len posledné 'packed' balíka, ktoré je dnes zabalené a ešte nemá dávku; balenie pred uzávierkou sa nepočíta
  for ev in
    select e.* from public.package_events e
      join public.packages p on p.id = e.package_id and p.status = 'packed'
     where e.event = 'packed' and e.created_at > cfg.baseline_at
       and e.id = (select max(e2.id) from public.package_events e2 where e2.package_id = e.package_id and e2.event = 'packed')
       and not exists (select 1 from public.stock_issue_batches b where b.packed_event_id = e.id)
       and not exists (select 1 from public.stock_issue_batches b where b.package_id = e.package_id and b.status in ('issued', 'return_pending'))
     order by e.id
  loop
    res := public.stock_issue_for_package(ev.package_id, ev.id, ev.data, ev.actor, ev.actor_name, ev.created_at);
    done := done + 1;
  end loop;
  return jsonb_build_object('ok', true, 'issued_packages', done);
end $fn$;

-- zapnutie/vypnutie odpočtov: zapnúť sa dá iba so schválenou začiatočnou inventúrou
create or replace function public.stock_set_deduction(p_enabled boolean) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare
  cfg public.stock_config;
  filled jsonb := null;
begin
  if not public.stock_is_approver() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into cfg from public.stock_config where id for update;
  if p_enabled and (cfg.baseline_inventory_id is null or cfg.baseline_at is null) then
    return jsonb_build_object('ok', false, 'status', 'no_baseline');
  end if;
  update public.stock_config set deduction_enabled = p_enabled, updated_at = now(), updated_by = auth.uid() where id;
  if p_enabled then
    filled := public.stock_backfill_since_baseline();
  end if;
  perform public.stock_log(case when p_enabled then 'deduction_enabled' else 'deduction_disabled' end, 'config', 'stock', jsonb_build_object('backfill', filled));
  return jsonb_build_object('ok', true, 'enabled', p_enabled, 'backfill', filled);
end $fn$;

create or replace function public.stock_set_approvers(p_users uuid[]) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
begin
  if not public.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.stock_config set order_approvers = coalesce(p_users, '{}'), updated_at = now(), updated_by = auth.uid() where id;
  perform public.stock_log('approvers_set', 'config', 'stock', jsonb_build_object('count', cardinality(coalesce(p_users, '{}'))));
  return jsonb_build_object('ok', true);
end $fn$;

-- ---------------------------------------------------------------- objednávky
-- rovnaký výpočet ako src/core/stock/orders.ts (proposeOrder); testy porovnávajú obe verzie
create or replace function public.stock_units_for(p_raw int, p_ppp int, p_unit text, p_per_carton int, p_min int) returns jsonb
language plpgsql immutable set search_path = '' as $fn$
declare
  packs int;
  units int;
  basis text := 'pack_rounding';
begin
  if p_ppp is null or p_ppp <= 0 then
    return jsonb_build_object('status', 'unverified');
  end if;
  if p_raw <= 0 then
    return jsonb_build_object('status', 'ok', 'units', 0, 'packs', 0, 'ordered_base', 0, 'basis', 'none');
  end if;
  packs := ceil(p_raw::numeric / p_ppp)::int;
  units := packs;
  if p_unit = 'carton' then
    if p_per_carton is null or p_per_carton < 1 then
      return jsonb_build_object('status', 'unverified');
    end if;
    units := ceil(packs::numeric / p_per_carton)::int;
    packs := units * p_per_carton;
    basis := 'carton_rounding';
  end if;
  if p_min is not null and units < p_min then
    units := p_min;
    packs := case when p_unit = 'carton' then units * coalesce(p_per_carton, 1) else units end;
    basis := 'minimum_order';
  end if;
  return jsonb_build_object('status', 'ok', 'units', units, 'packs', packs, 'ordered_base', packs * p_ppp, 'basis', basis);
end $fn$;

-- p_lines: [{item_id, sku_id, need_base, reserve_base, usable_base, incoming_base, final_units, manual_reason}]
-- server prepočíta návrh sám; iný počet ako návrh vyžaduje dôvod
create or replace function public.stock_order_create(p_supplier text, p_delivery date, p_lines jsonb, p_note text, p_action_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare
  o public.stock_orders;
  l jsonb;
  sk public.stock_supplier_skus;
  raw int;
  calc jsonb;
  fin int;
  reason text;
  n int := 0;
begin
  if not public.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_action_id is not null then
    select * into o from public.stock_orders where client_action_id = p_action_id;
    if found then
      return jsonb_build_object('ok', true, 'replayed', true, 'id', o.id);
    end if;
  end if;
  if btrim(coalesce(p_supplier, '')) = '' or p_lines is null or jsonb_array_length(p_lines) = 0 then
    return jsonb_build_object('ok', false, 'status', 'bad_input');
  end if;
  -- najprv všetko overíme, potom zapisujeme (atomicky)
  for l in select * from jsonb_array_elements(p_lines) loop
    select * into sk from public.stock_supplier_skus where id = (l ->> 'sku_id')::uuid and item_id = (l ->> 'item_id')::uuid;
    if not found or sk.pieces_per_pack is null or sk.verified_source is null or sk.verified_at is null then
      return jsonb_build_object('ok', false, 'status', 'unverified', 'item_id', l ->> 'item_id');
    end if;
    raw := greatest(0, coalesce((l ->> 'need_base')::int, 0) + coalesce((l ->> 'reserve_base')::int, 0)
                       - greatest(0, coalesce((l ->> 'usable_base')::int, 0)) - coalesce((l ->> 'incoming_base')::int, 0));
    calc := public.stock_units_for(raw, sk.pieces_per_pack, sk.purchase_unit, sk.packs_per_carton, sk.min_order);
    if calc ->> 'status' <> 'ok' then
      return jsonb_build_object('ok', false, 'status', 'unverified', 'item_id', l ->> 'item_id');
    end if;
    fin := coalesce((l ->> 'final_units')::int, (calc ->> 'units')::int);
    if fin <> (calc ->> 'units')::int and btrim(coalesce(l ->> 'manual_reason', '')) = '' then
      return jsonb_build_object('ok', false, 'status', 'reason_required', 'item_id', l ->> 'item_id');
    end if;
  end loop;

  insert into public.stock_orders (supplier, delivery_target_date, note, created_by, created_by_name, client_action_id)
  values (btrim(p_supplier), p_delivery, left(coalesce(p_note, ''), 500), auth.uid(), public.stock_me_name(), p_action_id) returning * into o;
  for l in select * from jsonb_array_elements(p_lines) loop
    select * into sk from public.stock_supplier_skus where id = (l ->> 'sku_id')::uuid;
    raw := greatest(0, coalesce((l ->> 'need_base')::int, 0) + coalesce((l ->> 'reserve_base')::int, 0)
                       - greatest(0, coalesce((l ->> 'usable_base')::int, 0)) - coalesce((l ->> 'incoming_base')::int, 0));
    calc := public.stock_units_for(raw, sk.pieces_per_pack, sk.purchase_unit, sk.packs_per_carton, sk.min_order);
    fin := coalesce((l ->> 'final_units')::int, (calc ->> 'units')::int);
    reason := nullif(btrim(coalesce(l ->> 'manual_reason', '')), '');
    insert into public.stock_order_lines (order_id, item_id, sku_id, need_base, reserve_base, usable_base, incoming_base, raw_base, suggested_units, final_units, packs,
                                          pieces_per_pack, purchase_unit, price_cents, currency, basis, manual_reason)
    values (o.id, sk.item_id, sk.id, coalesce((l ->> 'need_base')::int, 0), coalesce((l ->> 'reserve_base')::int, 0), coalesce((l ->> 'usable_base')::int, 0),
            coalesce((l ->> 'incoming_base')::int, 0), raw, (calc ->> 'units')::int, fin,
            case when sk.purchase_unit = 'carton' then fin * coalesce(sk.packs_per_carton, 1) else fin end,
            sk.pieces_per_pack, sk.purchase_unit, sk.price_cents, sk.currency, calc ->> 'basis', reason);
    n := n + 1;
  end loop;
  insert into public.stock_order_events (order_id, event, actor, actor_name, data) values (o.id, 'created', auth.uid(), public.stock_me_name(), jsonb_build_object('lines', n));
  return jsonb_build_object('ok', true, 'id', o.id, 'lines', n);
end $fn$;

-- prechod stavu: kontrola (správca), schválenie (schvaľovateľ), zrušenie (správca)
create or replace function public.stock_order_step(p_order uuid, p_to text, p_action_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare
  o public.stock_orders;
  ok boolean;
begin
  if p_to not in ('review', 'draft', 'approved', 'cancelled') then
    return jsonb_build_object('ok', false, 'status', 'bad_step');
  end if;
  if p_to = 'approved' then
    if not public.stock_is_approver() then
      raise exception 'not allowed' using errcode = '42501';
    end if;
  elsif not public.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into o from public.stock_orders where id = p_order for update;
  if not found then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  if p_action_id is not null and exists (select 1 from public.stock_order_events where client_action_id = p_action_id) then
    return jsonb_build_object('ok', true, 'replayed', true, 'status', o.status);
  end if;
  ok := (o.status = 'draft' and p_to in ('review', 'cancelled'))
     or (o.status = 'review' and p_to in ('draft', 'approved', 'cancelled'))
     or (o.status = 'approved' and p_to = 'cancelled')
     or (o.status in ('sent', 'confirmed') and p_to = 'cancelled' and not exists (select 1 from public.stock_receipts where order_id = p_order));
  if not ok then
    return jsonb_build_object('ok', false, 'status', 'bad_transition', 'from', o.status);
  end if;
  update public.stock_orders set status = p_to,
         approved_by = case when p_to = 'approved' then auth.uid() else approved_by end,
         approved_by_name = case when p_to = 'approved' then public.stock_me_name() else approved_by_name end,
         approved_at = case when p_to = 'approved' then now() else approved_at end
   where id = p_order;
  insert into public.stock_order_events (order_id, event, actor, actor_name, data, client_action_id)
  values (p_order, p_to, auth.uid(), public.stock_me_name(), jsonb_build_object('from', o.status), p_action_id);
  return jsonb_build_object('ok', true, 'status', p_to);
end $fn$;

-- export/pripravený e-mail: nič neodišlo, objednávka ostáva "neodoslaná"
create or replace function public.stock_order_mark_exported(p_order uuid, p_method text, p_action_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare
  o public.stock_orders;
begin
  if not public.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into o from public.stock_orders where id = p_order;
  if not found then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  if o.status <> 'approved' then
    return jsonb_build_object('ok', false, 'status', 'not_approved');
  end if;
  insert into public.stock_order_events (order_id, event, actor, actor_name, data, client_action_id)
  values (p_order, 'exported', auth.uid(), public.stock_me_name(), jsonb_build_object('method', coalesce(p_method, 'export'), 'send_state', 'not_sent'), p_action_id)
  on conflict (client_action_id) do nothing;
  return jsonb_build_object('ok', true, 'send_state', 'not_sent');
end $fn$;

-- odoslanie: len schválená objednávka; opakovanie nikdy nevytvorí druhú objednávku
create or replace function public.stock_order_mark_sent(p_order uuid, p_method text, p_state text, p_ref text, p_action_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare
  o public.stock_orders;
begin
  if not public.stock_is_approver() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_state not in ('sent', 'ambiguous') or p_method not in ('export', 'email', 'api') then
    return jsonb_build_object('ok', false, 'status', 'bad_input');
  end if;
  select * into o from public.stock_orders where id = p_order for update;
  if not found then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  if p_action_id is not null and exists (select 1 from public.stock_order_events where client_action_id = p_action_id) then
    return jsonb_build_object('ok', true, 'replayed', true, 'status', o.status, 'send_state', o.send_state);
  end if;
  if o.status = 'approved' and o.send_state <> 'sent' then
    update public.stock_orders set send_state = p_state, send_method = p_method, supplier_ref = nullif(btrim(p_ref), ''),
           status = case when p_state = 'sent' then 'sent' else status end, sent_at = case when p_state = 'sent' then now() else sent_at end where id = p_order;
    insert into public.stock_order_events (order_id, event, actor, actor_name, data, client_action_id)
    values (p_order, case when p_state = 'sent' then 'sent' else 'send_ambiguous' end, auth.uid(), public.stock_me_name(), jsonb_build_object('method', p_method), p_action_id);
    return jsonb_build_object('ok', true, 'status', case when p_state = 'sent' then 'sent' else 'approved' end, 'send_state', p_state);
  end if;
  -- už odoslaná (iné zariadenie, opakovaný pokus): žiadna druhá objednávka ani druhý záznam
  return jsonb_build_object('ok', true, 'already_sent', o.send_state = 'sent', 'status', o.status, 'send_state', o.send_state);
end $fn$;

-- nejasný výsledok odoslania sa uzavrie ručným overením u dodávateľa
create or replace function public.stock_order_reconcile_send(p_order uuid, p_outcome text, p_ref text, p_action_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare
  o public.stock_orders;
begin
  if not public.stock_is_approver() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into o from public.stock_orders where id = p_order for update;
  if not found then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  if o.send_state <> 'ambiguous' then
    return jsonb_build_object('ok', true, 'status', o.status, 'send_state', o.send_state);
  end if;
  if p_outcome = 'sent' then
    update public.stock_orders set send_state = 'sent', status = 'sent', sent_at = now(), supplier_ref = coalesce(nullif(btrim(p_ref), ''), supplier_ref) where id = p_order;
  elsif p_outcome = 'not_sent' then
    update public.stock_orders set send_state = 'not_sent' where id = p_order;
  else
    return jsonb_build_object('ok', false, 'status', 'bad_input');
  end if;
  insert into public.stock_order_events (order_id, event, actor, actor_name, data, client_action_id)
  values (p_order, 'send_reconciled', auth.uid(), public.stock_me_name(), jsonb_build_object('outcome', p_outcome), p_action_id)
  on conflict (client_action_id) do nothing;
  return jsonb_build_object('ok', true, 'send_state', case when p_outcome = 'sent' then 'sent' else 'not_sent' end);
end $fn$;

create or replace function public.stock_order_confirm(p_order uuid, p_ref text, p_action_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare
  o public.stock_orders;
begin
  if not public.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into o from public.stock_orders where id = p_order for update;
  if not found then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  if o.status = 'confirmed' then
    return jsonb_build_object('ok', true, 'replayed', true, 'status', o.status);
  end if;
  if o.status <> 'sent' then
    return jsonb_build_object('ok', false, 'status', 'bad_transition', 'from', o.status);
  end if;
  update public.stock_orders set status = 'confirmed', confirmed_at = now(), supplier_ref = coalesce(nullif(btrim(p_ref), ''), supplier_ref) where id = p_order;
  insert into public.stock_order_events (order_id, event, actor, actor_name, data, client_action_id)
  values (p_order, 'confirmed', auth.uid(), public.stock_me_name(), '{}'::jsonb, p_action_id)
  on conflict (client_action_id) do nothing;
  return jsonb_build_object('ok', true, 'status', 'confirmed');
end $fn$;

-- príjem: sklad rastie až pri potvrdenom fyzickom príjme; čiastočné dodávky; opakovanie je bez účinku
-- p_lines: [{order_line_id, packs}]  (packs = nákupné jednotky, ako sa objednávalo)
create or replace function public.stock_order_receive(p_order uuid, p_lines jsonb, p_note text, p_action_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare
  o public.stock_orders;
  rc public.stock_receipts;
  l jsonb;
  ol public.stock_order_lines;
  wh uuid;
  rl uuid;
  units_in int;
  base int;
  all_done boolean;
begin
  if not public.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into o from public.stock_orders where id = p_order for update;
  if not found then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  if p_action_id is not null then
    select * into rc from public.stock_receipts where client_action_id = p_action_id;
    if found then
      return jsonb_build_object('ok', true, 'replayed', true, 'status', o.status);
    end if;
  end if;
  if o.status not in ('sent', 'confirmed', 'partially_received') then
    return jsonb_build_object('ok', false, 'status', 'bad_transition', 'from', o.status);
  end if;
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    return jsonb_build_object('ok', false, 'status', 'bad_input');
  end if;
  insert into public.stock_receipts (order_id, received_by, received_by_name, note, client_action_id)
  values (p_order, auth.uid(), public.stock_me_name(), left(coalesce(p_note, ''), 300), p_action_id) returning * into rc;
  for l in select * from jsonb_array_elements(p_lines) loop
    units_in := (l ->> 'packs')::int;
    if units_in is null or units_in <= 0 then
      continue;
    end if;
    select * into ol from public.stock_order_lines where id = (l ->> 'order_line_id')::uuid and order_id = p_order;
    if not found then
      raise exception 'order line not found' using errcode = 'P0002';
    end if;
    -- množstvo v základnej jednotke podľa balenia zapísaného pri objednávke (zmena balenia dodávateľom ho nemení)
    base := units_in * case when ol.purchase_unit = 'carton' then (ol.packs / nullif(ol.final_units, 0)) else 1 end * ol.pieces_per_pack;
    select home_warehouse_id into wh from public.stock_items where id = ol.item_id;
    if wh is null then
      raise exception 'item has no warehouse' using errcode = '23514';
    end if;
    insert into public.stock_receipt_lines (receipt_id, order_line_id, packs, base_qty) values (rc.id, ol.id, units_in, base) returning id into rl;
    insert into public.stock_movements (item_id, warehouse_id, kind, qty, actor, actor_name, reason, source_type, source_id, unique_key)
    values (ol.item_id, wh, 'receipt', base, auth.uid(), public.stock_me_name(), 'príjem objednávky', 'order', p_order::text, 'rcpt:' || rl)
    on conflict (unique_key) do nothing;
  end loop;
  select bool_and(coalesce((select sum(rl2.packs) from public.stock_receipt_lines rl2 where rl2.order_line_id = x.id), 0) >= x.final_units) into all_done
    from public.stock_order_lines x where x.order_id = p_order and x.final_units > 0;
  update public.stock_orders set status = case when all_done then 'received' else 'partially_received' end where id = p_order;
  insert into public.stock_order_events (order_id, event, actor, actor_name, data) values (p_order, case when all_done then 'received' else 'partially_received' end,
    auth.uid(), public.stock_me_name(), jsonb_build_object('receipt', rc.id));
  return jsonb_build_object('ok', true, 'status', case when all_done then 'received' else 'partially_received' end, 'receipt', rc.id);
end $fn$;

-- ---------------------------------------------------------------- pohľady
-- stav = pohyby od začiatočného stavu (opening_balance); bez neho je stav neznámy
create or replace view public.stock_on_hand with (security_invoker = true) as
  select m.item_id, m.warehouse_id,
         sum(m.qty)::int as qty,
         min(o.opening_at) as baseline_at
    from public.stock_movements m
    join (select item_id, warehouse_id, min(occurred_at) as opening_at from public.stock_movements where kind = 'opening_balance' group by 1, 2) o
      on o.item_id = m.item_id and o.warehouse_id = m.warehouse_id and m.occurred_at >= o.opening_at
   group by m.item_id, m.warehouse_id;

-- potvrdený príjem objednávok, ktorý ešte nedorazil (základná jednotka)
create or replace view public.stock_incoming with (security_invoker = true) as
  select ol.item_id,
         sum(greatest(0, ol.final_units - coalesce((select sum(rl.packs) from public.stock_receipt_lines rl where rl.order_line_id = ol.id), 0))
             * case when ol.purchase_unit = 'carton' then (ol.packs / nullif(ol.final_units, 0)) else 1 end * ol.pieces_per_pack)::int as qty
    from public.stock_order_lines ol
    join public.stock_orders o on o.id = ol.order_id and o.status in ('confirmed', 'partially_received')
   group by ol.item_id;

-- ---------------------------------------------------------------- RLS a práva
do $do$
declare
  t text;
begin
  foreach t in array array['stock_config', 'stock_warehouses', 'stock_items', 'stock_supplier_skus', 'stock_aliases', 'stock_issue_batches', 'stock_movements',
    'stock_unmapped_issues', 'stock_issue_errors', 'stock_discrepancies', 'stock_inventories', 'stock_inventory_lines', 'stock_orders', 'stock_order_lines',
    'stock_order_events', 'stock_receipts', 'stock_receipt_lines', 'stock_audit']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon', t);
    execute format('revoke insert, update, delete, truncate, references, trigger on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    -- katalóg a konfigurácia pre každého aktívneho (personál vyberá položku pri ručnom výdaji); všetko ostatné len správca
    if t in ('stock_warehouses', 'stock_items', 'stock_config') then
      execute format('create policy %I on public.%I for select to authenticated using (public.is_active_user())', t || '_select', t);
    else
      execute format('create policy %I on public.%I for select to authenticated using (public.is_admin())', t || '_select', t);
    end if;
  end loop;
end $do$;
revoke all on public.stock_on_hand, public.stock_incoming from public, anon;
grant select on public.stock_on_hand, public.stock_incoming to authenticated;

-- funkcie: len prihlásení; interné (výdaj, Späť) len cez pack/unpack
revoke execute on function public.stock_issue_for_package(uuid, bigint, jsonb, uuid, text, timestamptz) from public, anon, authenticated;
revoke execute on function public.stock_note_unpack(uuid) from public, anon, authenticated;
revoke execute on function public.stock_log(text, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.pack_package(uuid, uuid) from public, anon;
revoke execute on function public.unpack_package(uuid, uuid) from public, anon;
grant execute on function public.pack_package(uuid, uuid) to authenticated, service_role;
grant execute on function public.unpack_package(uuid, uuid) to authenticated, service_role;
do $do$
declare
  f text;
begin
  foreach f in array array[
    'stock_retry_issue(bigint)', 'stock_confirm_return(uuid, jsonb, text, uuid)', 'stock_resolve_discrepancy(bigint, text)',
    'stock_record_movement(uuid, uuid, text, int, text, timestamptz, text, uuid)', 'stock_transfer(uuid, uuid, uuid, int, text, uuid)',
    'stock_save_warehouse(jsonb)', 'stock_save_item(jsonb)', 'stock_save_sku(jsonb)', 'stock_save_alias(text, text, uuid, int)', 'stock_seed_catalog()',
    'stock_inventory_open(uuid, date, text, uuid)', 'stock_inventory_save_line(uuid, uuid, int, int, boolean, text, uuid, text, text)',
    'stock_inventory_close(uuid, timestamptz, uuid)', 'stock_inventory_approve(uuid)', 'stock_backfill_since_baseline()', 'stock_set_deduction(boolean)',
    'stock_set_approvers(uuid[])', 'stock_order_create(text, date, jsonb, text, uuid)', 'stock_order_step(uuid, text, uuid)',
    'stock_order_mark_exported(uuid, text, uuid)', 'stock_order_mark_sent(uuid, text, text, text, uuid)', 'stock_order_reconcile_send(uuid, text, text, uuid)',
    'stock_order_confirm(uuid, text, uuid)', 'stock_order_receive(uuid, jsonb, text, uuid)', 'stock_is_approver()', 'stock_me_name()']
  loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $do$;
