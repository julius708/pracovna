/**
 * Black-box tests for supabase/migrations/0001_init.sql + 0002_sync_helpers.sql on PGlite.
 *
 * Expected behaviour comes from docs/PROPOSAL.md §4, §8, Appendix A and the spec §6:
 *  - status / note / checklist are never overwritten by the sync; the only staff write paths
 *    are pack_package / unpack_package / set_note / toggle_check, each writing one audit row;
 *  - a plain UPDATE of packages is refused by a guard trigger; package_events is immutable;
 *  - staff RPCs check the caller is an active profile and replay safely on a repeated client_action_id;
 *  - settings are versioned with a history row; sync helpers (lock, retention) are service-role only.
 *
 * Supabase-provided objects are stubbed the way the task describes (auth.users, auth.uid(),
 * roles anon/authenticated). Supabase also grants anon/authenticated the default privileges
 * on public objects, so the same default privileges are declared before the migrations run.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const MIG1 = readFileSync(new URL('../../supabase/migrations/0001_init.sql', import.meta.url), 'utf8');
const MIG2 = readFileSync(new URL('../../supabase/migrations/0002_sync_helpers.sql', import.meta.url), 'utf8');
const MIG6 = readFileSync(new URL('../../supabase/migrations/0006_access_rules.sql', import.meta.url), 'utf8');
const MIG7 = readFileSync(new URL('../../supabase/migrations/0007_board_notes.sql', import.meta.url), 'utf8');
const MIG8 = readFileSync(new URL('../../supabase/migrations/0008_board_notes_per_day.sql', import.meta.url), 'utf8');
const MIG9 = readFileSync(new URL('../../supabase/migrations/0009_board_notes_edit.sql', import.meta.url), 'utf8');
const MIG10 = readFileSync(new URL('../../supabase/migrations/0010_week_window.sql', import.meta.url), 'utf8');
const MIG11 = readFileSync(new URL('../../supabase/migrations/0011_pack_snapshot.sql', import.meta.url), 'utf8');
const MIG12 = readFileSync(new URL('../../supabase/migrations/0012_early_arrivals.sql', import.meta.url), 'utf8');
const MIG13 = readFileSync(new URL('../../supabase/migrations/0013_guesty_early_arrivals.sql', import.meta.url), 'utf8');
const MIG14 = readFileSync(new URL('../../supabase/migrations/0014_push_subscriptions.sql', import.meta.url), 'utf8');
const MIG15 = readFileSync(new URL('../../supabase/migrations/0015_board_note_replies.sql', import.meta.url), 'utf8');
const MIG16 = readFileSync(new URL('../../supabase/migrations/0016_manual_early_arrivals.sql', import.meta.url), 'utf8');

const STUBS = `
create role authenticated nologin;
create role anon nologin;
create schema if not exists auth;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
create or replace function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema public to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
`;

type PgErr = { code?: string; message: string; position?: string };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

/** Resolves to a compact copy of the database error (PGlite attaches the whole query text otherwise), or null. */
async function pgError(p: Promise<unknown>): Promise<PgErr | null> {
  try {
    await p;
  } catch (e) {
    const err = e as PgErr;
    return { code: err.code, message: err.message, position: err.position };
  }
  return null;
}

/** 1-based line of a character position inside a SQL text. */
const lineOf = (sql: string, position?: string) => (position ? sql.slice(0, Number(position)).split('\n').length : undefined);

// ------------------------------------------------------------------ 1. migrations apply cleanly
describe('migrations', () => {
  it('0001_init.sql and 0002_sync_helpers.sql apply cleanly on a fresh database with the Supabase stubs', async () => {
    const fresh = new PGlite();
    try {
      await fresh.exec(STUBS);
      const e1 = await pgError(fresh.exec(MIG1));
      expect(e1, `0001_init.sql failed: ${e1?.code} ${e1?.message} (line ${lineOf(MIG1, e1?.position)})`).toBeNull();
      const e2 = await pgError(fresh.exec(MIG2));
      expect(e2, `0002_sync_helpers.sql failed: ${e2?.code} ${e2?.message} (line ${lineOf(MIG2, e2?.position)})`).toBeNull();
      const e6 = await pgError(fresh.exec(MIG6));
      expect(e6, `0006_access_rules.sql failed: ${e6?.code} ${e6?.message} (line ${lineOf(MIG6, e6?.position)})`).toBeNull();
      const e7 = await pgError(fresh.exec(MIG7));
      expect(e7, `0007_board_notes.sql failed: ${e7?.code} ${e7?.message} (line ${lineOf(MIG7, e7?.position)})`).toBeNull();
      const e8 = await pgError(fresh.exec(MIG8));
      expect(e8, `0008_board_notes_per_day.sql failed: ${e8?.code} ${e8?.message} (line ${lineOf(MIG8, e8?.position)})`).toBeNull();
      const e9 = await pgError(fresh.exec(MIG9));
      expect(e9, `0009_board_notes_edit.sql failed: ${e9?.code} ${e9?.message} (line ${lineOf(MIG9, e9?.position)})`).toBeNull();
      const e10 = await pgError(fresh.exec(MIG10));
      expect(e10, `0010_week_window.sql failed: ${e10?.code} ${e10?.message} (line ${lineOf(MIG10, e10?.position)})`).toBeNull();
      const e11 = await pgError(fresh.exec(MIG11));
      expect(e11, `0011_pack_snapshot.sql failed: ${e11?.code} ${e11?.message} (line ${lineOf(MIG11, e11?.position)})`).toBeNull();
      const e12 = await pgError(fresh.exec(MIG12));
      expect(e12, `0012_early_arrivals.sql failed: ${e12?.code} ${e12?.message} (line ${lineOf(MIG12, e12?.position)})`).toBeNull();
      const e13 = await pgError(fresh.exec(MIG13));
      expect(e13, `0013_guesty_early_arrivals.sql failed: ${e13?.code} ${e13?.message} (line ${lineOf(MIG13, e13?.position)})`).toBeNull();
      // the manual entry of 0012 is withdrawn by 0013
      const gone = (await fresh.query<Row>("select proname from pg_proc where pronamespace = 'public'::regnamespace and proname in ('add_early_arrival', 'remove_early_arrival')")).rows;
      expect(gone).toEqual([]);
      const cols = (await fresh.query<Row>("select column_name from information_schema.columns where table_schema = 'public' and table_name = 'early_arrivals' and column_name in ('source', 'reservation_id')")).rows.map((r) => r.column_name).sort();
      expect(cols).toEqual(['reservation_id', 'source']);
      expect((await fresh.query<Row>("select column_name from information_schema.columns where table_schema = 'public' and table_name = 'reservations' and column_name = 'arrival_time'")).rows).toHaveLength(1);
      const e14 = await pgError(fresh.exec(MIG14));
      expect(e14, `0014_push_subscriptions.sql failed: ${e14?.code} ${e14?.message} (line ${lineOf(MIG14, e14?.position)})`).toBeNull();
      // users read only their own subscriptions; writes go through the two RPCs
      const policies = (await fresh.query<Row>("select policyname, cmd from pg_policies where schemaname = 'public' and tablename = 'push_subscriptions' order by policyname")).rows;
      expect(policies.map((p) => p.cmd)).toEqual(['SELECT']);
      const pushFns = (await fresh.query<Row>("select proname from pg_proc where pronamespace = 'public'::regnamespace and proname in ('save_push_subscription', 'remove_push_subscription') order by 1")).rows.map((r) => r.proname);
      expect(pushFns).toEqual(['remove_push_subscription', 'save_push_subscription']);
      const e15 = await pgError(fresh.exec(MIG15));
      expect(e15, `0015_board_note_replies.sql failed: ${e15?.code} ${e15?.message} (line ${lineOf(MIG15, e15?.position)})`).toBeNull();
      const e16 = await pgError(fresh.exec(MIG16));
      expect(e16, `0016_manual_early_arrivals.sql failed: ${e16?.code} ${e16?.message} (line ${lineOf(MIG16, e16?.position)})`).toBeNull();
      // 0016 brings the manual entry back
      const back = (await fresh.query<Row>("select proname from pg_proc where pronamespace = 'public'::regnamespace and proname in ('add_early_arrival', 'remove_early_arrival', 'add_board_reply') order by 1")).rows.map((r) => r.proname);
      expect(back).toEqual(['add_board_reply', 'add_early_arrival', 'remove_early_arrival']);
      const fns =(await fresh.query<Row>("select proname from pg_proc where pronamespace = 'public'::regnamespace order by 1")).rows.map((r) => r.proname);
      expect(fns).toEqual(expect.arrayContaining(['today_ba', 'is_admin', 'is_active_user', 'handle_new_user', 'sync_upsert_package', 'sync_set_lifecycle', 'pack_package', 'unpack_package', 'set_note', 'toggle_check', 'save_settings', 'admin_set_profile', 'acquire_lock', 'run_retention', 'increment_not_found', 'add_board_note', 'remove_board_note', 'edit_board_note']));
    } finally {
      await fresh.close();
    }
  });
});

// ------------------------------------------------------------------ shared database for the RPC tests
// The SQL-language helpers is_admin()/is_active_user() reference public.profiles before the table
// exists, so the raw file cannot load with the default check_function_bodies = on (see the test above).
// The shared instance loads the untouched files with body checking off; everything else is identical.
let db: PGlite;
let seq = 0;
/** today_ba() of the test database; packages default to it so the staff RPCs see them inside the visible window (0006). */
let todayBa = '2026-10-05';

const q = async <T extends Row = Row>(text: string, params: unknown[] = []) => (await db.query<T>(text, params)).rows;
const one = async <T extends Row = Row>(text: string, params: unknown[] = []) => (await q<T>(text, params))[0];
const actAs = (id: string | null) => q("select set_config('request.jwt.claim.sub', $1, false)", [id ?? '']);

async function newUser(name: string | null, opts: { role?: 'staff' | 'admin'; active?: boolean; email?: string } = {}) {
  const id = randomUUID();
  const email = opts.email ?? `user${++seq}@example.com`;
  const meta = name === null ? {} : { display_name: name };
  await q('insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3::jsonb)', [id, email, JSON.stringify(meta)]);
  if (opts.role || opts.active === false) {
    await q('update public.profiles set role = coalesce($2, role), active = coalesce($3, active) where id = $1', [id, opts.role ?? null, opts.active ?? null]);
  }
  return id;
}

function computed(over: Row = {}) {
  return {
    outgoing_reservation_id: `res-${++seq}`,
    listing_id: 'lst-1',
    listing_name: 'BA: Test 1',
    date: todayBa,
    incoming_reservation_id: null,
    same_day: false,
    gap_nights: 2,
    gap_blocked: false,
    target_people: 2,
    people_source: 'gap',
    computed_items: { linen: [{ item: 'Plachta', qty: 2 }], consumables: [] },
    computed_hash: 'hash-1',
    warnings: [],
    ...over,
  };
}

const upsert = (c: Row) => one('select * from public.sync_upsert_package($1::jsonb)', [JSON.stringify(c)]);
const pkg = (id: string) => one('select p.*, p.date::text as date from public.packages p where id = $1', [id]);
const events = (id: string, event?: string) =>
  q('select * from public.package_events where package_id = $1 and ($2::text is null or event = $2) order by id', [id, event ?? null]);

async function newPackage(over: Row = {}) {
  const c = computed(over);
  const row = await upsert(c);
  return { id: row.id as string, c };
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STUBS);
  await db.exec('set check_function_bodies = off');
  await db.exec(MIG1);
  await db.exec(MIG2);
  await db.exec(MIG6);
  await db.exec(MIG7);
  await db.exec(MIG8);
  await db.exec(MIG9);
  await db.exec(MIG10);
  await db.exec(MIG11);
  await db.exec(MIG12);
  await db.exec(MIG13);
  await db.exec(MIG14);
  await db.exec(MIG15);
  await db.exec(MIG16);
  await db.exec('set check_function_bodies = on');
  todayBa = (await one('select public.today_ba()::text as d')).d as string;
});
afterAll(async () => {
  await db?.close();
});
beforeEach(async () => {
  await actAs(null);
});

// ------------------------------------------------------------------ 2. profiles / helpers
describe('profiles and helper functions', () => {
  it('handle_new_user creates a staff profile named from raw_user_meta_data.display_name', async () => {
    const id = await newUser('Angelika');
    const p = await one('select * from public.profiles where id = $1', [id]);
    expect(p).toMatchObject({ display_name: 'Angelika', role: 'staff', active: true });
  });

  it('handle_new_user falls back to the e-mail local part when display_name is missing', async () => {
    const id = await newUser(null, { email: 'jozef.novak@example.com' });
    const p = await one('select display_name from public.profiles where id = $1', [id]);
    expect(p.display_name).toBe('jozef.novak');
  });

  it('is_admin / is_active_user follow the profile role and active flag', async () => {
    const staff = await newUser('Staff');
    const admin = await newUser('Admin', { role: 'admin' });
    const inactive = await newUser('Gone', { active: false });
    const check = () => one('select public.is_admin() as admin, public.is_active_user() as active');

    expect(await check()).toEqual({ admin: false, active: false }); // no caller
    await actAs(staff);
    expect(await check()).toEqual({ admin: false, active: true });
    await actAs(admin);
    expect(await check()).toEqual({ admin: true, active: true });
    await actAs(inactive);
    expect(await check()).toEqual({ admin: false, active: false });
    await actAs(randomUUID()); // authenticated user without a profile row
    expect(await check()).toEqual({ admin: false, active: false });
  });

  it('a deactivated admin is no longer an admin', async () => {
    const exAdmin = await newUser('ExAdmin', { role: 'admin', active: false });
    await actAs(exAdmin);
    expect(await one('select public.is_admin() as admin')).toEqual({ admin: false });
  });

  it('today_ba() returns a date in Europe/Bratislava', async () => {
    const r = await one("select pg_typeof(public.today_ba())::text as t, public.today_ba()::text as d, (now() at time zone 'Europe/Bratislava')::date::text as expected");
    expect(r.t).toBe('date');
    expect(r.d).toBe(r.expected);
  });

  it('guesty_tokens holds its single row after the migration', async () => {
    const rows = await q('select id, access_token, mints from public.guesty_tokens');
    expect(rows).toEqual([{ id: 1, access_token: null, mints: [] }]);
  });
});

// ------------------------------------------------------------------ 3. sync_upsert_package and the guard
describe('sync_upsert_package', () => {
  it('inserts a package with the default lifecycle and staff columns and returns the row', async () => {
    const c = computed();
    const row = await upsert(c);
    expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(row).toMatchObject({
      outgoing_reservation_id: c.outgoing_reservation_id,
      listing_id: 'lst-1',
      listing_name: 'BA: Test 1',
      target_people: 2,
      people_source: 'gap',
      computed_hash: 'hash-1',
      status: 'todo',
      hidden: false,
      note: '',
      note_by: null,
      packed_by: null,
      packed_at: null,
      checklist: { items: [], checked: {} },
    });
    expect(row.computed_items).toEqual(c.computed_items);
    expect((await pkg(row.id)).date).toBe(todayBa);
  });

  it('a second call for the same reservation updates only the computed columns and keeps note and packed state', async () => {
    const angelika = await newUser('Angelika');
    const { id, c } = await newPackage();
    await actAs(angelika);
    await q('select public.set_note($1, $2, $3)', [id, 'chýba paplón', randomUUID()]);
    await q('select public.pack_package($1, $2)', [id, randomUUID()]);
    const before = await pkg(id);
    expect(before).toMatchObject({ status: 'packed', note: 'chýba paplón', packed_by: angelika, packed_by_name: 'Angelika' });

    await actAs(null);
    const again = await upsert({ ...c, target_people: 4, computed_hash: 'hash-2', warnings: ['w1'], date: '2026-10-06', incoming_reservation_id: 'res-next' });
    expect(again.id).toBe(id);
    const after = await pkg(id);
    expect(after).toMatchObject({
      target_people: 4,
      computed_hash: 'hash-2',
      warnings: ['w1'],
      date: '2026-10-06',
      incoming_reservation_id: 'res-next',
      status: 'packed',
      note: 'chýba paplón',
      note_by: angelika,
      packed_by: angelika,
      packed_by_name: 'Angelika',
      packed_hash: before.packed_hash,
    });
    expect(after.packed_at).toEqual(before.packed_at);
    expect(await q('select 1 from public.packages where outgoing_reservation_id = $1', [c.outgoing_reservation_id])).toHaveLength(1);
  });

  it('ignores staff and lifecycle keys smuggled into the payload', async () => {
    const { id, c } = await newPackage();
    await upsert({ ...c, note: 'hacked', status: 'packed', packed_by_name: 'Mallory', hidden: true, checklist: { items: ['x'], checked: { x: true } } });
    expect(await pkg(id)).toMatchObject({ note: '', status: 'todo', packed_by_name: null, hidden: false, checklist: { items: [], checked: {} } });
  });

  it('a plain UPDATE of status, note or a computed column is refused with 42501', async () => {
    const { id } = await newPackage();
    const e1 = await pgError(q("update public.packages set status = 'packed' where id = $1", [id]));
    expect(e1?.code).toBe('42501');
    const e2 = await pgError(q("update public.packages set note = 'direct' where id = $1", [id]));
    expect(e2?.code).toBe('42501');
    const e3 = await pgError(q('update public.packages set target_people = 9 where id = $1', [id]));
    expect(e3?.code).toBe('42501');
    const e4 = await pgError(q("update public.packages set packed_by_name = 'X', packed_at = now() where id = $1", [id]));
    expect(e4?.code).toBe('42501');
    expect(await pkg(id)).toMatchObject({ status: 'todo', note: '', target_people: 2, packed_by_name: null });
  });
});

// ------------------------------------------------------------------ 4. pack / unpack
describe('pack_package / unpack_package', () => {
  it('happy path sets packed_by, packed_by_name, packed_at, packed_hash and writes one event', async () => {
    const angelika = await newUser('Angelika');
    const { id, c } = await newPackage();
    const action = randomUUID();
    await actAs(angelika);
    const res = await one('select public.pack_package($1, $2) as r', [id, action]);
    expect(res.r).toBeTruthy();
    expect(res.r.replayed ?? false).toBe(false);
    expect(res.r.already_packed ?? false).toBe(false);

    const row = await pkg(id);
    expect(row).toMatchObject({ status: 'packed', packed_by: angelika, packed_by_name: 'Angelika', packed_hash: c.computed_hash });
    expect(row.packed_at).toBeInstanceOf(Date);

    const ev = await events(id, 'packed');
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ actor: angelika, actor_name: 'Angelika', client_action_id: action, listing_id: 'lst-1', listing_name: 'BA: Test 1' });
    // the event keeps the card as packed (0011): people and the item lists from computed_items
    expect(ev[0].data).toEqual({ people: 2, linen: c.computed_items.linen, consumables: [], capsules: [], private: false });
    expect(String(ev[0].package_date instanceof Date ? ev[0].package_date.toISOString().slice(0, 10) : ev[0].package_date)).toBe(todayBa);
  });

  it('a second packer gets already_packed with the first name and no event is written', async () => {
    const angelika = await newUser('Angelika');
    const boris = await newUser('Boris');
    const { id } = await newPackage();
    await actAs(angelika);
    await q('select public.pack_package($1, $2)', [id, randomUUID()]);
    const packedAt = (await pkg(id)).packed_at;
    const countBefore = (await events(id)).length;

    await actAs(boris);
    const res = await one('select public.pack_package($1, $2) as r', [id, randomUUID()]);
    expect(res.r.already_packed).toBeTruthy();
    expect(JSON.stringify(res.r)).toContain('Angelika');
    expect(await pkg(id)).toMatchObject({ packed_by: angelika, packed_by_name: 'Angelika' });
    expect((await pkg(id)).packed_at).toEqual(packedAt);
    expect(await events(id)).toHaveLength(countBefore);
  });

  it('the same client_action_id replayed returns replayed:true and writes nothing new', async () => {
    const angelika = await newUser('Angelika');
    const { id } = await newPackage();
    const action = randomUUID();
    await actAs(angelika);
    const first = await one('select public.pack_package($1, $2) as r', [id, action]);
    expect(first.r.replayed ?? false).toBe(false);
    const snapshot = await pkg(id);
    const countBefore = (await events(id)).length;

    const second = await one('select public.pack_package($1, $2) as r', [id, action]);
    expect(second.r.replayed).toBe(true);
    expect(second.r.already_packed ?? false).toBe(false);
    expect(await pkg(id)).toEqual(snapshot);
    expect(await events(id)).toHaveLength(countBefore);
  });

  it('an inactive profile, a user without a profile and an anonymous caller are refused', async () => {
    const gone = await newUser('Gone', { active: false });
    const { id } = await newPackage();
    await actAs(gone);
    const e1 = await pgError(q('select public.pack_package($1, $2)', [id, randomUUID()]));
    expect(e1, 'inactive profile must be refused').not.toBeNull();
    await actAs(randomUUID());
    const e2 = await pgError(q('select public.pack_package($1, $2)', [id, randomUUID()]));
    expect(e2, 'unknown user must be refused').not.toBeNull();
    await actAs(null);
    const e3 = await pgError(q('select public.pack_package($1, $2)', [id, randomUUID()]));
    expect(e3, 'anonymous caller must be refused').not.toBeNull();
    expect(await pkg(id)).toMatchObject({ status: 'todo', packed_by: null });
    expect(await events(id)).toHaveLength(0);
  });

  it('unpack_package resets the packed fields and logs previously_packed_by', async () => {
    const angelika = await newUser('Angelika');
    const boris = await newUser('Boris');
    const { id } = await newPackage();
    await actAs(angelika);
    await q('select public.pack_package($1, $2)', [id, randomUUID()]);
    await actAs(boris);
    const action = randomUUID();
    const res = await one('select public.unpack_package($1, $2) as r', [id, action]);
    expect(res.r).toBeTruthy();
    expect(await pkg(id)).toMatchObject({ status: 'todo', packed_by: null, packed_by_name: null, packed_at: null, packed_hash: null });
    const ev = await events(id, 'unpacked');
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ actor: boris, actor_name: 'Boris', client_action_id: action });
    expect(ev[0].data).toHaveProperty('previously_packed_by');
    expect([angelika, 'Angelika']).toContain(ev[0].data.previously_packed_by);
  });
});

// ------------------------------------------------------------------ 5. note / checklist
describe('set_note / toggle_check', () => {
  it('set_note stores at most 200 characters with the author and writes a note event', async () => {
    const angelika = await newUser('Angelika');
    const { id } = await newPackage();
    const action = randomUUID();
    await actAs(angelika);
    await q('select public.set_note($1, $2, $3)', [id, 'ž'.repeat(250), action]);
    const row = await pkg(id);
    expect(row.note).toHaveLength(200);
    expect(row.note).toBe('ž'.repeat(200));
    expect(row).toMatchObject({ note_by: angelika, note_by_name: 'Angelika' });
    expect(row.note_at).toBeInstanceOf(Date);
    const ev = await events(id, 'note');
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ actor: angelika, actor_name: 'Angelika', client_action_id: action });
  });

  it('clearing the note nulls note_by', async () => {
    const angelika = await newUser('Angelika');
    const { id } = await newPackage();
    await actAs(angelika);
    await q('select public.set_note($1, $2, $3)', [id, 'niečo', randomUUID()]);
    expect(await pkg(id)).toMatchObject({ note: 'niečo', note_by: angelika });
    await q('select public.set_note($1, $2, $3)', [id, '', randomUUID()]);
    expect(await pkg(id)).toMatchObject({ note: '', note_by: null });
  });

  it('set_note replay with the same client_action_id is a no-op', async () => {
    const angelika = await newUser('Angelika');
    const { id } = await newPackage();
    const action = randomUUID();
    await actAs(angelika);
    await q('select public.set_note($1, $2, $3)', [id, 'prvá', action]);
    const res = await one('select public.set_note($1, $2, $3) as r', [id, 'druhá', action]);
    expect(res.r.replayed).toBe(true);
    expect((await pkg(id)).note).toBe('prvá');
    expect(await events(id, 'note')).toHaveLength(1);
  });

  it('toggle_check works while todo and returns the checked map', async () => {
    const angelika = await newUser('Angelika');
    const { id } = await newPackage();
    await actAs(angelika);
    const on = await one('select public.toggle_check($1, $2, $3, $4) as r', [id, 'Uteráky', true, randomUUID()]);
    const onMap = on.r.checked ?? on.r;
    expect(onMap).toMatchObject({ Uteráky: true });
    expect((await pkg(id)).checklist.checked).toMatchObject({ Uteráky: true });

    const two = await one('select public.toggle_check($1, $2, $3, $4) as r', [id, 'Plachty', true, randomUUID()]);
    expect(two.r.checked ?? two.r).toMatchObject({ Uteráky: true, Plachty: true });

    const off = await one('select public.toggle_check($1, $2, $3, $4) as r', [id, 'Uteráky', false, randomUUID()]);
    const offMap = off.r.checked ?? off.r;
    expect(offMap.Uteráky ?? false).toBe(false);
    expect(offMap).toMatchObject({ Plachty: true });
    expect((await pkg(id)).checklist.checked.Uteráky ?? false).toBe(false);
    expect(await events(id, 'checklist')).toHaveLength(3);
  });

  it('toggle_check is refused once the package is packed', async () => {
    const angelika = await newUser('Angelika');
    const { id } = await newPackage();
    await actAs(angelika);
    await q('select public.toggle_check($1, $2, $3, $4)', [id, 'Uteráky', true, randomUUID()]);
    await q('select public.pack_package($1, $2)', [id, randomUUID()]);
    const before = (await pkg(id)).checklist;
    const countBefore = (await events(id)).length;
    // "refused" = either an error or an ok:false result; either way nothing may change
    let refused = false;
    try {
      const r = await one('select public.toggle_check($1, $2, $3, $4) as r', [id, 'Uteráky', false, randomUUID()]);
      refused = r.r?.ok === false;
    } catch {
      refused = true;
    }
    expect(refused, 'toggle_check after packing must be refused').toBe(true);
    expect((await pkg(id)).checklist).toEqual(before);
    expect(await events(id)).toHaveLength(countBefore);
  });
});

// ------------------------------------------------------------------ 6. lifecycle + audit log immutability
describe('sync_set_lifecycle and package_events', () => {
  it('cancel hides the package with a reason and restore brings it back; packed fields survive', async () => {
    const angelika = await newUser('Angelika');
    const { id } = await newPackage();
    await actAs(angelika);
    await q('select public.pack_package($1, $2)', [id, randomUUID()]);
    await actAs(null);

    await q('select public.sync_set_lifecycle($1, $2, $3, $4)', [id, 'cancelled', true, 'reservation cancelled']);
    const cancelled = await pkg(id);
    expect(cancelled).toMatchObject({ status: 'cancelled', hidden: true, cancel_reason: 'reservation cancelled', packed_by: angelika, packed_by_name: 'Angelika' });
    expect(cancelled.cancelled_at).toBeInstanceOf(Date);

    await q('select public.sync_set_lifecycle($1, $2, $3, $4)', [id, 'todo', false, null]);
    const restored = await pkg(id);
    expect(restored).toMatchObject({ status: 'todo', hidden: false, cancel_reason: null, cancelled_at: null, packed_by: angelika });
  });

  it('null arguments leave the corresponding lifecycle column unchanged', async () => {
    const { id } = await newPackage();
    await q('select public.sync_set_lifecycle($1, $2, $3, $4)', [id, null, true, null]);
    expect(await pkg(id)).toMatchObject({ status: 'todo', hidden: true, cancel_reason: null });
    await q('select public.sync_set_lifecycle($1, $2, $3, $4)', [id, 'cancelled', null, 'gone']);
    expect(await pkg(id)).toMatchObject({ status: 'cancelled', hidden: true, cancel_reason: 'gone' });
  });

  it('package_events rows can be neither updated nor deleted', async () => {
    const angelika = await newUser('Angelika');
    const { id } = await newPackage();
    await actAs(angelika);
    await q('select public.pack_package($1, $2)', [id, randomUUID()]);
    const ev = (await events(id))[0];
    const e1 = await pgError(q("update public.package_events set actor_name = 'Mallory' where id = $1", [ev.id]));
    expect(e1, 'UPDATE must be refused').not.toBeNull();
    const e2 = await pgError(q('delete from public.package_events where id = $1', [ev.id]));
    expect(e2, 'DELETE must be refused').not.toBeNull();
    expect((await events(id))[0]).toMatchObject({ id: ev.id, actor_name: 'Angelika' });
  });
});

// ------------------------------------------------------------------ 7. locks and retention
describe('acquire_lock', () => {
  it('first caller wins, second is refused while the lease is live, same run re-acquires, expired lease is free', async () => {
    const name = `lock-${++seq}`;
    const lock = (run: string, ttl = 240) => one('select public.acquire_lock($1, $2, $3) as ok', [name, ttl, run]);
    expect((await lock('run-1')).ok).toBe(true);
    expect((await lock('run-2')).ok).toBe(false);
    expect((await lock('run-1')).ok).toBe(true);
    expect(await one('select run_id from public.sync_locks where name = $1', [name])).toEqual({ run_id: 'run-1' });

    await q("update public.sync_locks set locked_until = now() - interval '1 second' where name = $1", [name]);
    expect((await lock('run-3')).ok).toBe(true);
    const row = await one('select run_id, locked_until > now() as live from public.sync_locks where name = $1', [name]);
    expect(row).toEqual({ run_id: 'run-3', live: true });
    expect((await lock('run-1')).ok).toBe(false);
  });
});

describe('run_retention', () => {
  it('deletes old runs, old webhook payloads, old calendar days and unreferenced old reservations, keeps the rest', async () => {
    const now = new Date();
    const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();
    const ymdAgo = (d: number) => daysAgo(d).slice(0, 10);

    const oldRun = await one("insert into public.sync_runs (job, trigger, started_at) values ('reconcile', 'cron', $1) returning id", [daysAgo(40)]);
    const newRun = await one("insert into public.sync_runs (job, trigger, started_at) values ('reconcile', 'cron', $1) returning id", [daysAgo(10)]);
    const oldHook = await one("insert into public.webhook_events (svix_id, received_at, payload) values ($1, $2, '{}') returning id", [`svix-old-${++seq}`, daysAgo(100)]);
    const newHook = await one("insert into public.webhook_events (svix_id, received_at, payload) values ($1, $2, '{}') returning id", [`svix-new-${++seq}`, daysAgo(30)]);
    await q("insert into public.calendar_min_nights (listing_id, date, min_nights) values ('cal-l', $1, 1), ('cal-l', $2, 1), ('cal-l', $3, 1)", [ymdAgo(10), ymdAgo(1), ymdAgo(0)]);
    const res = (gid: string, checkOut: string) =>
      q("insert into public.reservations (guesty_id, listing_id, arrival_listing_id, status, check_in_date, check_out_date, fetched_at) values ($1, 'l', 'l', 'confirmed', $2, $2, now())", [gid, checkOut]);
    await res('old-unref', ymdAgo(90));
    await res('old-outgoing', ymdAgo(90));
    await res('old-incoming', ymdAgo(90));
    await res('recent-unref', ymdAgo(30));
    await newPackage({ outgoing_reservation_id: 'old-outgoing', incoming_reservation_id: 'old-incoming', date: ymdAgo(90) });

    const r = await one('select public.run_retention($1::timestamptz) as r', [now.toISOString()]);
    expect(r.r).toMatchObject({ sync_runs: 1, webhook_events: 1, calendar: 1, reservations: 1 });

    expect((await q('select id from public.sync_runs where id in ($1, $2)', [oldRun.id, newRun.id])).map((x) => x.id)).toEqual([newRun.id]);
    expect((await q('select id from public.webhook_events where id in ($1, $2)', [oldHook.id, newHook.id])).map((x) => x.id)).toEqual([newHook.id]);
    expect((await q("select date::text as d from public.calendar_min_nights where listing_id = 'cal-l' order by 1")).map((x) => x.d)).toEqual([ymdAgo(1), ymdAgo(0)]);
    expect((await q("select guesty_id from public.reservations where guesty_id in ('old-unref','old-outgoing','old-incoming','recent-unref') order by 1")).map((x) => x.guesty_id)).toEqual(['old-incoming', 'old-outgoing', 'recent-unref']);
  });

  it('increment_not_found bumps the counter of the reservation', async () => {
    await q("insert into public.reservations (guesty_id, listing_id, arrival_listing_id, status, check_in_date, check_out_date, fetched_at) values ('nf-1', 'l', 'l', 'confirmed', '2026-10-01', '2026-10-03', now())");
    await q("select public.increment_not_found('nf-1')");
    await q("select public.increment_not_found('nf-1')");
    expect(await one("select not_found_runs from public.reservations where guesty_id = 'nf-1'")).toEqual({ not_found_runs: 2 });
  });
});

// ------------------------------------------------------------------ 8. admin RPCs
describe('save_settings / admin_set_profile', () => {
  it('save_settings bumps the version, records who changed it and writes a history row; a stale version is a conflict', async () => {
    const admin = await newUser('Admin', { role: 'admin' });
    const key = `linen_table_${++seq}`;
    await q('insert into public.settings (key, value, version) values ($1, $2::jsonb, 1)', [key, JSON.stringify({ a: 1 })]);
    await actAs(admin);

    const ok = await one('select public.save_settings($1, $2::jsonb, $3) as r', [key, JSON.stringify({ a: 2 }), 1]);
    expect(ok.r).toBeTruthy();
    const row = await one('select value, version, updated_by from public.settings where key = $1', [key]);
    expect(row).toEqual({ value: { a: 2 }, version: 2, updated_by: admin });
    const hist = await q('select key, old_value, new_value, changed_by from public.settings_history where key = $1 order by id', [key]);
    expect(hist).toEqual([{ key, old_value: { a: 1 }, new_value: { a: 2 }, changed_by: admin }]);

    // stale expected version: must not overwrite
    const stale = await pgError(q('select public.save_settings($1, $2::jsonb, $3) as r', [key, JSON.stringify({ a: 3 }), 1]));
    if (stale === null) {
      const r = await one('select public.save_settings($1, $2::jsonb, $3) as r', [key, JSON.stringify({ a: 3 }), 1]);
      expect(r.r.ok ?? false, `expected a conflict result, got ${JSON.stringify(r.r)}`).toBe(false);
    }
    expect(await one('select value, version from public.settings where key = $1', [key])).toEqual({ value: { a: 2 }, version: 2 });
    expect(await q('select 1 from public.settings_history where key = $1', [key])).toHaveLength(1);
  });

  it('save_settings is refused for staff', async () => {
    const staff = await newUser('Staff');
    const key = `consumables_${++seq}`;
    await q('insert into public.settings (key, value, version) values ($1, $2::jsonb, 1)', [key, JSON.stringify({ a: 1 })]);
    await actAs(staff);
    const e = await pgError(q('select public.save_settings($1, $2::jsonb, $3)', [key, JSON.stringify({ a: 2 }), 1]));
    expect(e, 'staff must not save settings').not.toBeNull();
    expect(await one('select value, version from public.settings where key = $1', [key])).toEqual({ value: { a: 1 }, version: 1 });
  });

  it('admin_set_profile requires an admin caller and then updates role and active', async () => {
    const admin = await newUser('Admin', { role: 'admin' });
    const staff = await newUser('Staff');
    const target = await newUser('Target');

    await actAs(staff);
    const e1 = await pgError(q('select public.admin_set_profile($1, $2, $3)', [target, 'admin', true]));
    expect(e1, 'staff must not change profiles').not.toBeNull();
    await actAs(null);
    const e2 = await pgError(q('select public.admin_set_profile($1, $2, $3)', [target, 'admin', true]));
    expect(e2, 'anonymous caller must not change profiles').not.toBeNull();
    expect(await one('select role, active from public.profiles where id = $1', [target])).toEqual({ role: 'staff', active: true });

    await actAs(admin);
    await q('select public.admin_set_profile($1, $2, $3)', [target, 'admin', false]);
    expect(await one('select role, active from public.profiles where id = $1', [target])).toEqual({ role: 'admin', active: false });
    await q('select public.admin_set_profile($1, $2, $3)', [target, 'staff', true]);
    expect(await one('select role, active from public.profiles where id = $1', [target])).toEqual({ role: 'staff', active: true });
  });
});

// ------------------------------------------------------------------ 9. row level security and grants (as the authenticated role)
describe('row level security', () => {
  async function asAuthenticated<T>(userId: string | null, fn: () => Promise<T>): Promise<T> {
    await actAs(userId);
    await db.exec('set role authenticated');
    try {
      return await fn();
    } finally {
      await db.exec('reset role');
    }
  }

  it('staff see only visible packages from yesterday to day+6; admins see everything; inactive users see nothing', async () => {
    const staff = await newUser('Staff');
    const admin = await newUser('Admin', { role: 'admin' });
    const inactive = await newUser('Gone', { active: false });
    const today = (await one('select public.today_ba()::text as d')).d as string;
    const shift = (n: number) => {
      const d = new Date(`${today}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() + n);
      return d.toISOString().slice(0, 10);
    };
    const tag = `rls-${++seq}`;
    const mk = (n: number, hidden = false) => newPackage({ listing_id: tag, date: shift(n) }).then(async ({ id }) => {
      if (hidden) await q('select public.sync_set_lifecycle($1, $2, $3, $4)', [id, null, true, null]);
      return shift(n);
    });
    await mk(-2);
    await mk(-1);
    await mk(0);
    await mk(6);
    await mk(7);
    await mk(0, true);

    const visible = (uid: string | null) =>
      asAuthenticated(uid, async () => (await q('select date::text as d, hidden from public.packages where listing_id = $1 order by 1, 2', [tag])).map((r) => `${r.d}${r.hidden ? '!' : ''}`));
    expect(await visible(staff)).toEqual([shift(-1), shift(0), shift(6)]);
    expect(await visible(admin)).toEqual([shift(-2), shift(-1), shift(0), `${shift(0)}!`, shift(6), shift(7)]);
    expect(await visible(inactive)).toEqual([]);
    expect(await visible(null)).toEqual([]);
  });

  it('reservations, events and runs are admin-only and a deactivated admin sees none of them', async () => {
    const staff = await newUser('Staff');
    const admin = await newUser('Admin', { role: 'admin' });
    const exAdmin = await newUser('ExAdmin', { role: 'admin', active: false });
    await q("insert into public.reservations (guesty_id, listing_id, arrival_listing_id, status, check_in_date, check_out_date, fetched_at) values ('rls-res', 'l', 'l', 'confirmed', '2026-10-01', '2026-10-03', now())");
    const count = (uid: string | null) =>
      asAuthenticated(uid, async () => {
        const r = await one("select (select count(*) from public.reservations where guesty_id = 'rls-res')::int as res, (select count(*) from public.package_events)::int as ev, (select count(*) from public.sync_runs)::int as runs");
        return [r.res > 0, r.ev > 0, r.runs > 0];
      });
    expect(await count(admin)).toEqual([true, true, true]);
    expect(await count(staff)).toEqual([false, false, false]);
    expect(await count(null)).toEqual([false, false, false]);
    expect(await count(exAdmin)).toEqual([false, false, false]);
  });

  it('active users read settings and profiles; the sync helpers are not executable by authenticated', async () => {
    const staff = await newUser('Staff');
    await q("insert into public.settings (key, value) values ('rls-key', '{}') on conflict do nothing");
    const r = await asAuthenticated(staff, async () => ({
      settings: (await q("select key from public.settings where key = 'rls-key'")).length,
      profiles: (await q('select id from public.profiles where id = $1', [staff])).length,
      lock: await pgError(q("select public.acquire_lock('x', 10, 'r')")),
      retention: await pgError(q('select public.run_retention(now())')),
      upsert: await pgError(q('select public.sync_upsert_package($1::jsonb)', [JSON.stringify(computed())])),
      lifecycle: await pgError(q('select public.sync_set_lifecycle($1, $2, $3, $4)', [randomUUID(), 'cancelled', true, 'x'])),
      notFound: await pgError(q("select public.increment_not_found('x')")),
    }));
    expect(r.settings).toBe(1);
    expect(r.profiles).toBe(1);
    for (const k of ['lock', 'retention', 'upsert', 'lifecycle', 'notFound'] as const) {
      expect((r[k] as PgErr | null)?.code, `${k} must be refused for authenticated`).toBe('42501');
    }
  });
});

// ------------------------------------------------------------------ 9b. access rules of 0006
describe('0006 access rules', () => {
  async function asAuthenticated<T>(userId: string | null, fn: () => Promise<T>): Promise<T> {
    await actAs(userId);
    await db.exec('set role authenticated');
    try {
      return await fn();
    } finally {
      await db.exec('reset role');
    }
  }

  it('a deactivated user reads their own profile row and nothing else; active users still see everyone', async () => {
    const inactive = await newUser('Gone', { active: false });
    const other = await newUser('Other');
    const mine = await asAuthenticated(inactive, () => q('select id, active from public.profiles where id in ($1, $2)', [inactive, other]));
    expect(mine).toEqual([{ id: inactive, active: false }]);
    const all = await asAuthenticated(other, () => q('select id from public.profiles where id in ($1, $2) order by 1', [inactive, other]));
    expect(all.map((r) => r.id)).toEqual([inactive, other].sort());
    // still no data rows for the deactivated user
    expect(await asAuthenticated(inactive, () => q('select 1 from public.settings limit 1'))).toEqual([]);
  });

  it('an admin cannot deactivate or demote their own account, but may change other admins', async () => {
    const admin = await newUser('Admin', { role: 'admin' });
    const colleague = await newUser('Colleague', { role: 'admin' });
    await actAs(admin);
    const e1 = await pgError(q('select public.admin_set_profile($1, $2, $3)', [admin, null, false]));
    expect(e1?.message).toContain('self_change');
    const e2 = await pgError(q('select public.admin_set_profile($1, $2, $3)', [admin, 'staff', null]));
    expect(e2?.message).toContain('self_change');
    expect(await one('select role, active from public.profiles where id = $1', [admin])).toEqual({ role: 'admin', active: true });
    // a harmless self-change (keeping admin + active) and changes to others go through
    await q('select public.admin_set_profile($1, $2, $3)', [admin, 'admin', true]);
    await q('select public.admin_set_profile($1, $2, $3)', [colleague, 'staff', false]);
    expect(await one('select role, active from public.profiles where id = $1', [colleague])).toEqual({ role: 'staff', active: false });
    const missing = await pgError(q('select public.admin_set_profile($1, $2, $3)', [randomUUID(), 'admin', true]));
    expect(missing?.code).toBe('P0002');
  });

  it('staff RPCs refuse hidden rows and rows outside yesterday..day+6; admins may touch them', async () => {
    const staff = await newUser('Staff');
    const admin = await newUser('Admin', { role: 'admin' });
    const today = (await one('select public.today_ba()::text as d')).d as string;
    const shift = (n: number) => {
      const d = new Date(`${today}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() + n);
      return d.toISOString().slice(0, 10);
    };
    const old = await newPackage({ date: shift(-5) });
    const future = await newPackage({ date: shift(7) });
    const hidden = await newPackage({ date: shift(0) });
    await q('select public.sync_set_lifecycle($1, $2, $3, $4)', [hidden.id, null, true, null]);
    const edgeLow = await newPackage({ date: shift(-1) });
    const edgeHigh = await newPackage({ date: shift(6) });
    const refused = { ok: false, status: 'out_of_window' };

    await actAs(staff);
    expect((await one('select public.pack_package($1, $2) as r', [old.id, randomUUID()])).r).toEqual(refused);
    expect((await one('select public.pack_package($1, $2) as r', [future.id, randomUUID()])).r).toEqual(refused);
    expect((await one('select public.set_note($1, $2, $3) as r', [old.id, 'x', randomUUID()])).r).toEqual(refused);
    expect((await one('select public.toggle_check($1, $2, $3, $4) as r', [hidden.id, 'Kľúče', true, randomUUID()])).r).toEqual(refused);
    expect((await one('select public.pack_package($1, $2) as r', [hidden.id, randomUUID()])).r).toEqual(refused);
    expect(await events(old.id)).toEqual([]);
    expect((await pkg(old.id)).status).toBe('todo');
    expect((await one('select public.pack_package($1, $2) as r', [edgeLow.id, randomUUID()])).r).toMatchObject({ ok: true, status: 'packed' });
    expect((await one('select public.pack_package($1, $2) as r', [edgeHigh.id, randomUUID()])).r).toMatchObject({ ok: true, status: 'packed' });

    await actAs(admin);
    expect((await one('select public.pack_package($1, $2) as r', [old.id, randomUUID()])).r).toMatchObject({ ok: true, status: 'packed' });
    expect((await one('select public.set_note($1, $2, $3) as r', [future.id, 'admin note', randomUUID()])).r).toEqual({ ok: true });

    await actAs(staff);
    expect((await one('select public.unpack_package($1, $2) as r', [old.id, randomUUID()])).r).toEqual(refused);
    expect((await pkg(old.id)).status).toBe('packed');
  });
});

// ------------------------------------------------------------------ 10. realtime broadcast
describe('notify_board', () => {
  it('sends a message on the private topic "board" when a package, a setting, a note or an early arrival changes (realtime.send stub)', async () => {
    const rt = new PGlite();
    try {
      await rt.exec(STUBS);
      await rt.exec('set check_function_bodies = off');
      await rt.exec(MIG1);
      await rt.exec(MIG2);
      await rt.exec(MIG7);
      await rt.exec(MIG8);
      await rt.exec(MIG9);
      await rt.exec(MIG12);
      await rt.exec(MIG13);
      await rt.exec(`
        create schema realtime;
        create table realtime.messages (id bigserial primary key, topic text, event text, payload jsonb, private boolean);
        create function realtime.send(payload jsonb, event text, topic text, private boolean default true) returns void
        language sql as $$ insert into realtime.messages (topic, event, payload, private) values (topic, event, payload, private) $$;
      `);
      const c = computed();
      await rt.query('select public.sync_upsert_package($1::jsonb)', [JSON.stringify(c)]);
      await rt.query("insert into public.settings (key, value) values ('linen_table', '{}')");
      await rt.query("insert into public.board_notes (text, date, author_name) values ('skúška', current_date, 'Test')");
      await rt.query("insert into public.early_arrivals (listing_id, listing_name, date, arrival, author_name) values ('lst-x', 'Poštová, Heart', current_date, '12:00', 'Test')");
      const msgs = (await rt.query<Row>("select topic, private, payload->>'table' as t from realtime.messages order by id")).rows;
      expect(msgs.length).toBeGreaterThanOrEqual(4);
      expect(msgs.every((m) => m.topic === 'board')).toBe(true);
      expect(msgs.every((m) => m.private === true)).toBe(true);
      expect(msgs.map((m) => m.t)).toEqual(expect.arrayContaining(['packages', 'settings', 'board_notes', 'early_arrivals']));
    } finally {
      await rt.close();
    }
  });
});

// ------------------------------------------------------------------ 12. notice board (0007)
describe('push_subscriptions: save_push_subscription / remove_push_subscription (0014)', () => {
  const ENDPOINT = 'https://push.example.org/send/abc123def456';
  it('a device belongs to whoever is signed in on it: saving moves the endpoint, keys refresh, removal works for the current user', async () => {
    const eva = await newUser('Eva');
    const max = await newUser('Max');
    await actAs(eva);
    expect((await one('select public.save_push_subscription($1, $2, $3, $4) as r', [ENDPOINT, 'p256dh-key-eva', 'auth-eva', 'Safari'])).r).toEqual({ ok: true });
    let rows = await q('select user_id, user_name, p256dh, user_agent from public.push_subscriptions where endpoint = $1', [ENDPOINT]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ user_id: eva, user_name: 'Eva', p256dh: 'p256dh-key-eva', user_agent: 'Safari' });
    // the same device under Max: the row moves to Max
    await actAs(max);
    expect((await one('select public.save_push_subscription($1, $2, $3, $4) as r', [ENDPOINT, 'p256dh-key-max', 'auth-max', 'Chrome'])).r).toEqual({ ok: true });
    rows = await q('select user_id, user_name, p256dh from public.push_subscriptions where endpoint = $1', [ENDPOINT]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ user_id: max, user_name: 'Max', p256dh: 'p256dh-key-max' });
    // invalid input is refused, an inactive user is not allowed
    expect((await one('select public.save_push_subscription($1, $2, $3, $4) as r', ['http://insecure', 'k', 'a', ''])).r).toEqual({ ok: false, status: 'invalid' });
    const gone = await newUser('Bývalá', { active: false });
    await actAs(gone);
    expect((await pgError(q('select public.save_push_subscription($1, $2, $3, $4)', [ENDPOINT, 'k', 'a', ''])))?.code).toBe('42501');
    // turning off removes the device's row
    await actAs(max);
    expect((await one('select public.remove_push_subscription($1) as r', [ENDPOINT])).r).toEqual({ ok: true });
    expect(await q('select 1 from public.push_subscriptions where endpoint = $1', [ENDPOINT])).toHaveLength(0);
    await actAs(null);
    expect((await pgError(q('select public.remove_push_subscription($1)', [ENDPOINT])))?.code).toBe('42501');
  });
});

describe('board_notes: add_board_note / remove_board_note', () => {
  it('an active user adds a note under their name; the same action id replays without a second row', async () => {
    const eva = await newUser('Eva');
    await actAs(eva);
    const action = randomUUID();
    const r1 = await one('select public.add_board_note($1, $2::date, $3) as r', ['  Zajtra chýbajú malé paplóny!  ', todayBa, action]);
    expect(r1.r.ok).toBe(true);
    const r2 = await one('select public.add_board_note($1, $2::date, $3) as r', ['Zajtra chýbajú malé paplóny!', todayBa, action]);
    expect(r2.r).toMatchObject({ ok: true, replayed: true, id: r1.r.id });
    const rows = await q('select *, date::text as date from public.board_notes where id = $1', [r1.r.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ text: 'Zajtra chýbajú malé paplóny!', author: eva, author_name: 'Eva', removed_at: null, client_action_id: action });
    expect(String(rows[0].date).slice(0, 10)).toBe(todayBa);
  });

  it('a note belongs to one board day; days before yesterday or more than 30 days ahead are refused', async () => {
    const eva = await newUser('Eva');
    await actAs(eva);
    const tomorrow = (await one("select (public.today_ba() + 1)::text as d")).d as string;
    const { r } = await one('select public.add_board_note($1, $2::date, $3) as r', ['Len zajtra', tomorrow, randomUUID()]);
    expect(r.ok).toBe(true);
    expect(String((await one('select date::text as date from public.board_notes where id = $1', [r.id])).date)).toBe(tomorrow);
    expect((await one("select public.add_board_note($1, (public.today_ba() - 2)::date, $2) as r", ['Včera predvčerom', randomUUID()])).r).toEqual({ ok: false, status: 'bad_date' });
    expect((await one("select public.add_board_note($1, (public.today_ba() + 31)::date, $2) as r", ['Ďaleko', randomUUID()])).r).toEqual({ ok: false, status: 'bad_date' });
    expect((await one('select public.add_board_note($1, null::date, $2) as r', ['Bez dňa', randomUUID()])).r).toEqual({ ok: false, status: 'bad_date' });
  });

  it('an empty note is refused; an inactive user or no session is not allowed', async () => {
    const eva = await newUser('Eva');
    await actAs(eva);
    expect((await one('select public.add_board_note($1, $2::date, $3) as r', ['   ', todayBa, randomUUID()])).r).toEqual({ ok: false, status: 'empty' });
    const gone = await newUser('Bývalá', { active: false });
    await actAs(gone);
    expect((await pgError(q('select public.add_board_note($1, $2::date, $3)', ['x', todayBa, randomUUID()])))?.code).toBe('42501');
    await actAs(null);
    expect((await pgError(q('select public.add_board_note($1, $2::date, $3)', ['x', todayBa, randomUUID()])))?.code).toBe('42501');
  });

  it('only the author or an admin removes a note; removal is recorded and idempotent; unknown id -> P0002', async () => {
    const eva = await newUser('Eva');
    const max = await newUser('Max');
    const admin = await newUser('Julius', { role: 'admin' });
    await actAs(eva);
    const { r } = await one('select public.add_board_note($1, $2::date, $3) as r', ['Kľúče od Klariskej sú u Maxa', todayBa, randomUUID()]);
    await actAs(max);
    expect((await one('select public.remove_board_note($1, $2) as r', [r.id, randomUUID()])).r).toEqual({ ok: false, status: 'not_author' });
    await actAs(admin);
    expect((await one('select public.remove_board_note($1, $2) as r', [r.id, randomUUID()])).r).toEqual({ ok: true });
    const row = await one('select * from public.board_notes where id = $1', [r.id]);
    expect(row.removed_at).not.toBeNull();
    expect(row).toMatchObject({ removed_by: admin, removed_by_name: 'Julius' });
    expect((await one('select public.remove_board_note($1, $2) as r', [r.id, randomUUID()])).r).toEqual({ ok: true, replayed: true });
    await actAs(eva);
    const { r: own } = await one('select public.add_board_note($1, $2::date, $3) as r', ['Druhá poznámka', todayBa, randomUUID()]);
    expect((await one('select public.remove_board_note($1, $2) as r', [own.id, randomUUID()])).r).toEqual({ ok: true });
    expect((await pgError(q('select public.remove_board_note($1, $2)', [randomUUID(), randomUUID()])))?.code).toBe('P0002');
  });

  it('staff read only active notes through RLS; a plain insert as authenticated is refused', async () => {
    const eva = await newUser('Eva');
    await actAs(eva);
    const { r: a } = await one('select public.add_board_note($1, $2::date, $3) as r', ['Aktívna', todayBa, randomUUID()]);
    const { r: b } = await one('select public.add_board_note($1, $2::date, $3) as r', ['Odstránená', todayBa, randomUUID()]);
    await q('select public.remove_board_note($1, $2)', [b.id, randomUUID()]);
    await db.exec('set role authenticated');
    try {
      const seen = await q('select id from public.board_notes where id = any($1::uuid[])', [[a.id, b.id]]);
      expect(seen.map((x) => x.id)).toEqual([a.id]);
      const ins = await pgError(q("insert into public.board_notes (text, date, author_name) values ('x', current_date, 'y')"));
      expect(ins?.code).toBe('42501');
    } finally {
      await db.exec('reset role');
    }
  });
});

// ------------------------------------------------------------------ 12. notice board edits (0009)
describe('board_notes: edit_board_note', () => {
  it('the author edits their own note; nobody else does, not even an admin; empty, unchanged and removed are handled', async () => {
    const eva = await newUser('Eva');
    const max = await newUser('Max');
    const admin = await newUser('Julius', { role: 'admin' });
    await actAs(eva);
    const { r } = await one('select public.add_board_note($1, $2::date, $3) as r', ['Pôvodný text', todayBa, randomUUID()]);
    expect((await one('select public.edit_board_note($1, $2, $3) as r', [r.id, 'Pôvodný text', randomUUID()])).r).toEqual({ ok: true, unchanged: true });
    expect((await one('select public.edit_board_note($1, $2, $3) as r', [r.id, '   ', randomUUID()])).r).toEqual({ ok: false, status: 'empty' });
    expect((await one('select public.edit_board_note($1, $2, $3) as r', [r.id, '  Opravený text  ', randomUUID()])).r).toEqual({ ok: true });
    const row = await one('select text, edited_at, author_name from public.board_notes where id = $1', [r.id]);
    expect(row).toMatchObject({ text: 'Opravený text', author_name: 'Eva' });
    expect(row.edited_at).not.toBeNull();
    await actAs(max);
    expect((await one('select public.edit_board_note($1, $2, $3) as r', [r.id, 'Cudzí zásah', randomUUID()])).r).toEqual({ ok: false, status: 'not_author' });
    await actAs(admin);
    expect((await one('select public.edit_board_note($1, $2, $3) as r', [r.id, 'Admin zásah', randomUUID()])).r).toEqual({ ok: false, status: 'not_author' });
    await actAs(null);
    expect((await pgError(q('select public.edit_board_note($1, $2, $3)', [r.id, 'x', randomUUID()])))?.code).toBe('42501');
    await actAs(eva);
    expect((await pgError(q('select public.edit_board_note($1, $2, $3)', [randomUUID(), 'x', randomUUID()])))?.code).toBe('P0002');
    await q('select public.remove_board_note($1, $2)', [r.id, randomUUID()]);
    expect((await one('select public.edit_board_note($1, $2, $3) as r', [r.id, 'Po odstránení', randomUUID()])).r).toEqual({ ok: false, status: 'removed' });
    expect((await one('select text from public.board_notes where id = $1', [r.id])).text).toBe('Opravený text');
  });
});

describe('board_notes: add_board_reply (0015)', () => {
  it('anyone active replies under a note, on its day; one level only; replays on the action id; removed parents refuse', async () => {
    const eva = await newUser('Eva');
    const max = await newUser('Max');
    await actAs(eva);
    const tomorrow = (await one("select (public.today_ba() + 1)::text as d")).d as string;
    const { r: parent } = await one('select public.add_board_note($1, $2::date, $3) as r', ['Zajtra príde technik', tomorrow, randomUUID()]);
    await actAs(max);
    const action = randomUUID();
    const r1 = (await one('select public.add_board_reply($1, $2, $3) as r', [parent.id, '  Beriem si to na starosť  ', action])).r;
    expect(r1.ok).toBe(true);
    expect((await one('select public.add_board_reply($1, $2, $3) as r', [parent.id, 'Beriem si to na starosť', action])).r).toMatchObject({ ok: true, replayed: true, id: r1.id });
    const row = await one('select text, author, author_name, parent_id, date::text as date from public.board_notes where id = $1', [r1.id]);
    expect(row).toMatchObject({ text: 'Beriem si to na starosť', author: max, author_name: 'Max', parent_id: parent.id, date: tomorrow });
    // no reply to a reply, no empty reply
    expect((await one('select public.add_board_reply($1, $2, $3) as r', [r1.id, 'Hlbšie', randomUUID()])).r).toEqual({ ok: false, status: 'nested' });
    expect((await one('select public.add_board_reply($1, $2, $3) as r', [parent.id, '   ', randomUUID()])).r).toEqual({ ok: false, status: 'empty' });
    // the replier edits their own reply with the note RPC
    expect((await one('select public.edit_board_note($1, $2, $3) as r', [r1.id, 'Beriem to ja', randomUUID()])).r).toEqual({ ok: true });
    // a removed or unknown parent takes no replies
    await actAs(eva);
    await q('select public.remove_board_note($1, $2)', [parent.id, randomUUID()]);
    expect((await one('select public.add_board_reply($1, $2, $3) as r', [parent.id, 'Neskoro', randomUUID()])).r).toEqual({ ok: false, status: 'removed' });
    expect((await one('select public.add_board_reply($1, $2, $3) as r', [randomUUID(), 'Nikam', randomUUID()])).r).toEqual({ ok: false, status: 'removed' });
    await actAs(null);
    expect((await pgError(q('select public.add_board_reply($1, $2, $3)', [parent.id, 'x', randomUUID()])))?.code).toBe('42501');
  });
});

describe('early_arrivals: typed in again (0016)', () => {
  it('an active user writes an early arrival for an in-scope flat; Guesty rows do not block it; author or admin removes it', async () => {
    await q("insert into public.listings (guesty_id, name, in_scope, fetched_at) values ('ea-1', 'Poštová, Heart', true, now()), ('ea-out', 'Mimo', false, now()) on conflict do nothing");
    // a row the sync derived before 0016 stays in the table but does not count as a typed-in entry
    await q("insert into public.early_arrivals (listing_id, listing_name, date, arrival, author_name, source) values ('ea-1', 'Poštová, Heart', public.today_ba(), '13:00', 'Guesty', 'guesty')");
    const eva = await newUser('Eva');
    const max = await newUser('Max');
    const admin = await newUser('Julius', { role: 'admin' });
    await actAs(eva);
    const action = randomUUID();
    const r1 = (await one('select public.add_early_arrival($1, $2::date, $3, $4, $5) as r', ['ea-1', todayBa, '12:00', ' zaplatený skorý check-in ', action])).r;
    expect(r1.ok).toBe(true);
    expect((await one('select public.add_early_arrival($1, $2::date, $3, $4, $5) as r', ['ea-1', todayBa, '12:00', '', action])).r).toMatchObject({ ok: true, replayed: true, id: r1.id });
    const row = await one('select listing_name, arrival, note, author_name, source from public.early_arrivals where id = $1', [r1.id]);
    expect(row).toEqual({ listing_name: 'Poštová, Heart', arrival: '12:00', note: 'zaplatený skorý check-in', author_name: 'Eva', source: 'manual' });
    expect((await one('select public.add_early_arrival($1, $2::date, $3, $4, $5) as r', ['ea-1', todayBa, '11:00', '', randomUUID()])).r).toEqual({ ok: false, status: 'duplicate' });
    expect((await one('select public.add_early_arrival($1, $2::date, $3, $4, $5) as r', ['ea-out', todayBa, '11:00', '', randomUUID()])).r).toEqual({ ok: false, status: 'bad_listing' });
    expect((await one('select public.add_early_arrival($1, $2::date, $3, $4, $5) as r', ['ea-1', todayBa, '25:00', '', randomUUID()])).r).toEqual({ ok: false, status: 'bad_time' });
    expect((await one('select public.add_early_arrival($1, (public.today_ba() - 2)::date, $2, $3, $4) as r', ['ea-1', '11:00', '', randomUUID()])).r).toEqual({ ok: false, status: 'bad_date' });
    await actAs(max);
    expect((await one('select public.remove_early_arrival($1, $2) as r', [r1.id, randomUUID()])).r).toEqual({ ok: false, status: 'not_author' });
    await actAs(admin);
    expect((await one('select public.remove_early_arrival($1, $2) as r', [r1.id, randomUUID()])).r).toEqual({ ok: true });
    expect((await one('select public.remove_early_arrival($1, $2) as r', [r1.id, randomUUID()])).r).toMatchObject({ ok: true, replayed: true });
    expect((await one('select removed_by_name from public.early_arrivals where id = $1', [r1.id])).removed_by_name).toBe('Julius');
    await actAs(null);
    expect((await pgError(q('select public.add_early_arrival($1, $2::date, $3, $4, $5)', ['ea-1', todayBa, '12:00', '', randomUUID()])))?.code).toBe('42501');
  });
});
