/**
 * Sklad v appke (0021_sklad.sql) on PGlite: výdaj pri zabalení, Späť bez vrátenia, inventúra v presnom čase,
 * spätné doplnenie bez dvojitého odpočtu, objednávky a oprávnenia vynútené v databáze.
 * Expected behaviour comes from the zadanie of 17. 11. 2026 (not from the implementation).
 */
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { planIssue, proposeOrder, type IssueAlias, type PackSnapshot, type SupplierSku } from '@/core/stock';

const DIR = new URL('../../supabase/migrations/', import.meta.url);
const read = (f: string) => readFileSync(new URL(f, DIR), 'utf8');

const STUBS = `
create role authenticated nologin;
create role anon nologin;
create role service_role nologin;
create role supabase_auth_admin nologin;
create role supabase_realtime_admin nologin;
create schema if not exists auth;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
create or replace function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create or replace function auth.jwt() returns jsonb language sql stable as
  $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
grant usage on schema public to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
`;
const APP_USERS_STUB = `
create table if not exists public.app_users (email text primary key, name text not null, roles text[] not null default '{}', active boolean not null default true);
create or replace function public.current_app_roles() returns text[] language sql stable security definer set search_path to 'public' as
  $$ select coalesce((select roles from public.app_users where lower(email)=lower(auth.jwt()->>'email') and active), '{}') $$;
`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
let db: PGlite;
let seq = 0;
const q = async <T extends Row = Row>(text: string, params: unknown[] = []) => (await db.query<T>(text, params)).rows;
const one = async <T extends Row = Row>(text: string, params: unknown[] = []) => (await q<T>(text, params))[0];
const actAs = (id: string | null) => q("select set_config('request.jwt.claim.sub', $1, false)", [id ?? '']);
const rpc = async (fn: string, ...args: unknown[]) => (await one(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(', ')}) as r`, args)).r as Row;
const fails = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return (e as { code?: string; message: string }).code ?? e;
  }
  return null;
};

async function newUser(name: string, role: 'staff' | 'admin' = 'staff', active = true) {
  const id = randomUUID();
  await q('insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3::jsonb)', [id, `u${++seq}@example.com`, JSON.stringify({ display_name: name })]);
  await q('update public.profiles set role = $2, active = $3 where id = $1', [id, role, active]);
  return id;
}

let staff: string, staff2: string, admin: string, admin2: string, gone: string;
let W: string, FL: string, CL: string; // sklad, byty, čistá bielizeň
const I: Record<string, string> = {}; // items

const uuid = () => randomUUID();
const movements = (item: string, kind?: string) =>
  q('select * from public.stock_movements where item_id = $1 and ($2::text is null or kind = $2) order by id', [item, kind ?? null]);
const onHand = async (item: string) => (await one('select qty from public.stock_on_hand where item_id = $1', [item]))?.qty as number | undefined;
const batches = (pkg: string) => q('select * from public.stock_issue_batches where package_id = $1 order by opened_at, id', [pkg]);

let tag = 0;
async function newPackage(items: Row) {
  const c = {
    outgoing_reservation_id: `res-${++seq}`, listing_id: `lst-${++tag}`, listing_name: `BA: Byt ${tag}`,
    date: (await one('select public.today_ba()::text as d')).d, incoming_reservation_id: null, same_day: false, gap_nights: 2, gap_blocked: false,
    target_people: 2, people_source: 'gap', computed_items: items, computed_hash: 'h-' + seq, warnings: [],
  };
  const row = await one('select * from public.sync_upsert_package($1::jsonb) as p', [JSON.stringify(c)]);
  return { id: row.id as string, c };
}
const recompute = async (c: Row, items: Row) =>
  one('select * from public.sync_upsert_package($1::jsonb)', [JSON.stringify({ ...c, computed_items: items, computed_hash: 'h2-' + ++seq })]);
const pack = async (pkgId: string, by = staff, action = uuid()) => (await actAs(by), rpc('pack_package', pkgId, action));
const unpack = async (pkgId: string, by = staff) => (await actAs(by), rpc('unpack_package', pkgId, uuid()));

const items = (tp: number, extra: Row = {}) => ({
  linen: [], consumables: tp ? [{ key: 'toaletak', label: 'Toaletný papier', size: '', n: tp, source: 'calc' }] : [], capsules: [], ...extra,
});

async function approvedBaseline(counts: Record<string, { packs?: number; loose?: number; zero?: boolean }>) {
  await actAs(admin);
  // jedna inventúra na sklad (bielizeň je v sklade čistej bielizne); prvá schválená je začiatočný stav
  const byWh = new Map<string, [string, { packs?: number; loose?: number; zero?: boolean }][]>();
  for (const [item, c] of Object.entries(counts)) {
    const wh = item === 'sheet' ? CL : W;
    byWh.set(wh, [...(byWh.get(wh) ?? []), [item, c]]);
  }
  let first = '';
  for (const [wh, lines] of byWh) {
    const inv = await rpc('stock_inventory_open', wh, '2026-11-17', 'Začiatočná inventúra', uuid());
    for (const [item, c] of lines) {
      const r = await rpc('stock_inventory_save_line', inv.id, I[item], c.packs ?? null, c.loose ?? null, c.zero ?? false, '', null, '', 'app');
      expect(r.ok).toBe(true);
    }
    expect((await rpc('stock_inventory_close', inv.id, null, uuid())).ok).toBe(true);
    expect((await rpc('stock_inventory_approve', inv.id)).ok).toBe(true);
    first ||= inv.id;
  }
  return first;
}

async function resetStock() {
  // each test starts from a clean stock state; the movement table is append-only, so tables are emptied with truncate (superuser)
  await q('truncate public.stock_discrepancies, public.stock_unmapped_issues, public.stock_issue_errors, public.stock_receipt_lines, public.stock_receipts, public.stock_order_events, public.stock_order_lines, public.stock_orders, public.stock_movements, public.stock_issue_batches, public.stock_inventory_lines, public.stock_inventories, public.stock_supplier_skus, public.stock_audit cascade');
  await q('update public.stock_config set deduction_enabled = false, baseline_inventory_id = null, baseline_at = null, order_approvers = \'{}\', strict_atomic = false');
  await q('truncate public.package_events, public.packages cascade').catch(() => null);
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STUBS);
  await db.exec('set check_function_bodies = off');
  const files = readdirSync(DIR).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
  for (const f of files) {
    if (f.startsWith('0018_')) await db.exec(APP_USERS_STUB);
    await db.exec(read(f));
  }
  await db.exec('set check_function_bodies = on');

  staff = await newUser('Angelika');
  staff2 = await newUser('Zuzka');
  admin = await newUser('Martina', 'admin');
  admin2 = await newUser('Július', 'admin');
  gone = await newUser('Preč', 'staff', false);
  await actAs(admin);
  W = (await rpc('stock_save_warehouse', { name: 'Sklad BA', city: 'Bratislava', kind: 'warehouse' })).id;
  FL = (await rpc('stock_save_warehouse', { name: 'Byty BA', city: 'Bratislava', kind: 'flats' })).id;
  CL = (await rpc('stock_save_warehouse', { name: 'Čistá bielizeň BA', city: 'Bratislava', kind: 'clean' })).id;
  const mk = async (key: string, p: Row, kind: string, alias: string | null, wh: string, factor = 1) => {
    I[key] = (await rpc('stock_save_item', { kind, home_warehouse_id: wh, ...p })).id;
    if (alias) await rpc('stock_save_alias', kind, alias, I[key], factor);
  };
  await mk('tp', { product: 'Toaletný papier', category: 'spotrebný materiál', base_unit: 'rolka' }, 'consumable', 'toaletak', W);
  await mk('bagL', { product: 'Vrecko do koša', variant: 'veľké' }, 'consumable', 'vreckoV', W);
  await mk('orig', { product: 'Kávové kapsule', system: 'Nespresso Original' }, 'capsule', 'nespresso original', W);
  await mk('vertuo', { product: 'Kávové kapsule', system: 'Nespresso Vertuo' }, 'capsule', 'nespresso vertuo', W);
  await mk('sheet', { product: 'Plachta', variant: 'dvojlôžko' }, 'linen', 'plachta|dvoj', CL);
});
afterAll(async () => {
  await db?.close();
});
beforeEach(async () => {
  await actAs(null);
  await resetStock();
});

describe('návrat migrácie', () => {
  it('krok A vráti balenie na pôvodné definície: pack/unpack fungujú bez skladu a bez zásahu do histórie', async () => {
    await approvedBaseline({ tp: { loose: 100 } });
    await actAs(admin);
    await rpc('stock_set_deduction', true);
    const before = await newPackage(items(2));
    await pack(before.id);
    expect(await onHand(I.tp)).toBe(98);
    const rb = readFileSync(new URL('../../supabase/rollback/0021_sklad_rollback.sql', import.meta.url), 'utf8');
    const stepA = rb.slice(0, rb.indexOf('-- ------------------------------------------------------------------ krok B') > 0 ? rb.indexOf('-- ---------------------------------------------------------------- krok B') : undefined);
    await db.exec(stepA);
    const after = await newPackage(items(4));
    expect(await pack(after.id)).toMatchObject({ ok: true });
    expect(await unpack(after.id)).toMatchObject({ ok: true, status: 'todo' });
    expect(await onHand(I.tp)).toBe(98); // nič sa nevydalo
    expect((await one('select deduction_enabled from public.stock_config')).deduction_enabled).toBe(false);
    // vrátenie späť na novú verziu pre ostatné testy
    await db.exec('set check_function_bodies = off');
    await db.exec(read('0021_sklad.sql'));
    await db.exec('set check_function_bodies = on');
  });
});

describe('migrácia je aditívna a odpočty sú predvolene vypnuté', () => {
  it('pri vypnutých odpočtoch zabalenie nič nevydá a správa sa ako doteraz', async () => {
    const p = await newPackage(items(3));
    const r = await pack(p.id);
    expect(r).toMatchObject({ ok: true, status: 'packed' });
    expect(await movements(I.tp)).toHaveLength(0);
    expect(await batches(p.id)).toHaveLength(0);
    const ev = await one("select data from public.package_events where package_id = $1 and event = 'packed'", [p.id]);
    expect(ev.data.consumables[0]).toMatchObject({ key: 'toaletak', n: 3 }); // snapshot sa ukladá ako predtým
  });

  it('zapnúť odpočty sa nedá bez schválenej začiatočnej inventúry', async () => {
    await actAs(admin);
    expect(await rpc('stock_set_deduction', true)).toMatchObject({ ok: false, status: 'no_baseline' });
    expect((await one('select deduction_enabled from public.stock_config')).deduction_enabled).toBe(false);
  });
});

describe('inventúra a začiatočný stav', () => {
  it('prázdne pole nie je nula; overená nula je stav 0; celé balenia bez overeného prepočtu blokujú uzávierku', async () => {
    await actAs(admin);
    const inv = await rpc('stock_inventory_open', W, '2026-11-17', 'Test', uuid());
    // balenie bez ponuky: neoverené
    const unv = await rpc('stock_inventory_save_line', inv.id, I.tp, 3, 2, false, 'A1', null, '', 'app');
    expect(unv).toMatchObject({ ok: true, state: 'unverified' });
    expect(await rpc('stock_inventory_close', inv.id, null, uuid())).toMatchObject({ ok: false, status: 'unverified_lines' });
    // ponuka s overeným prepočtom
    await rpc('stock_save_sku', { item_id: I.tp, supplier: 'A', purchase_unit: 'pack', pieces_per_pack: 20, valid_from: '2026-01-01', verified_source: 'cenová ponuka', verified_at: '2026-11-01' });
    const ok = await rpc('stock_inventory_save_line', inv.id, I.tp, 3, 2, false, 'A1', null, '', 'app');
    expect(ok).toMatchObject({ state: 'counted', total: 62 }); // 3 × 20 + 2
    await rpc('stock_inventory_save_line', inv.id, I.bagL, null, null, true, '', null, '', 'app'); // overená nula
    await rpc('stock_inventory_save_line', inv.id, I.orig, null, null, false, '', null, '', 'app'); // prázdne
    expect(await rpc('stock_inventory_save_line', inv.id, I.vertuo, 1, null, true, '', null, '', 'app')).toMatchObject({ ok: false, status: 'bad_zero' });
    expect(await rpc('stock_inventory_save_line', inv.id, I.vertuo, -1, null, false, '', null, '', 'app')).toMatchObject({ ok: false });
    expect(await rpc('stock_inventory_close', inv.id, null, uuid())).toMatchObject({ ok: true, status: 'closed' });
    expect(await onHand(I.tp)).toBe(62);
    expect(await onHand(I.bagL)).toBe(0); // overená nula = známy stav 0
    expect(await onHand(I.orig)).toBeUndefined(); // prázdne = neznáme, nie 0
    // uzavretú inventúru už nemožno upraviť
    expect(await rpc('stock_inventory_save_line', inv.id, I.tp, 1, 0, false, '', null, '', 'app')).toMatchObject({ ok: false, status: 'closed' });
  });

  it('uzávierka v presnom čase: rozdiel sa zapíše pohybom, pohyby po uzávierke sa nepreráta, minulosť sa neprepisuje', async () => {
    await actAs(admin);
    await rpc('stock_save_sku', { item_id: I.tp, supplier: 'A', pieces_per_pack: 10, valid_from: '2026-01-01', verified_source: 'ponuka', verified_at: '2026-11-01' });
    await approvedBaseline({ tp: { loose: 100 } });
    await actAs(staff);
    await rpc('stock_record_movement', I.tp, W, 'issue_manual', 10, 'do bytu', null, null, uuid());
    // druhá inventúra: napočítané 85 vs očakávaných 90
    await actAs(admin);
    const inv2 = await rpc('stock_inventory_open', W, '2026-11-18', 'Druhá', uuid());
    await rpc('stock_inventory_save_line', inv2.id, I.tp, null, 85, false, '', null, '', 'app');
    const cut = (await one('select clock_timestamp()::text as t')).t;
    const closed = await rpc('stock_inventory_close', inv2.id, cut, uuid());
    expect(closed).toMatchObject({ ok: true, differences: 1 });
    const diff = (await movements(I.tp, 'inventory_difference'))[0];
    expect(diff).toMatchObject({ qty: -5 });
    expect(diff.meta).toMatchObject({ expected: 90, counted: 85 });
    expect(await onHand(I.tp)).toBe(85);
    // pohyb po uzávierke sa pripočíta
    await actAs(staff);
    await rpc('stock_record_movement', I.tp, W, 'issue_manual', 5, 'po uzávierke', null, null, uuid());
    expect(await onHand(I.tp)).toBe(80);
    // ručný pohyb s časom pred uzávierkou sa zapíše na uzávierku a pôvodný čas ostane v poznámke
    const late = await rpc('stock_record_movement', I.tp, W, 'issue_manual', 1, 'oneskorený zápis', '2026-11-17T08:00:00Z', null, uuid());
    expect(late.shifted).toBe(true);
    const m = await one('select occurred_at, meta from public.stock_movements where id = $1', [late.id]);
    const invRow = await one('select cut_at from public.stock_inventories where id = $1', [inv2.id]);
    expect(new Date(m.occurred_at).getTime()).toBe(new Date(invRow.cut_at).getTime());
    expect(m.meta.shifted_to_cut).toBe(true);
    // uzávierka pred predošlou sa odmietne
    await actAs(admin);
    const inv3 = await rpc('stock_inventory_open', W, '2026-11-19', 'Tretia', uuid());
    expect(await rpc('stock_inventory_close', inv3.id, '2020-01-01T00:00:00Z', uuid())).toMatchObject({ ok: false, status: 'cut_before_previous' });
    expect(await rpc('stock_inventory_close', inv3.id, '2099-01-01T00:00:00Z', uuid())).toMatchObject({ ok: false, status: 'future_cut' });
  });

  it('kniha pohybov je append-only: opravy len novým pohybom', async () => {
    await approvedBaseline({ tp: { loose: 10 } });
    const m = (await movements(I.tp))[0];
    expect(await fails(q('update public.stock_movements set qty = 99 where id = $1', [m.id]))).toBe('42501');
    expect(await fails(q('delete from public.stock_movements where id = $1', [m.id]))).toBe('42501');
    expect(await fails(q('update public.stock_audit set action = $1', ['x']))).toBe('42501');
  });
});

describe('Zabalené = výdaj zo skladu', () => {
  beforeEach(async () => {
    await approvedBaseline({ tp: { loose: 100 }, bagL: { loose: 50 }, orig: { loose: 40 }, vertuo: { loose: 40 }, sheet: { loose: 30 } });
    await actAs(admin);
    expect((await rpc('stock_set_deduction', true)).ok).toBe(true);
  });

  it('vydá presne zo snapshotu v tej istej transakcii, vrátane kávových systémov a bielizne', async () => {
    const p = await newPackage({
      linen: [{ key: 'plachta', label: 'Plachta', size: 'dvoj', n: 2, source: 'calc' }],
      consumables: [{ key: 'toaletak', n: 3 }, { key: 'vreckoV', n: 2 }],
      capsules: [{ type: 'Nespresso Original', typeKey: 'nespresso original', n: 2, state: 'ok' }, { type: 'Nespresso Vertuo', typeKey: 'nespresso vertuo', n: 3, state: 'ok' }],
    });
    expect(await pack(p.id)).toMatchObject({ ok: true });
    expect(await onHand(I.tp)).toBe(97);
    expect(await onHand(I.bagL)).toBe(48);
    expect(await onHand(I.orig)).toBe(38);
    expect(await onHand(I.vertuo)).toBe(37); // Original ≠ Vertuo
    expect(await onHand(I.sheet)).toBe(28);
    const mv = (await movements(I.tp, 'issue_package'))[0];
    expect(mv).toMatchObject({ qty: -3, source_type: 'package_event', listing_id: p.c.listing_id });
    expect(mv.unique_key).toMatch(/^pkg:\d+:/);
    // bielizeň sa len presúva do bytov: nie je spotreba ani nákup
    expect((await movements(I.sheet)).map((m) => m.kind).sort()).toEqual(['linen_issue', 'opening_balance', 'transfer_in']);
    expect((await q('select qty from public.stock_movements where item_id = $1 and warehouse_id = $2', [I.sheet, FL])).map((r) => r.qty)).toEqual([2]);
    // dávka drží snapshot
    const [b] = await batches(p.id);
    expect(b).toMatchObject({ status: 'issued' });
    expect(b.held[I.tp]).toBe(3);
  });

  it('SQL plán výdaja = TypeScript planIssue (rovnaký výsledok pre ten istý snapshot)', async () => {
    const snap = {
      linen: [{ key: 'plachta', size: 'dvoj', n: 2 }, { key: 'plachta', size: 'jedno', n: 1 }],
      consumables: [{ key: 'toaletak', n: 3 }, { key: 'vreckoV', n: 2 }, { key: 'utierky', n: 1 }],
      capsules: [{ type: 'Nespresso Original', typeKey: 'nespresso original', n: 2 }, { type: '', typeKey: '', n: 2, state: 'missing' }, { type: 'Nespresso', typeKey: 'nespresso', n: 4 }],
    };
    const al: IssueAlias[] = [
      { kind: 'consumable', sourceKey: 'toaletak', itemId: I.tp, factor: 1 }, { kind: 'consumable', sourceKey: 'vreckoV', itemId: I.bagL, factor: 1 },
      { kind: 'capsule', sourceKey: 'nespresso original', itemId: I.orig, factor: 1 }, { kind: 'capsule', sourceKey: 'nespresso vertuo', itemId: I.vertuo, factor: 1 },
      { kind: 'linen', sourceKey: 'plachta|dvoj', itemId: I.sheet, factor: 1 },
    ];
    const ts = planIssue(snap as PackSnapshot, al);
    const sql = await q('select item_id, qty from public.stock_plan($1::jsonb) order by item_id', [JSON.stringify(snap)]);
    expect(sql.map((r) => [r.item_id, r.qty])).toEqual(ts.lines.map((l) => [l.itemId, l.qty]));
    const um = await q('select kind, skey from public.stock_plan_unmapped($1::jsonb) order by kind, skey', [JSON.stringify(snap)]);
    expect(um.map((r) => `${r.kind}:${r.skey}`).sort()).toEqual(ts.unmapped.map((u) => `${u.kind}:${u.sourceKey}`).sort());
  });

  it('nenamapované a neurčené riadky sa zapíšu na kontrolu; balenie nezablokujú a nič sa nehádá', async () => {
    const p = await newPackage({
      consumables: [{ key: 'utierky', n: 1 }],
      capsules: [{ type: '', typeKey: '', n: 2, state: 'missing' }, { type: 'Nespresso', typeKey: 'nespresso', n: 2, state: 'ok' }],
    });
    expect(await pack(p.id)).toMatchObject({ ok: true });
    const u = await q('select source_key, reason from public.stock_unmapped_issues order by source_key');
    expect(u.map((r) => r.source_key)).toEqual(['', 'nespresso', 'utierky']);
    expect(await onHand(I.orig)).toBe(40);
    expect(await onHand(I.vertuo)).toBe(40);
  });

  it('opakovanie rovnakej akcie, dvojklik a druhé zariadenie nikdy neodpočítajú dvakrát', async () => {
    const p = await newPackage(items(4));
    const action = uuid();
    expect(await pack(p.id, staff, action)).toMatchObject({ ok: true });
    expect(await pack(p.id, staff, action)).toMatchObject({ ok: true, replayed: true }); // retry po strate odpovede
    expect(await pack(p.id, staff, uuid())).toMatchObject({ ok: false, already_packed: true }); // dvojklik
    expect(await pack(p.id, staff2, uuid())).toMatchObject({ ok: false, already_packed: true }); // druhé zariadenie
    expect(await onHand(I.tp)).toBe(96);
    expect(await movements(I.tp, 'issue_package')).toHaveLength(1);
    // priame opakovanie internej funkcie na tej istej udalosti (napr. synchronizácia) je bez účinku
    const ev = await one("select id, data, actor, actor_name, created_at from public.package_events where package_id = $1 and event = 'packed'", [p.id]);
    const again = await one('select public.stock_issue_for_package($1, $2, $3::jsonb, $4, $5, $6) as r', [p.id, ev.id, JSON.stringify(ev.data), ev.actor, ev.actor_name, ev.created_at]);
    expect(again.r).toMatchObject({ issued: false });
    expect(await onHand(I.tp)).toBe(96);
    // aj priamy duplicitný zápis fyzického výdaja narazí na jedinečný kľúč
    const key = (await movements(I.tp, 'issue_package'))[0].unique_key;
    expect(await fails(q("insert into public.stock_movements (item_id, warehouse_id, kind, qty, unique_key) values ($1, $2, 'issue_package', -1, $3)", [I.tp, W, key]))).toBe('23505');
  });

  it('zmena požiadavky po zabalení nemení výdaj: platí snapshot z udalosti', async () => {
    const p = await newPackage(items(3));
    await pack(p.id);
    await recompute(p.c, items(7)); // prepočet karty
    expect(await onHand(I.tp)).toBe(97);
    expect((await movements(I.tp, 'issue_package'))[0].qty).toBe(-3);
  });

  it('výdaj patrí bytu z času zabalenia; výmena bytov v prepočte ho nepreráta', async () => {
    const p = await newPackage(items(3));
    await pack(p.id);
    await recompute({ ...p.c, listing_id: 'lst-swapped', listing_name: 'BA: Iný byt' }, items(3));
    const mv = (await movements(I.tp, 'issue_package'))[0];
    expect(mv.listing_id).toBe(p.c.listing_id);
    expect((await batches(p.id))[0].listing_id).toBe(p.c.listing_id);
    expect(await onHand(I.tp)).toBe(97);
  });

  it('chyba skladu nezablokuje balenie; fronta chýb sa zopakuje idempotentne', async () => {
    await q("create or replace function public.t_boom() returns trigger language plpgsql as $f$ begin raise exception 'boom'; end $f$");
    await q('create trigger t_boom before insert on public.stock_movements for each row execute function public.t_boom()');
    const p = await newPackage(items(5));
    expect(await pack(p.id)).toMatchObject({ ok: true, status: 'packed' });
    await q('drop trigger t_boom on public.stock_movements');
    expect(await movements(I.tp, 'issue_package')).toHaveLength(0);
    const err = await one('select * from public.stock_issue_errors');
    expect(err.error).toContain('boom');
    await actAs(admin);
    await rpc('stock_retry_issue', err.packed_event_id);
    await rpc('stock_retry_issue', err.packed_event_id);
    expect(await onHand(I.tp)).toBe(95);
    expect((await one('select resolved_at from public.stock_issue_errors')).resolved_at).not.toBeNull();
  });

  it('prísna atomicita (voliteľná): chyba skladu zruší aj zabalenie a nič sa nezapíše', async () => {
    await q('update public.stock_config set strict_atomic = true');
    await q("create or replace function public.t_boom() returns trigger language plpgsql as $f$ begin raise exception 'boom'; end $f$");
    await q('create trigger t_boom before insert on public.stock_movements for each row execute function public.t_boom()');
    const p = await newPackage(items(5));
    await actAs(staff);
    expect(await fails(rpc('pack_package', p.id, uuid()))).toBeTruthy();
    await q('drop trigger t_boom on public.stock_movements');
    await q('update public.stock_config set strict_atomic = false');
    expect((await one('select status from public.packages where id = $1', [p.id])).status).toBe('todo');
    expect(await q("select 1 from public.package_events where package_id = $1 and event = 'packed'", [p.id])).toHaveLength(0);
  });

  it('záporný stav sa nezablokuje: zobrazí sa a balenie prejde', async () => {
    const p = await newPackage(items(150));
    expect(await pack(p.id)).toMatchObject({ ok: true });
    expect(await onHand(I.tp)).toBe(-50);
  });

  it('položka bez začiatočného stavu: pohyb sa zapíše, stav ostáva neznámy (nie 0)', async () => {
    const extra = (await rpc('stock_save_item', { kind: 'consumable', product: 'Špongia', home_warehouse_id: W })).id;
    await rpc('stock_save_alias', 'consumable', 'spongia', extra, 1);
    const p = await newPackage({ consumables: [{ key: 'spongia', n: 2 }], capsules: [], linen: [] });
    await pack(p.id);
    expect(await movements(extra, 'issue_package')).toHaveLength(1);
    expect(await onHand(extra)).toBeUndefined();
  });
});

describe('Späť nie je fyzické vrátenie', () => {
  beforeEach(async () => {
    await approvedBaseline({ tp: { loose: 100 }, bagL: { loose: 50 } });
    await actAs(admin);
    await rpc('stock_set_deduction', true);
  });

  it('Späť sklad nevráti; nezrovnalosť čaká na potvrdenie; nové zabalenie bez vrátenia nevydá dvakrát', async () => {
    const p = await newPackage(items(4));
    await pack(p.id);
    expect(await unpack(p.id)).toMatchObject({ ok: true, status: 'todo' });
    expect(await onHand(I.tp)).toBe(96); // nič sa nevrátilo
    expect((await batches(p.id))[0].status).toBe('return_pending');
    expect((await q("select kind, status from public.stock_discrepancies")).map((d) => `${d.kind}:${d.status}`)).toEqual(['unpack_without_return:open']);
    // znovu zabalené bez vrátenia: rovnaká požiadavka = žiadny druhý výdaj
    await pack(p.id);
    expect(await onHand(I.tp)).toBe(96);
    expect(await movements(I.tp, 'issue_package')).toHaveLength(1);
    expect((await batches(p.id))[0].status).toBe('issued');
  });

  it('zmenená požiadavka po Späť: vydá sa len doplnenie; prebytok sa nevracia potichu, ide do nezrovnalostí', async () => {
    const p = await newPackage({ consumables: [{ key: 'toaletak', n: 4 }, { key: 'vreckoV', n: 2 }], capsules: [], linen: [] });
    await pack(p.id);
    await unpack(p.id);
    await recompute(p.c, { consumables: [{ key: 'toaletak', n: 6 }, { key: 'vreckoV', n: 1 }], capsules: [], linen: [] }); // výmena bytu / nová požiadavka
    await pack(p.id);
    expect(await onHand(I.tp)).toBe(94); // 100 − 4 − 2
    expect(await onHand(I.bagL)).toBe(48); // prebytok 1 sa nevrátil
    const d = await q("select kind, qty from public.stock_discrepancies where item_id = $1", [I.bagL]);
    expect(d).toEqual([{ kind: 'surplus_after_repack', qty: 1 }]);
    expect((await batches(p.id))).toHaveLength(1); // stále jedna dávka
  });

  it('potvrdené vrátenie vráti tovar a otvorí nový platný cyklus; história sa nemaže', async () => {
    const p = await newPackage(items(4));
    await pack(p.id);
    await unpack(p.id);
    const [b] = await batches(p.id);
    await actAs(staff);
    expect(await rpc('stock_confirm_return', b.id, null, 'vrátené do skladu', uuid())).toMatchObject({ ok: true, status: 'returned' });
    expect(await rpc('stock_confirm_return', b.id, null, 'znova', uuid())).toMatchObject({ replayed: true }); // opakovanie je bez účinku
    expect(await onHand(I.tp)).toBe(100);
    expect((await q("select status from public.stock_discrepancies")).every((d) => d.status === 'resolved')).toBe(true);
    // nové zabalenie = nový cyklus výdaja s novou dávkou
    await pack(p.id);
    expect(await onHand(I.tp)).toBe(96);
    const all = await batches(p.id);
    expect(all.map((x) => x.status).sort()).toEqual(['issued', 'returned']);
    expect((await movements(I.tp)).map((m) => m.kind)).toEqual(['opening_balance', 'issue_package', 'return', 'issue_package']);
  });

  it('čiastočné vrátenie zapíše zvyšok ako nezrovnalosť; správca ju uzavrie s dôvodom ("tovar ostal v byte")', async () => {
    const p = await newPackage(items(4));
    await pack(p.id);
    await unpack(p.id);
    const [b] = await batches(p.id);
    await actAs(staff);
    await rpc('stock_confirm_return', b.id, [{ item_id: I.tp, qty: 1 }], 'vrátená 1 rolka', uuid());
    expect(await onHand(I.tp)).toBe(97);
    const d = await one("select * from public.stock_discrepancies where kind = 'partial_return'");
    expect(d).toMatchObject({ qty: 3, status: 'open' });
    await actAs(staff);
    expect(await fails(rpc('stock_resolve_discrepancy', d.id, 'ostalo v byte'))).toBe('42501');
    await actAs(admin);
    expect(await rpc('stock_resolve_discrepancy', d.id, '')).toMatchObject({ ok: false, status: 'reason_required' });
    expect(await rpc('stock_resolve_discrepancy', d.id, 'ostalo v byte')).toMatchObject({ ok: true });
  });

  it('Späť bez vrátenia uzavretý ako "tovar ostal": dávka sa zatvorí a ďalšie zabalenie otvorí nový cyklus', async () => {
    const p = await newPackage(items(2));
    await pack(p.id);
    await unpack(p.id);
    const d = await one("select id from public.stock_discrepancies where kind = 'unpack_without_return'");
    await actAs(admin);
    await rpc('stock_resolve_discrepancy', d.id, 'tovar ostal v byte');
    expect((await batches(p.id))[0].status).toBe('closed_kept');
    await pack(p.id);
    expect(await onHand(I.tp)).toBe(96); // 100 − 2 − 2: druhý cyklus je nový výdaj
  });
});

describe('spätné doplnenie bez dvojitého odpočtu', () => {
  it('balenia pred uzávierkou sa nikdy nepočítajú; po uzávierke sa doplnia práve raz; zrušené (Späť) sa preskočia', async () => {
    const before = await newPackage(items(10));
    await pack(before.id); // pred inventúrou, odpočty vypnuté
    const inv = await approvedBaseline({ tp: { loose: 100 } }); // uzávierka po tomto balení
    expect(inv).toBeTruthy();
    const after = await newPackage(items(6));
    await pack(after.id); // po uzávierke, ešte pred zapnutím odpočtov
    const undone = await newPackage(items(3));
    await pack(undone.id);
    await unpack(undone.id);
    expect(await onHand(I.tp)).toBe(100); // zatiaľ nič nevydané
    await actAs(admin);
    const on = await rpc('stock_set_deduction', true);
    expect(on).toMatchObject({ ok: true, enabled: true });
    expect(on.backfill.issued_packages).toBe(1);
    expect(await onHand(I.tp)).toBe(94); // len "after" (6); "before" a Späť-nie
    expect(await batches(before.id)).toHaveLength(0);
    expect(await batches(undone.id)).toHaveLength(0);
    // opakované spustenie nič nepridá
    expect((await rpc('stock_backfill_since_baseline')).issued_packages).toBe(0);
    await rpc('stock_set_deduction', false);
    await rpc('stock_set_deduction', true);
    expect(await onHand(I.tp)).toBe(94);
    expect(await movements(I.tp, 'issue_package')).toHaveLength(1);
  });

  it('balenie počas vypnutých odpočtov sa pri ďalšom zapnutí doplní (nič sa nestratí)', async () => {
    await approvedBaseline({ tp: { loose: 100 } });
    await actAs(admin);
    await rpc('stock_set_deduction', true);
    await rpc('stock_set_deduction', false);
    const p = await newPackage(items(5));
    await pack(p.id);
    expect(await onHand(I.tp)).toBe(100);
    await actAs(admin);
    await rpc('stock_set_deduction', true);
    expect(await onHand(I.tp)).toBe(95);
  });
});

describe('ručné pohyby a oprávnenia', () => {
  beforeEach(async () => {
    await approvedBaseline({ tp: { loose: 100 } });
  });

  it('personál zapisuje výdaj/poškodenie/vrátenie s dôvodom; príjem, presun a katalóg len správca', async () => {
    await actAs(staff);
    expect(await rpc('stock_record_movement', I.tp, W, 'issue_flat', 5, 'doplnenie bytu', null, 'lst-1', uuid())).toMatchObject({ ok: true });
    expect(await rpc('stock_record_movement', I.tp, W, 'damage', 2, 'zmoknuté', null, null, uuid())).toMatchObject({ ok: true });
    expect(await rpc('stock_record_movement', I.tp, W, 'return', 1, 'nepoužité', null, null, uuid())).toMatchObject({ ok: true });
    expect(await rpc('stock_record_movement', I.tp, W, 'issue_manual', 1, '', null, null, uuid())).toMatchObject({ ok: false, status: 'reason_required' });
    expect(await rpc('stock_record_movement', I.tp, W, 'issue_manual', 0, 'x', null, null, uuid())).toMatchObject({ ok: false, status: 'bad_qty' });
    expect(await rpc('stock_record_movement', I.tp, W, 'issue_manual', 1, 'x', '2099-01-01T00:00:00Z', null, uuid())).toMatchObject({ ok: false, status: 'future' });
    expect(await rpc('stock_record_movement', I.tp, W, 'inventory_difference', 1, 'x', null, null, uuid())).toMatchObject({ ok: false, status: 'bad_kind' });
    expect(await onHand(I.tp)).toBe(94);
    // opakovanie rovnakej akcie sa nezapíše dvakrát
    const a = uuid();
    await rpc('stock_record_movement', I.tp, W, 'issue_manual', 3, 'dvakrát', null, null, a);
    await rpc('stock_record_movement', I.tp, W, 'issue_manual', 3, 'dvakrát', null, null, a);
    expect(await onHand(I.tp)).toBe(91);
    // zakázané pre personál
    expect(await fails(rpc('stock_record_movement', I.tp, W, 'receipt', 10, 'tovar', null, null, uuid()))).toBe('42501');
    expect(await fails(rpc('stock_transfer', I.tp, W, FL, 1, 'x', uuid()))).toBe('42501');
    expect(await fails(rpc('stock_save_item', { kind: 'consumable', product: 'X' }))).toBe('42501');
    expect(await fails(rpc('stock_inventory_open', W, '2026-11-20', 'x', uuid()))).toBe('42501');
    expect(await fails(rpc('stock_set_deduction', false))).toBe('42501');
    expect(await fails(rpc('stock_order_create', 'A', null, [], '', uuid()))).toBe('42501');
    // správca: príjem a presun
    await actAs(admin);
    expect(await rpc('stock_record_movement', I.tp, W, 'receipt', 10, 'dodávka', null, null, uuid())).toMatchObject({ ok: true });
    expect(await rpc('stock_transfer', I.tp, W, FL, 4, 'do bytov', uuid())).toMatchObject({ ok: true });
    expect(await onHand(I.tp)).toBe(97); // 100 − 5 − 2 + 1 − 3 + 10 (príjem) − 4 (presun do bytov)
  });

  it('neaktívny a neprihlásený používateľ nemá prístup; RLS: personál nevidí pohyby, vidí katalóg', async () => {
    for (const who of [gone, null]) {
      await actAs(who);
      expect(await fails(rpc('stock_record_movement', I.tp, W, 'issue_manual', 1, 'x', null, null, uuid()))).toBe('42501');
      expect(await fails(rpc('stock_confirm_return', uuid(), null, '', uuid()))).toBe('42501');
    }
    const view = async (who: string | null, table: string) => {
      await actAs(who);
      await db.exec('set role authenticated');
      try {
        return (await q(`select count(*)::int as n from public.${table}`))[0].n as number;
      } finally {
        await db.exec('reset role');
      }
    };
    expect(await view(staff, 'stock_movements')).toBe(0);
    expect(await view(staff, 'stock_orders')).toBe(0);
    expect(await view(staff, 'stock_items')).toBeGreaterThan(0);
    expect(await view(admin, 'stock_movements')).toBeGreaterThan(0);
    expect(await view(gone, 'stock_items')).toBe(0);
    // priamy zápis do knihy cez tabuľku je pre prihlásených zakázaný (len cez RPC)
    await actAs(admin);
    await db.exec('set role authenticated');
    try {
      expect(await fails(q("insert into public.stock_movements (item_id, warehouse_id, kind, qty) values ($1, $2, 'receipt', 99)", [I.tp, W]))).toBe('42501');
    } finally {
      await db.exec('reset role');
    }
  });
});

describe('objednávky', () => {
  let skuId: string;
  beforeEach(async () => {
    await approvedBaseline({ tp: { loose: 150 } });
    await actAs(admin);
    skuId = (await rpc('stock_save_sku', { item_id: I.tp, supplier: 'Dodávateľ A', purchase_unit: 'pack', pieces_per_pack: 20, price_cents: 1000, valid_from: '2026-01-01', verified_source: 'cenová ponuka', verified_at: '2026-11-01' })).id;
  });
  const line = (over: Row = {}) => ({ item_id: I.tp, sku_id: skuId, need_base: 476, reserve_base: 60, usable_base: 150, incoming_base: 0, ...over });

  it('príklad zo zadania: 476 + 60 − 150 = 386 → 20 balení; server prepočíta sám', async () => {
    await actAs(admin);
    const r = await rpc('stock_order_create', 'Dodávateľ A', '2026-12-01', [line()], '', uuid());
    expect(r).toMatchObject({ ok: true, lines: 1 });
    const l = await one('select * from public.stock_order_lines where order_id = $1', [r.id]);
    expect(l).toMatchObject({ raw_base: 386, suggested_units: 20, final_units: 20, packs: 20, pieces_per_pack: 20, basis: 'pack_rounding' });
  });

  it('ručná zmena počtu vyžaduje dôvod; neoverené balenie nedovolí objednávku', async () => {
    await actAs(admin);
    expect(await rpc('stock_order_create', 'A', null, [line({ final_units: 25 })], '', uuid())).toMatchObject({ ok: false, status: 'reason_required' });
    expect(await rpc('stock_order_create', 'A', null, [line({ final_units: 25, manual_reason: 'akcia' })], '', uuid())).toMatchObject({ ok: true });
    const unv = (await rpc('stock_save_sku', { item_id: I.bagL, supplier: 'B', pieces_per_pack: null, valid_from: '2026-01-01' })).id;
    expect(await rpc('stock_order_create', 'B', null, [{ item_id: I.bagL, sku_id: unv, need_base: 10 }], '', uuid())).toMatchObject({ ok: false, status: 'unverified' });
    const nosrc = (await rpc('stock_save_sku', { item_id: I.bagL, supplier: 'C', pieces_per_pack: 10, valid_from: '2026-01-01' })).id;
    expect(await rpc('stock_order_create', 'C', null, [{ item_id: I.bagL, sku_id: nosrc, need_base: 10 }], '', uuid())).toMatchObject({ ok: false, status: 'unverified' });
  });

  it('SQL výpočet balení = TypeScript proposeOrder', async () => {
    const cases: Partial<SupplierSku>[] = [
      { piecesPerPack: 20 }, { piecesPerPack: 20, minOrder: 30 }, { piecesPerPack: 7, purchaseUnit: 'carton', packsPerCarton: 6 },
      { piecesPerPack: 7, purchaseUnit: 'carton', packsPerCarton: 6, minOrder: 5 }, { piecesPerPack: 1000 },
    ];
    for (const c of cases) {
      for (const raw of [0, 1, 19, 20, 21, 386, 4999]) {
        const sku = { id: 's', itemId: 'i', supplier: 'A', sku: null, purchaseUnit: 'pack', piecesPerPack: 20, packsPerCarton: null, priceCents: null, currency: 'EUR', vatRate: null, validFrom: '2026-01-01', validTo: null, minOrder: null, leadTimeDays: null, verifiedSource: 'x', verifiedAt: '2026-01-01', ...c } as SupplierSku;
        const ts = proposeOrder({ need: raw, reserve: 0, usableStock: 0, incoming: 0, sku });
        const sql = await rpc('stock_units_for', raw, sku.piecesPerPack, sku.purchaseUnit, sku.packsPerCarton, sku.minOrder);
        if (ts.status !== 'ok') throw new Error('unexpected');
        expect(sql).toMatchObject({ status: 'ok', units: ts.units, packs: ts.packs, ordered_base: ts.orderedBase, basis: ts.basis });
      }
    }
  });

  it('postup návrh → kontrola → schválenie → odoslanie → potvrdenie → príjem; schvaľuje len oprávnená osoba', async () => {
    await actAs(admin);
    const { id } = await rpc('stock_order_create', 'Dodávateľ A', null, [line()], '', uuid());
    expect(await rpc('stock_order_step', id, 'approved', uuid())).toMatchObject({ ok: false, status: 'bad_transition' }); // preskočenie kontroly
    expect(await rpc('stock_order_step', id, 'review', uuid())).toMatchObject({ ok: true });
    await rpc('stock_set_approvers', [admin2]); // schvaľuje len Július
    expect(await fails(rpc('stock_order_step', id, 'approved', uuid()))).toBe('42501'); // správca mimo zoznamu
    await actAs(staff);
    expect(await fails(rpc('stock_order_step', id, 'approved', uuid()))).toBe('42501');
    await actAs(admin2);
    expect(await rpc('stock_order_step', id, 'approved', uuid())).toMatchObject({ ok: true, status: 'approved' });
    expect((await one('select approved_by_name from public.stock_orders where id = $1', [id])).approved_by_name).toBe('Július');
    // export ≠ odoslané
    expect(await rpc('stock_order_mark_exported', id, 'export', uuid())).toMatchObject({ send_state: 'not_sent' });
    expect((await one('select status, send_state from public.stock_orders where id = $1', [id]))).toEqual({ status: 'approved', send_state: 'not_sent' });
    // odoslanie: opakovanie z iného zariadenia nevytvorí druhý záznam
    const a1 = uuid();
    expect(await rpc('stock_order_mark_sent', id, 'email', 'sent', 'ref-1', a1)).toMatchObject({ ok: true, status: 'sent', send_state: 'sent' });
    expect(await rpc('stock_order_mark_sent', id, 'email', 'sent', 'ref-1', a1)).toMatchObject({ replayed: true });
    expect(await rpc('stock_order_mark_sent', id, 'email', 'sent', 'ref-1', uuid())).toMatchObject({ already_sent: true });
    expect((await q("select * from public.stock_order_events where order_id = $1 and event = 'sent'", [id]))).toHaveLength(1);
    expect(await q('select 1 from public.stock_orders')).toHaveLength(1);
    // stav sa nezvýšil, kým tovar fyzicky neprišiel
    expect(await onHand(I.tp)).toBe(150);
    await actAs(admin);
    expect(await rpc('stock_order_confirm', id, 'POT-7', uuid())).toMatchObject({ status: 'confirmed' });
    expect(await onHand(I.tp)).toBe(150);
    expect(((await one('select qty from public.stock_incoming where item_id = $1', [I.tp])).qty)).toBe(400); // potvrdený príjem
  });

  it('nejasný výsledok odoslania sa uzavrie overením a nevytvorí druhú objednávku', async () => {
    await actAs(admin);
    const { id } = await rpc('stock_order_create', 'A', null, [line()], '', uuid());
    await rpc('stock_order_step', id, 'review', uuid());
    await rpc('stock_order_step', id, 'approved', uuid());
    expect(await rpc('stock_order_mark_sent', id, 'api', 'ambiguous', null, uuid())).toMatchObject({ send_state: 'ambiguous', status: 'approved' });
    expect(await rpc('stock_order_reconcile_send', id, 'not_sent', null, uuid())).toMatchObject({ send_state: 'not_sent' });
    expect(await rpc('stock_order_mark_sent', id, 'api', 'sent', 'r', uuid())).toMatchObject({ send_state: 'sent' });
    expect(await q('select 1 from public.stock_orders')).toHaveLength(1);
  });

  it('vytvorenie objednávky je idempotentné (opakovanie nevytvorí druhú)', async () => {
    await actAs(admin);
    const a = uuid();
    const r1 = await rpc('stock_order_create', 'A', null, [line()], '', a);
    const r2 = await rpc('stock_order_create', 'A', null, [line()], '', a);
    expect(r2).toMatchObject({ replayed: true, id: r1.id });
    expect(await q('select 1 from public.stock_orders')).toHaveLength(1);
  });

  it('čiastočná a potom úplná dodávka: sklad rastie len pri príjme; opakovanie príjmu je bez účinku; zmena balenia dodávateľom nič nemení', async () => {
    await actAs(admin);
    const { id } = await rpc('stock_order_create', 'Dodávateľ A', null, [line()], '', uuid());
    await rpc('stock_order_step', id, 'review', uuid());
    await rpc('stock_order_step', id, 'approved', uuid());
    await rpc('stock_order_mark_sent', id, 'email', 'sent', null, uuid());
    const ol = (await one('select id from public.stock_order_lines where order_id = $1', [id])).id;
    // dodávateľ zmení balenie na 10 ks: objednávka drží pôvodných 20
    await rpc('stock_save_sku', { item_id: I.tp, supplier: 'Dodávateľ A', pieces_per_pack: 10, valid_from: '2026-12-01', verified_source: 'nová ponuka', verified_at: '2026-12-01' });
    const a = uuid();
    expect(await rpc('stock_order_receive', id, [{ order_line_id: ol, packs: 12 }], '1. dodávka', a)).toMatchObject({ ok: true, status: 'partially_received' });
    expect(await rpc('stock_order_receive', id, [{ order_line_id: ol, packs: 12 }], '1. dodávka', a)).toMatchObject({ replayed: true });
    expect(await onHand(I.tp)).toBe(150 + 12 * 20);
    expect(((await one('select qty from public.stock_incoming where item_id = $1', [I.tp])).qty)).toBe(8 * 20);
    expect(await rpc('stock_order_receive', id, [{ order_line_id: ol, packs: 8 }], '2. dodávka', uuid())).toMatchObject({ status: 'received' });
    expect(await onHand(I.tp)).toBe(150 + 400);
    expect((await q("select * from public.stock_movements where kind = 'receipt'")).every((m) => m.unique_key.startsWith('rcpt:'))).toBe(true);
    // doručená objednávka sa už zrušiť nedá
    expect(await rpc('stock_order_step', id, 'cancelled', uuid())).toMatchObject({ ok: false });
    // nová verzia ponuky zatvorila predchádzajúcu platnosť
    const olds = await q("select valid_to::text as vt from public.stock_supplier_skus where item_id = $1 and supplier = 'Dodávateľ A' order by valid_from", [I.tp]);
    expect(olds.map((x) => x.vt)).toEqual(['2026-11-30', null]);
  });
});
