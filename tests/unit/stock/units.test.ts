import { describe, expect, it } from 'vitest';
import { countTotal, packInfo, proposeOrder, skuAt } from '@/core/stock';
import { sku } from './helpers';

describe('prepočet balení (Neoverené)', () => {
  it('balenie bez počtu kusov alebo bez zdroja overenia je neoverené', () => {
    expect(packInfo(sku({ piecesPerPack: null })).verified).toBe(false);
    expect(packInfo(sku({ verifiedSource: null })).verified).toBe(false);
    expect(packInfo(sku({ verifiedAt: null })).verified).toBe(false);
    expect(packInfo(sku({ piecesPerPack: 0 })).verified).toBe(false);
    expect(packInfo(sku({ piecesPerPack: 2.5 })).verified).toBe(false);
    expect(packInfo(null).verified).toBe(false);
    expect(packInfo(sku())).toEqual({ verified: true, piecesPerPack: 20 });
  });

  it('neznáme balenie: žiadny konečný počet balení, ani odhad', () => {
    const p = proposeOrder({ need: 100, reserve: 10, usableStock: 0, incoming: 0, sku: sku({ piecesPerPack: null }) });
    expect(p.status).toBe('unverified');
    expect(p).not.toHaveProperty('packs');
    expect(proposeOrder({ need: 1, reserve: 0, usableStock: 0, incoming: 0, sku: null }).status).toBe('unverified');
  });

  it('dodávateľ zmenil balenie v čase: platí ponuka platná v daný deň', () => {
    const skus = [sku({ id: 'old', validTo: '2026-06-30', piecesPerPack: 10 }), sku({ id: 'new', validFrom: '2026-07-01', piecesPerPack: 20 })];
    expect(skuAt(skus, 'tp', '2026-06-30')?.piecesPerPack).toBe(10);
    expect(skuAt(skus, 'tp', '2026-07-01')?.piecesPerPack).toBe(20);
    expect(skuAt(skus, 'tp', '2025-12-31')).toBeNull();
    expect(skuAt(skus, 'iny', '2026-07-01')).toBeNull();
  });
});

describe('súčet inventúry', () => {
  const ok = packInfo(sku());
  const unk = packInfo(sku({ piecesPerPack: null }));
  it('celé balenia x kusov v balení + voľné kusy', () => {
    expect(countTotal({ packs: 3, loose: 7 }, ok)).toEqual({ state: 'counted', total: 67 });
    expect(countTotal({ loose: 5 }, ok)).toEqual({ state: 'counted', total: 5 });
  });
  it('prázdne pole nie je nula; nula je len napísaná alebo „overená nula“', () => {
    expect(countTotal({}, ok)).toEqual({ state: 'unset' });
    expect(countTotal({ packs: null, loose: null }, ok)).toEqual({ state: 'unset' });
    expect(countTotal({ packs: 0, loose: 0 }, ok)).toEqual({ state: 'zero', total: 0 });
    expect(countTotal({ verifiedZero: true }, ok)).toEqual({ state: 'zero', total: 0 });
    expect(countTotal({ verifiedZero: true, loose: 3 }, ok).state).toBe('invalid');
  });
  it('celé balenia bez overeného prepočtu sa neprepočítajú; voľné kusy áno', () => {
    expect(countTotal({ packs: 2 }, unk).state).toBe('unverified');
    expect(countTotal({ loose: 9 }, unk)).toEqual({ state: 'counted', total: 9 });
  });
  it('záporné a desatinné čísla sú neplatné', () => {
    expect(countTotal({ packs: -1 }, ok).state).toBe('invalid');
    expect(countTotal({ loose: 1.5 }, ok).state).toBe('invalid');
  });
});
