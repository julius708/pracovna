import type { IssueAlias, StockItem, SupplierSku } from '@/core/stock';

export const item = (id: string, over: Partial<StockItem> = {}): StockItem => ({
  id, kind: 'consumable', product: id, category: 'spotrebný materiál', variant: null, system: null, baseUnit: 'ks', ...over,
});

export const sku = (over: Partial<SupplierSku> = {}): SupplierSku => ({
  id: 's1', itemId: 'tp', supplier: 'Dodávateľ A', sku: null, purchaseUnit: 'pack', piecesPerPack: 20, packsPerCarton: null,
  priceCents: 1000, currency: 'EUR', vatRate: 0.23, validFrom: '2026-01-01', validTo: null, minOrder: null, leadTimeDays: 5,
  verifiedSource: 'cenová ponuka', verifiedAt: '2026-11-01', ...over,
});

export const aliases: IssueAlias[] = [
  { kind: 'consumable', sourceKey: 'toaletak', itemId: 'tp', factor: 1 },
  { kind: 'consumable', sourceKey: 'vreckoV', itemId: 'bag-l', factor: 1 },
  { kind: 'consumable', sourceKey: 'vreckoM', itemId: 'bag-s', factor: 1 },
  { kind: 'capsule', sourceKey: 'nespresso original', itemId: 'cap-nes-orig', factor: 1 },
  { kind: 'capsule', sourceKey: 'nespresso vertuo', itemId: 'cap-nes-vertuo', factor: 1 },
  { kind: 'capsule', sourceKey: "l'or tassimo", itemId: 'cap-tassimo', factor: 1 },
  { kind: 'linen', sourceKey: 'plachta|dvoj', itemId: 'lin-sheet-d', factor: 1 },
];
