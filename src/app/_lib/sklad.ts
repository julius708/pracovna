import 'server-only';
import { addDays, todayInTz } from '@/core/packing';
import type { IssueAlias, ItemKind, Movement, MovementKind, PackSnapshot, StockItem, SupplierSku } from '@/core/stock';
import { createServerSupabase } from '@/db/server';
import { demoStock } from './sklad-demo';
import { supabaseConfigured } from './viewer';
import type { Viewer } from './viewer';

/* Raw rows -> domain types ------------------------------------------------ */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>;

export const toItem = (r: R): StockItem => ({ id: r.id, kind: r.kind as ItemKind, product: r.product, category: r.category ?? '', variant: r.variant, system: r.system, baseUnit: r.base_unit });
export const toSku = (r: R): SupplierSku => ({
  id: r.id, itemId: r.item_id, supplier: r.supplier, sku: r.sku, purchaseUnit: r.purchase_unit, piecesPerPack: r.pieces_per_pack, packsPerCarton: r.packs_per_carton,
  priceCents: r.price_cents, currency: r.currency, vatRate: r.vat_rate === null ? null : Number(r.vat_rate), validFrom: r.valid_from, validTo: r.valid_to,
  minOrder: r.min_order, leadTimeDays: r.lead_time_days, verifiedSource: r.verified_source, verifiedAt: r.verified_at,
});
export const toAlias = (r: R): IssueAlias => ({ kind: r.kind, sourceKey: r.source_key, itemId: r.item_id, factor: r.factor });
export const toMovement = (r: R): Movement & { actorName: string; reason: string | null; listingId: string | null } => ({
  id: String(r.id), itemId: r.item_id, warehouseId: r.warehouse_id, kind: r.kind as MovementKind, qty: r.qty, at: r.occurred_at, uniqueKey: r.unique_key,
  sourceType: r.source_type, sourceId: r.source_id, actorName: r.actor_name ?? '—', reason: r.reason, listingId: r.listing_id,
});

export type StockMovementRow = ReturnType<typeof toMovement>;

export interface Warehouse { id: string; name: string; city: string; kind: string; active: boolean }
export interface Discrepancy { id: number; batchId: string; kind: string; itemId: string | null; qty: number | null; status: string; createdAt: string; listingName: string | null }
export interface UnmappedRow { id: number; packageId: string; sourceKind: string; sourceKey: string; label: string; n: number; reason: string; createdAt: string }
export interface InventoryRow { id: string; title: string; inventoryDate: string; warehouseId: string; status: 'draft' | 'closed' | 'approved'; cutAt: string | null; createdByName: string; approvedByName: string | null }
export interface InventoryLine { itemId: string; shelf: string; packs: number | null; loose: number | null; verifiedZero: boolean; total: number | null; state: string; skuId: string | null; note: string }
export interface OrderLineRow { id: string; itemId: string; skuId: string; needBase: number; reserveBase: number; usableBase: number; incomingBase: number; rawBase: number; suggestedUnits: number; finalUnits: number; packs: number; piecesPerPack: number; purchaseUnit: string; priceCents: number | null; currency: string; basis: string; manualReason: string | null; received: number }
export interface OrderRow { id: string; supplier: string; status: string; sendState: string; sendMethod: string | null; deliveryTargetDate: string | null; note: string; createdByName: string; createdAt: string; approvedByName: string | null; supplierRef: string | null; lines: OrderLineRow[] }
export interface PendingBatch { id: string; listingId: string; packageDate: string; status: string }

export interface StockView {
  /** live = real data; demo = sample data labelled "ukážka"; not_migrated = the database has no stock tables yet. */
  mode: 'live' | 'demo' | 'not_migrated';
  isAdmin: boolean;
  config: { deductionEnabled: boolean; baselineAt: string | null; baselineInventoryId: string | null; approvers: string[] };
  warehouses: Warehouse[];
  items: StockItem[];
  homeWarehouse: Record<string, string | null>;
  skus: SupplierSku[];
  aliases: IssueAlias[];
  onHand: { itemId: string; warehouseId: string; qty: number; baselineAt: string }[];
  incoming: Record<string, number>;
  movements: StockMovementRow[];
  discrepancies: Discrepancy[];
  unmapped: UnmappedRow[];
  errors: { id: number; packedEventId: number; error: string; createdAt: string }[];
  pendingBatches: PendingBatch[];
  inventories: InventoryRow[];
  orders: OrderRow[];
  /** Cards that still await a packing (todo) in the board window: snapshots of confirmed demand. */
  upcoming: { date: string; snapshot: PackSnapshot }[];
  staff: { id: string; name: string; role: string }[];
  lastSyncAt: string | null;
  today: string;
}

const MISSING_TABLE = new Set(['42P01', 'PGRST205', 'PGRST200']);

/** Everything the Sklad screens read, through the signed-in user's session (RLS decides what is visible). */
export async function loadStock(viewer: Viewer, opts: { movementsSince?: string; movementLimit?: number } = {}): Promise<StockView> {
  const today = todayInTz(new Date());
  if (!supabaseConfigured()) return demoStock(viewer.role === 'admin', today);
  const db = await createServerSupabase();
  if (!db) return demoStock(viewer.role === 'admin', today);
  const isAdmin = viewer.role === 'admin';

  const cfg = await db.from('stock_config').select('*').maybeSingle();
  if (cfg.error && MISSING_TABLE.has(cfg.error.code ?? '')) return { ...demoStock(isAdmin, today), mode: 'not_migrated' };
  if (cfg.error) throw new Error(`stock_config: ${cfg.error.message}`);

  const lim = opts.movementLimit ?? 300;
  let mq = db.from('stock_movements').select('*').order('occurred_at', { ascending: false }).order('id', { ascending: false }).limit(lim);
  if (opts.movementsSince) mq = mq.gte('occurred_at', opts.movementsSince);
  const [wh, it, sk, al, oh, inc, mv, dis, unm, err, inv, ord, lines, rcv, last, staff, batches, up] = await Promise.all([
    db.from('stock_warehouses').select('*').order('name'),
    db.from('stock_items').select('*').order('product'),
    isAdmin ? db.from('stock_supplier_skus').select('*').order('valid_from', { ascending: false }) : Promise.resolve({ data: [] as R[] }),
    isAdmin ? db.from('stock_aliases').select('*') : Promise.resolve({ data: [] as R[] }),
    isAdmin ? db.from('stock_on_hand').select('*') : Promise.resolve({ data: [] as R[] }),
    isAdmin ? db.from('stock_incoming').select('*') : Promise.resolve({ data: [] as R[] }),
    isAdmin ? mq : Promise.resolve({ data: [] as R[] }),
    isAdmin ? db.from('stock_discrepancies').select('*, stock_issue_batches(listing_id, package_date)').eq('status', 'open').order('id', { ascending: false }).limit(200) : Promise.resolve({ data: [] as R[] }),
    isAdmin ? db.from('stock_unmapped_issues').select('*').order('id', { ascending: false }).limit(200) : Promise.resolve({ data: [] as R[] }),
    isAdmin ? db.from('stock_issue_errors').select('*').is('resolved_at', null).order('id') : Promise.resolve({ data: [] as R[] }),
    isAdmin ? db.from('stock_inventories').select('*').order('inventory_date', { ascending: false }).limit(50) : Promise.resolve({ data: [] as R[] }),
    isAdmin ? db.from('stock_orders').select('*').order('created_at', { ascending: false }).limit(50) : Promise.resolve({ data: [] as R[] }),
    isAdmin ? db.from('stock_order_lines').select('*') : Promise.resolve({ data: [] as R[] }),
    isAdmin ? db.from('stock_receipt_lines').select('order_line_id, packs') : Promise.resolve({ data: [] as R[] }),
    isAdmin ? db.from('sync_runs').select('finished_at').eq('ok', true).order('id', { ascending: false }).limit(1) : Promise.resolve({ data: [] as R[] }),
    isAdmin ? db.from('profiles').select('id, display_name, role, active').eq('active', true).order('display_name') : Promise.resolve({ data: [] as R[] }),
    isAdmin ? db.from('stock_issue_batches').select('id, listing_id, package_date, status').eq('status', 'return_pending').order('package_date') : Promise.resolve({ data: [] as R[] }),
    isAdmin ? db.from('packages').select('date, computed_items, status, hidden').eq('status', 'todo').eq('hidden', false).gte('date', today).lte('date', addDays(today, 60)) : Promise.resolve({ data: [] as R[] }),
  ]);

  const received = new Map<string, number>();
  for (const r of (rcv.data ?? []) as R[]) received.set(r.order_line_id, (received.get(r.order_line_id) ?? 0) + r.packs);
  const linesByOrder = new Map<string, OrderLineRow[]>();
  for (const l of (lines.data ?? []) as R[]) {
    const row: OrderLineRow = {
      id: l.id, itemId: l.item_id, skuId: l.sku_id, needBase: l.need_base, reserveBase: l.reserve_base, usableBase: l.usable_base, incomingBase: l.incoming_base, rawBase: l.raw_base,
      suggestedUnits: l.suggested_units, finalUnits: l.final_units, packs: l.packs, piecesPerPack: l.pieces_per_pack, purchaseUnit: l.purchase_unit, priceCents: l.price_cents,
      currency: l.currency, basis: l.basis, manualReason: l.manual_reason, received: received.get(l.id) ?? 0,
    };
    linesByOrder.set(l.order_id, [...(linesByOrder.get(l.order_id) ?? []), row]);
  }
  const listingNames = new Map<string, string>();

  const items = ((it.data ?? []) as R[]).map(toItem);
  return {
    mode: 'live',
    isAdmin,
    config: { deductionEnabled: cfg.data?.deduction_enabled ?? false, baselineAt: cfg.data?.baseline_at ?? null, baselineInventoryId: cfg.data?.baseline_inventory_id ?? null, approvers: cfg.data?.order_approvers ?? [] },
    warehouses: ((wh.data ?? []) as R[]).map((w) => ({ id: w.id, name: w.name, city: w.city, kind: w.kind, active: w.active })),
    items,
    homeWarehouse: Object.fromEntries(((it.data ?? []) as R[]).map((r) => [r.id, r.home_warehouse_id])),
    skus: ((sk.data ?? []) as R[]).map(toSku),
    aliases: ((al.data ?? []) as R[]).map(toAlias),
    onHand: ((oh.data ?? []) as R[]).map((r) => ({ itemId: r.item_id, warehouseId: r.warehouse_id, qty: r.qty, baselineAt: r.baseline_at })),
    incoming: Object.fromEntries(((inc.data ?? []) as R[]).map((r) => [r.item_id, r.qty])),
    movements: ((mv.data ?? []) as R[]).map(toMovement),
    discrepancies: ((dis.data ?? []) as R[]).map((d) => ({ id: d.id, batchId: d.batch_id, kind: d.kind, itemId: d.item_id, qty: d.qty, status: d.status, createdAt: d.created_at, listingName: d.stock_issue_batches ? (listingNames.get(d.stock_issue_batches.listing_id) ?? d.stock_issue_batches.listing_id) : null })),
    unmapped: ((unm.data ?? []) as R[]).map((u) => ({ id: u.id, packageId: u.package_id, sourceKind: u.source_kind, sourceKey: u.source_key, label: u.label, n: Number(u.n), reason: u.reason, createdAt: u.created_at })),
    errors: ((err.data ?? []) as R[]).map((e) => ({ id: e.id, packedEventId: e.packed_event_id, error: e.error, createdAt: e.created_at })),
    pendingBatches: ((batches.data ?? []) as R[]).map((b) => ({ id: b.id, listingId: b.listing_id, packageDate: b.package_date, status: b.status })),
    inventories: ((inv.data ?? []) as R[]).map((i) => ({ id: i.id, title: i.title, inventoryDate: i.inventory_date, warehouseId: i.warehouse_id, status: i.status, cutAt: i.cut_at, createdByName: i.created_by_name, approvedByName: i.approved_by_name })),
    orders: ((ord.data ?? []) as R[]).map((o) => ({ id: o.id, supplier: o.supplier, status: o.status, sendState: o.send_state, sendMethod: o.send_method, deliveryTargetDate: o.delivery_target_date, note: o.note, createdByName: o.created_by_name, createdAt: o.created_at, approvedByName: o.approved_by_name, supplierRef: o.supplier_ref, lines: linesByOrder.get(o.id) ?? [] })),
    upcoming: ((up.data ?? []) as R[]).map((p) => ({ date: p.date, snapshot: { consumables: p.computed_items?.consumables ?? [], capsules: p.computed_items?.capsules ?? [], linen: p.computed_items?.linen ?? [] } })),
    staff: ((staff.data ?? []) as R[]).map((p) => ({ id: p.id, name: p.display_name, role: p.role })),
    lastSyncAt: ((last.data ?? []) as R[])[0]?.finished_at ?? null,
    today,
  };
}

/** Lines of one inventory plus the data to render its form. */
export async function loadInventory(id: string): Promise<{ inventory: InventoryRow; lines: InventoryLine[] } | null> {
  const db = await createServerSupabase();
  if (!db) return null;
  const [inv, lines] = await Promise.all([
    db.from('stock_inventories').select('*').eq('id', id).maybeSingle(),
    db.from('stock_inventory_lines').select('*').eq('inventory_id', id),
  ]);
  const i = inv.data as R | null;
  if (!i) return null;
  return {
    inventory: { id: i.id, title: i.title, inventoryDate: i.inventory_date, warehouseId: i.warehouse_id, status: i.status, cutAt: i.cut_at, createdByName: i.created_by_name, approvedByName: i.approved_by_name },
    lines: ((lines.data ?? []) as R[]).map((l) => ({ itemId: l.item_id, shelf: l.shelf, packs: l.packs, loose: l.loose, verifiedZero: l.verified_zero, total: l.total, state: l.state, skuId: l.sku_id, note: l.note })),
  };
}

export interface MonthContextRow { stays: number; guests: number; guestNights: number; occupiedFlatNights: number }

/** Stays, guests, guest-nights and occupied flat-nights of a month from the confirmed reservations. */
export async function loadMonthContext(ym: string): Promise<MonthContextRow | null> {
  const db = await createServerSupabase();
  if (!db) return null;
  const from = `${ym}-01`;
  const d = new Date(`${from}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  const to = d.toISOString().slice(0, 10);
  const { data, error } = await db.from('reservations').select('check_in_date, check_out_date, guests, status, listing_id').eq('status', 'confirmed').lt('check_in_date', to).gt('check_out_date', from);
  if (error || !data) return null;
  const inScope = await db.from('listings').select('guesty_id').eq('in_scope', true);
  const ok = new Set(((inScope.data ?? []) as R[]).map((l) => l.guesty_id));
  const day = (s: string) => Date.parse(`${s}T00:00:00Z`) / 86400000;
  let stays = 0, guests = 0, guestNights = 0, occupied = 0;
  for (const r of data as R[]) {
    if (!ok.has(r.listing_id)) continue;
    const a = Math.max(day(r.check_in_date), day(from));
    const b = Math.min(day(r.check_out_date), day(to));
    const nights = Math.max(0, b - a);
    occupied += nights;
    guestNights += nights * (r.guests ?? 0);
    if (r.check_out_date >= from && r.check_out_date < to) {
      stays += 1;
      guests += r.guests ?? 0;
    }
  }
  return { stays, guests, guestNights, occupiedFlatNights: occupied };
}

export interface ForecastInputs {
  activeFlats: number;
  /** Confirmed stays that start in the horizon (their needs are already in the known demand). */
  confirmedStays: number;
  /** Average stay length from the last 90 days; null = no data. */
  avgStayNights: number | null;
  /** Stays that ended in the last `calibrationDays` days (sample for the per-stay coefficients). */
  recentStays: number;
}

/** Counts for the sell-through forecast. Returns zeros when the database is not available. */
export async function loadForecastInputs(today: string, to: string, calibrationFrom: string): Promise<ForecastInputs> {
  const empty: ForecastInputs = { activeFlats: 0, confirmedStays: 0, avgStayNights: null, recentStays: 0 };
  const db = await createServerSupabase();
  if (!db) return empty;
  const [flats, upcoming, past] = await Promise.all([
    db.from('listings').select('guesty_id', { count: 'exact', head: true }).eq('in_scope', true).eq('active', true),
    db.from('reservations').select('guesty_id', { count: 'exact', head: true }).eq('status', 'confirmed').gte('check_in_date', today).lte('check_in_date', to),
    db.from('reservations').select('check_in_date, check_out_date').eq('status', 'confirmed').gte('check_out_date', addDays(today, -90)).lt('check_out_date', today),
  ]);
  const rows = (past.data ?? []) as R[];
  const day = (s: string) => Date.parse(`${s}T00:00:00Z`) / 86400000;
  const nights = rows.map((r) => day(r.check_out_date) - day(r.check_in_date)).filter((n) => n > 0);
  return {
    activeFlats: flats.count ?? 0,
    confirmedStays: upcoming.count ?? 0,
    avgStayNights: nights.length >= 10 ? nights.reduce((a, b) => a + b, 0) / nights.length : null,
    recentStays: rows.filter((r) => r.check_out_date >= calibrationFrom).length,
  };
}
