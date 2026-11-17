import 'server-only';
import { addDays } from '@/core/packing';
import type { StockView } from './sklad';

/**
 * Ukážka bez databázy: výmysel na zobrazenie obrazoviek. Nie sú to skutočné zásoby, ceny ani dodávatelia;
 * každá obrazovka s týmito dátami to hovorí nahlas.
 */
export function demoStock(isAdmin: boolean, today: string): StockView {
  const ts = (d: number, h = 9) => `${addDays(today, d)}T${String(h).padStart(2, '0')}:00:00.000Z`;
  const item = (id: string, kind: 'consumable' | 'capsule' | 'linen', product: string, extra: { variant?: string; system?: string; unit?: 'ks' | 'rolka' } = {}) => ({
    id, kind, product, category: kind === 'capsule' ? 'káva' : kind === 'linen' ? 'bielizeň' : 'spotrebný materiál', variant: extra.variant ?? null, system: extra.system ?? null, baseUnit: extra.unit ?? ('ks' as const),
  });
  const base = { vatRate: 0.23, currency: 'EUR', sku: null, packsPerCarton: null, validTo: null, leadTimeDays: 5, verifiedSource: null, verifiedAt: null };
  return {
    mode: 'demo',
    isAdmin,
    config: { deductionEnabled: false, baselineAt: null, baselineInventoryId: null, approvers: [] },
    warehouses: [
      { id: 'w1', name: 'Sklad BA (ukážka)', city: 'Bratislava', kind: 'warehouse', active: true },
      { id: 'w2', name: 'Čistá bielizeň BA (ukážka)', city: 'Bratislava', kind: 'clean', active: true },
    ],
    items: [
      item('i-tp', 'consumable', 'Toaletný papier', { unit: 'rolka' }),
      item('i-bag', 'consumable', 'Vrecko do koša', { variant: 'veľké' }),
      item('i-orig', 'capsule', 'Kávové kapsule', { system: 'Nespresso Original' }),
      item('i-vertuo', 'capsule', 'Kávové kapsule', { system: 'Nespresso Vertuo' }),
      item('i-sheet', 'linen', 'Plachta', { variant: 'dvojlôžko' }),
    ],
    homeWarehouse: { 'i-tp': 'w1', 'i-bag': 'w1', 'i-orig': 'w1', 'i-vertuo': 'w1', 'i-sheet': 'w2' },
    skus: [
      { ...base, id: 's-tp', itemId: 'i-tp', supplier: 'Dodávateľ A (ukážka)', purchaseUnit: 'pack', piecesPerPack: 20, priceCents: 1000, minOrder: null, validFrom: '2026-01-01', verifiedSource: 'cenová ponuka (ukážka)', verifiedAt: '2026-11-01' },
      { ...base, id: 's-bag', itemId: 'i-bag', supplier: 'Dodávateľ A (ukážka)', purchaseUnit: 'pack', piecesPerPack: null, priceCents: 700, minOrder: null, validFrom: '2026-01-01' },
      { ...base, id: 's-orig', itemId: 'i-orig', supplier: 'Dodávateľ B (ukážka)', purchaseUnit: 'carton', piecesPerPack: 50, packsPerCarton: 6, priceCents: 1800, minOrder: 2, validFrom: '2026-01-01', verifiedSource: 'e-shop (ukážka)', verifiedAt: '2026-11-05' },
    ],
    aliases: [
      { kind: 'consumable', sourceKey: 'toaletak', itemId: 'i-tp', factor: 1 },
      { kind: 'consumable', sourceKey: 'vreckoV', itemId: 'i-bag', factor: 1 },
      { kind: 'capsule', sourceKey: 'nespresso original', itemId: 'i-orig', factor: 1 },
      { kind: 'capsule', sourceKey: 'nespresso vertuo', itemId: 'i-vertuo', factor: 1 },
    ],
    onHand: [
      { itemId: 'i-tp', warehouseId: 'w1', qty: 150, baselineAt: ts(-3) },
      { itemId: 'i-orig', warehouseId: 'w1', qty: -4, baselineAt: ts(-3) },
    ],
    incoming: { 'i-tp': 0 },
    movements: [
      { id: '1', itemId: 'i-tp', warehouseId: 'w1', kind: 'opening_balance', qty: 190, at: ts(-3), uniqueKey: null, sourceType: 'inventory', sourceId: null, actorName: 'Martina (ukážka)', reason: 'začiatočný stav z inventúry', listingId: null },
      { id: '2', itemId: 'i-tp', warehouseId: 'w1', kind: 'issue_package', qty: -3, at: ts(-1), uniqueKey: 'pkg:1:i-tp', sourceType: 'package_event', sourceId: '1', actorName: 'Angelika (ukážka)', reason: 'zabalené', listingId: 'BA: Byt (ukážka)' },
      { id: '3', itemId: 'i-tp', warehouseId: 'w1', kind: 'damage', qty: -2, at: ts(-1, 11), uniqueKey: null, sourceType: 'manual', sourceId: null, actorName: 'Zuzka (ukážka)', reason: 'zmoknuté', listingId: null },
    ],
    discrepancies: [{ id: 1, batchId: 'b1', kind: 'unpack_without_return', itemId: null, qty: null, status: 'open', createdAt: ts(-1), listingName: 'BA: Byt (ukážka)' }],
    unmapped: [{ id: 1, packageId: 'p1', sourceKind: 'capsule', sourceKey: 'tchibo', label: 'Tchibo', n: 2, reason: 'bez priradenia ku skladovej karte', createdAt: ts(-1) }],
    errors: [],
    pendingBatches: [{ id: 'b1', listingId: 'BA: Byt (ukážka)', packageDate: addDays(today, -1), status: 'return_pending' }],
    inventories: [{ id: 'inv-demo', title: 'Začiatočná inventúra (ukážka)', inventoryDate: addDays(today, 1), warehouseId: 'w1', status: 'draft', cutAt: null, createdByName: 'Martina (ukážka)', approvedByName: null }],
    orders: [],
    upcoming: [
      { date: addDays(today, 1), snapshot: { consumables: [{ key: 'toaletak', n: 3 }, { key: 'vreckoV', n: 2 }], capsules: [{ typeKey: 'nespresso original', n: 2 }], linen: [] } },
      { date: addDays(today, 2), snapshot: { consumables: [{ key: 'toaletak', n: 3 }], capsules: [{ typeKey: 'nespresso vertuo', n: 3 }], linen: [] } },
    ],
    staff: [{ id: 'u1', name: 'Július (ukážka)', role: 'admin' }],
    lastSyncAt: null,
    today,
  };
}
