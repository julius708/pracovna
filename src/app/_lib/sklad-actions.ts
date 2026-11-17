'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createServerSupabase } from '@/db/server';
import { getViewer, supabaseConfigured } from './viewer';

/**
 * Server actions of "Sklad". Every one re-checks the signed-in user and then calls an RPC; the database
 * enforces the real permissions (staff / správca / schvaľovateľ), this layer only picks the message.
 * Forms redirect back with ?m=ok or ?m=err:<code>.
 */

const text = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const num = (fd: FormData, k: string): number | null => {
  const v = text(fd, k).replace(',', '.');
  if (v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};
const int = (fd: FormData, k: string): number | null => {
  const n = num(fd, k);
  return n === null || Number.isNaN(n) || !Number.isInteger(n) ? (n === null ? null : NaN) : n;
};
const aid = (fd: FormData) => (/^[0-9a-f-]{36}$/i.test(text(fd, 'aid')) ? text(fd, 'aid') : randomUUID());
const back = (fd: FormData, fallback: string) => {
  const b = text(fd, 'back');
  return b.startsWith('/sklad') ? b : fallback;
};

function done(to: string, m: string): never {
  revalidatePath('/sklad', 'layout');
  const url = new URL(to, 'http://x');
  url.searchParams.set('m', m);
  redirect(`${url.pathname}${url.search}`);
}

async function call(to: string, fn: string, args: Record<string, unknown>): Promise<never> {
  const viewer = await getViewer();
  if (!viewer || !viewer.active) done(to, 'err:unauthorized');
  if (!supabaseConfigured()) done(to, 'err:demo');
  const db = await createServerSupabase();
  if (!db) done(to, 'err:failed');
  const { data, error } = await db.rpc(fn, args);
  if (error) {
    if (error.code === '42501') done(to, 'err:unauthorized');
    if (error.code === 'P0002') done(to, 'err:not_found');
    done(to, 'err:failed');
  }
  const r = (data ?? {}) as { ok?: boolean; status?: string };
  if (r.ok === false) done(to, `err:${r.status ?? 'failed'}`);
  done(to, 'ok');
}

/* ---- movements ---- */
export async function movementAction(fd: FormData) {
  const to = back(fd, '/sklad/pohyby');
  const at = text(fd, 'at');
  await call(to, 'stock_record_movement', {
    p_item: text(fd, 'item'), p_warehouse: text(fd, 'warehouse'), p_kind: text(fd, 'kind'), p_qty: int(fd, 'qty'), p_reason: text(fd, 'reason'),
    p_occurred_at: at ? new Date(at).toISOString() : null, p_listing_id: text(fd, 'listing') || null, p_action_id: aid(fd),
  });
}
export async function transferAction(fd: FormData) {
  await call(back(fd, '/sklad/pohyby'), 'stock_transfer', { p_item: text(fd, 'item'), p_from: text(fd, 'from'), p_to: text(fd, 'to'), p_qty: int(fd, 'qty'), p_reason: text(fd, 'reason'), p_action_id: aid(fd) });
}
export async function confirmReturnAction(fd: FormData) {
  await call(back(fd, '/sklad'), 'stock_confirm_return', { p_batch: text(fd, 'batch'), p_lines: null, p_note: text(fd, 'note') || 'potvrdené vrátenie', p_action_id: aid(fd) });
}
export async function resolveDiscrepancyAction(fd: FormData) {
  await call(back(fd, '/sklad'), 'stock_resolve_discrepancy', { p_id: int(fd, 'id'), p_resolution: text(fd, 'resolution') });
}
export async function retryIssueAction(fd: FormData) {
  await call(back(fd, '/sklad'), 'stock_retry_issue', { p_event_id: int(fd, 'event') });
}

/* ---- inventory ---- */
export async function inventoryOpenAction(fd: FormData) {
  const viewer = await getViewer();
  if (!viewer || viewer.role !== 'admin') done('/sklad/inventura', 'err:unauthorized');
  if (!supabaseConfigured()) done('/sklad/inventura', 'err:demo');
  const db = await createServerSupabase();
  if (!db) done('/sklad/inventura', 'err:failed');
  const { data, error } = await db.rpc('stock_inventory_open', { p_warehouse: text(fd, 'warehouse'), p_date: text(fd, 'date'), p_title: text(fd, 'title'), p_action_id: aid(fd) });
  const r = (data ?? {}) as { ok?: boolean; id?: string; status?: string };
  if (error || r.ok === false || !r.id) done('/sklad/inventura', error ? 'err:failed' : `err:${r.status ?? 'failed'}`);
  revalidatePath('/sklad', 'layout');
  redirect(`/sklad/inventura/${r.id}`);
}

export async function inventorySaveAction(fd: FormData) {
  const id = text(fd, 'inventory');
  const to = `/sklad/inventura/${id}`;
  const viewer = await getViewer();
  if (!viewer || viewer.role !== 'admin') done(to, 'err:unauthorized');
  if (!supabaseConfigured()) done(to, 'err:demo');
  const db = await createServerSupabase();
  if (!db) done(to, 'err:failed');
  const had = new Set(fd.getAll('had').map(String));
  for (const itemId of fd.getAll('item').map(String)) {
    const packs = int(fd, `packs.${itemId}`);
    const loose = int(fd, `loose.${itemId}`);
    const zero = fd.get(`zero.${itemId}`) === 'on';
    if (packs === null && loose === null && !zero && !had.has(itemId)) continue; // untouched line: stays "nespočítané", never 0
    if (Number.isNaN(packs) || Number.isNaN(loose)) done(to, 'err:bad_qty');
    const { data, error } = await db.rpc('stock_inventory_save_line', {
      p_inventory: id, p_item: itemId, p_packs: packs, p_loose: loose, p_verified_zero: zero, p_shelf: text(fd, `shelf.${itemId}`), p_sku: text(fd, `sku.${itemId}`) || null,
      p_note: text(fd, `note.${itemId}`), p_source: 'app',
    });
    if (error) done(to, error.code === '42501' ? 'err:unauthorized' : 'err:failed');
    const r = data as { ok?: boolean; status?: string };
    if (r.ok === false) done(to, `err:${r.status ?? 'failed'}`);
  }
  done(to, 'ok');
}
export async function inventoryCloseAction(fd: FormData) {
  const at = text(fd, 'cut');
  await call(`/sklad/inventura/${text(fd, 'inventory')}`, 'stock_inventory_close', { p_inventory: text(fd, 'inventory'), p_cut_at: at ? new Date(at).toISOString() : null, p_action_id: aid(fd) });
}
export async function inventoryApproveAction(fd: FormData) {
  await call(`/sklad/inventura/${text(fd, 'inventory')}`, 'stock_inventory_approve', { p_inventory: text(fd, 'inventory') });
}
export async function setDeductionAction(fd: FormData) {
  await call(back(fd, '/sklad/katalog'), 'stock_set_deduction', { p_enabled: text(fd, 'enabled') === '1' });
}
export async function setApproversAction(fd: FormData) {
  await call(back(fd, '/sklad/katalog'), 'stock_set_approvers', { p_users: fd.getAll('approver').map(String) });
}

/* ---- catalog ---- */
export async function saveWarehouseAction(fd: FormData) {
  await call('/sklad/katalog', 'stock_save_warehouse', { p: { name: text(fd, 'name'), city: text(fd, 'city'), kind: text(fd, 'kind') } });
}
export async function saveItemAction(fd: FormData) {
  await call('/sklad/katalog', 'stock_save_item', {
    p: { id: text(fd, 'id') || undefined, kind: text(fd, 'kind'), product: text(fd, 'product'), category: text(fd, 'category'), variant: text(fd, 'variant'), system: text(fd, 'system'), base_unit: text(fd, 'base_unit') || 'ks', home_warehouse_id: text(fd, 'home') },
  });
}
export async function saveSkuAction(fd: FormData) {
  const n = (k: string) => (text(fd, k) === '' ? null : Number(text(fd, k).replace(',', '.')));
  const price = n('price');
  const vat = n('vat');
  await call('/sklad/katalog', 'stock_save_sku', {
    p: {
      item_id: text(fd, 'item'), supplier: text(fd, 'supplier'), sku: text(fd, 'sku'), purchase_unit: text(fd, 'purchase_unit') || 'pack', pieces_per_pack: n('pieces'), packs_per_carton: n('carton'),
      price_cents: price === null ? null : Math.round(price * 100), currency: text(fd, 'currency') || 'EUR', vat_rate: vat === null ? null : vat / 100, valid_from: text(fd, 'valid_from'),
      min_order: n('min_order'), lead_time_days: n('lead'), verified_source: text(fd, 'source'), verified_at: text(fd, 'verified_at') || null,
    },
  });
}
export async function saveAliasAction(fd: FormData) {
  await call('/sklad/katalog', 'stock_save_alias', { p_kind: text(fd, 'kind'), p_source_key: text(fd, 'source_key').toLowerCase(), p_item: text(fd, 'item'), p_factor: int(fd, 'factor') ?? 1 });
}
export async function seedCatalogAction(fd: FormData) {
  await call(back(fd, '/sklad/katalog'), 'stock_seed_catalog', {});
}

/* ---- orders ---- */
export async function orderCreateAction(fd: FormData) {
  const lines = [];
  for (const itemId of fd.getAll('item').map(String)) {
    if (fd.get(`use.${itemId}`) !== 'on') continue;
    const fin = int(fd, `final.${itemId}`);
    lines.push({
      item_id: itemId, sku_id: text(fd, `sku.${itemId}`), need_base: int(fd, `need.${itemId}`) ?? 0, reserve_base: int(fd, `reserve.${itemId}`) ?? 0,
      usable_base: int(fd, `usable.${itemId}`) ?? 0, incoming_base: int(fd, `incoming.${itemId}`) ?? 0, final_units: fin, manual_reason: text(fd, `reason.${itemId}`) || null,
    });
  }
  await call('/sklad/objednavky', 'stock_order_create', { p_supplier: text(fd, 'supplier'), p_delivery: text(fd, 'delivery') || null, p_lines: lines, p_note: text(fd, 'note'), p_action_id: aid(fd) });
}
export async function orderStepAction(fd: FormData) {
  await call('/sklad/objednavky', 'stock_order_step', { p_order: text(fd, 'order'), p_to: text(fd, 'to'), p_action_id: aid(fd) });
}
export async function orderExportedAction(fd: FormData) {
  await call('/sklad/objednavky', 'stock_order_mark_exported', { p_order: text(fd, 'order'), p_method: text(fd, 'method') || 'export', p_action_id: aid(fd) });
}
export async function orderSentAction(fd: FormData) {
  await call('/sklad/objednavky', 'stock_order_mark_sent', { p_order: text(fd, 'order'), p_method: text(fd, 'method') || 'email', p_state: text(fd, 'state') || 'sent', p_ref: text(fd, 'ref'), p_action_id: aid(fd) });
}
export async function orderReconcileAction(fd: FormData) {
  await call('/sklad/objednavky', 'stock_order_reconcile_send', { p_order: text(fd, 'order'), p_outcome: text(fd, 'outcome'), p_ref: text(fd, 'ref'), p_action_id: aid(fd) });
}
export async function orderConfirmAction(fd: FormData) {
  await call('/sklad/objednavky', 'stock_order_confirm', { p_order: text(fd, 'order'), p_ref: text(fd, 'ref'), p_action_id: aid(fd) });
}
export async function orderReceiveAction(fd: FormData) {
  const lines = fd.getAll('line').map(String).map((id) => ({ order_line_id: id, packs: int(fd, `recv.${id}`) })).filter((l) => l.packs && l.packs > 0);
  await call('/sklad/objednavky', 'stock_order_receive', { p_order: text(fd, 'order'), p_lines: lines, p_note: text(fd, 'note'), p_action_id: aid(fd) });
}
