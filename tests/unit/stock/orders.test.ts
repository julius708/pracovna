import { describe, expect, it } from 'vitest';
import { canTransition, proposeOrder, receiptStatus } from '@/core/stock';
import { sku } from './helpers';

describe('návrh objednávky', () => {
  it('príklad zo zadania: 476 + rezerva 60 − zásoba 150 = 386 → 20 ks/bal. → 20 balení', () => {
    const p = proposeOrder({ need: 476, reserve: 60, usableStock: 150, incoming: 0, sku: sku() });
    expect(p).toMatchObject({ status: 'ok', rawBase: 386, packs: 20, units: 20, orderedBase: 400, basis: 'pack_rounding', netCents: 20000 });
  });
  it('potvrdený príjem sa odpočíta; nikdy pod nulu', () => {
    expect(proposeOrder({ need: 100, reserve: 0, usableStock: 0, incoming: 40, sku: sku() })).toMatchObject({ rawBase: 60, packs: 3 });
    expect(proposeOrder({ need: 10, reserve: 0, usableStock: 500, incoming: 0, sku: sku() })).toMatchObject({ rawBase: 0, packs: 0, basis: 'none' });
  });
  it('záporná zásoba sa nepočíta ako dlh navyše (používateľná zásoba je min. 0)', () => {
    expect(proposeOrder({ need: 20, reserve: 0, usableStock: -30, incoming: 0, sku: sku() })).toMatchObject({ rawBase: 20, packs: 1 });
  });
  it('minimálna objednávka zdvihne počet, len keď je čo objednať', () => {
    const s = sku({ minOrder: 10 });
    expect(proposeOrder({ need: 25, reserve: 0, usableStock: 0, incoming: 0, sku: s })).toMatchObject({ packs: 10, basis: 'minimum_order', orderedBase: 200 });
    expect(proposeOrder({ need: 0, reserve: 0, usableStock: 0, incoming: 0, sku: s })).toMatchObject({ packs: 0 });
  });
  it('kartóny: zaokrúhli sa na celé kartóny; neznámy počet v kartóne = neoverené', () => {
    const c = sku({ purchaseUnit: 'carton', packsPerCarton: 6 });
    expect(proposeOrder({ need: 386, reserve: 0, usableStock: 0, incoming: 0, sku: c })).toMatchObject({ units: 4, packs: 24, orderedBase: 480, basis: 'carton_rounding' });
    expect(proposeOrder({ need: 386, reserve: 0, usableStock: 0, incoming: 0, sku: sku({ purchaseUnit: 'carton', packsPerCarton: null }) }).status).toBe('unverified');
  });
  it('neznáma cena nezhodí návrh, len je cena neznáma', () => {
    expect(proposeOrder({ need: 20, reserve: 0, usableStock: 0, incoming: 0, sku: sku({ priceCents: null }) })).toMatchObject({ packs: 1, netCents: null });
  });
});

describe('stavy objednávky a príjem', () => {
  it('poradie: návrh → kontrola → schválenie → odoslanie → potvrdenie → príjem; nič nepreskočí', () => {
    expect(canTransition('draft', 'review')).toBe(true);
    expect(canTransition('draft', 'approved')).toBe(false);
    expect(canTransition('review', 'approved')).toBe(true);
    expect(canTransition('approved', 'sent')).toBe(true);
    expect(canTransition('approved', 'confirmed')).toBe(false);
    expect(canTransition('sent', 'received')).toBe(false);
    expect(canTransition('confirmed', 'received')).toBe(true);
    expect(canTransition('received', 'cancelled')).toBe(false);
  });
  it('čiastočná dodávka, potom úplná', () => {
    expect(receiptStatus([{ orderedPacks: 10, receivedPacks: 6 }, { orderedPacks: 4, receivedPacks: 4 }])).toBe('partially_received');
    expect(receiptStatus([{ orderedPacks: 10, receivedPacks: 10 }, { orderedPacks: 4, receivedPacks: 5 }])).toBe('received');
  });
});
