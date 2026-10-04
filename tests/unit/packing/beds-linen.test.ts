import { describe, expect, it } from 'vitest';
import { computePackage, planBeds } from '@/core/packing';
import { bedSummary, duvetText, sofaText } from '@/core/i18n/sk';
import { D0, count, laundry, listing, pkg, reservation } from './helpers';

const sameDay = (guests: number) => reservation({ guestyId: 'R2', checkInDate: D0, guests });

describe('test 5: the sofa bed is used only when needed', () => {
  it('1 king + 1 sofa for 2 people: sofa not used', () => {
    const r = computePackage(pkg({ next: sameDay(2) }));
    expect(r.beds.sofasUsed).toBe(0);
    expect(sofaText(r)).toBe('gauč netreba');
    expect(count(r, 'paplonV')).toBe(1);
    expect(count(r, 'vankus')).toBe(2);
    expect(count(r, 'plachta')).toBe(1);
  });

  it('1 king + 1 sofa for 3 people: sofa unfolded and gets its linen', () => {
    const r = computePackage(pkg({ next: sameDay(3) }));
    expect(r.beds.sofasUsed).toBe(1);
    expect(sofaText(r)).toBe('rozložiť gauč');
    expect(count(r, 'paplonV')).toBe(2);
    expect(count(r, 'vankus')).toBe(4);
    expect(count(r, 'plachta')).toBe(2);
  });

  it('sofas are added one by one: 1 king + 2 sofas for 5 people unfolds both', () => {
    const r = computePackage(pkg({ listing: listing({ beds: { KING_BED: 1, SOFA_BED: 2 }, accommodates: 6 }), next: sameDay(5) }));
    expect(r.beds.sofasUsed).toBe(2);
    expect(sofaText(r)).toBe('rozložiť gauč ×2');
    const r3 = computePackage(pkg({ listing: listing({ beds: { KING_BED: 1, SOFA_BED: 2 }, accommodates: 6 }), next: sameDay(3) }));
    expect(r3.beds.sofasUsed).toBe(1);
  });

  it('beds follow people (owner rule 2026-10-03): 1 guest in a 2-king flat gets one made bed', () => {
    const r = computePackage(pkg({ listing: listing({ beds: { KING_BED: 2 }, accommodates: 4 }), next: sameDay(1) }));
    expect(count(r, 'paplonV')).toBe(1);
    expect(count(r, 'vankus')).toBe(2);
    expect(count(r, 'plachta')).toBe(1);
    expect(count(r, 'osuskaV')).toBe(1);
    expect(bedSummary(r)).toBe('1× king (z 2)');
    expect(sofaText(r)).toBeNull();
  });

  it('no sofa text when the flat has no sofa', () => {
    const r = computePackage(pkg({ listing: listing({ beds: { KING_BED: 1 }, accommodates: 2 }) }));
    expect(sofaText(r)).toBeNull();
  });
});

describe('bed types', () => {
  it('single bed = 1 person with small linen', () => {
    const r = computePackage(pkg({ listing: listing({ beds: { KING_BED: 1, SINGLE_BED: 2 }, accommodates: 4 }) }));
    expect(count(r, 'paplonV')).toBe(1);
    expect(count(r, 'paplonM')).toBe(2);
    expect(count(r, 'vankus')).toBe(4);
    expect(count(r, 'plachta')).toBe(1);
    expect(count(r, 'plachtaM')).toBe(2);
    expect(bedSummary(r)).toBe('1× king, 2× jednolôžko');
  });

  it('bunk bed = 2 single beds + warning', () => {
    const r = computePackage(pkg({ listing: listing({ beds: { KING_BED: 1, BUNK_BED: 1 }, accommodates: 4 }) }));
    expect(count(r, 'paplonM')).toBe(2);
    expect(count(r, 'plachtaM')).toBe(2);
    expect(r.beds.bunk).toBe(true);
    expect(r.warnings).toContain('bunk');
    expect(bedSummary(r)).toBe('1× king, 2× poschodová (lôžko)');
  });

  it('KING, QUEEN, DOUBLE and unknown types are double beds for 2', () => {
    const p = planBeds({ KING_BED: 1, QUEEN_BED: 1, DOUBLE_BED: 1, WATER_BED: 1 }, 8);
    expect(p.plan.capacityRegular).toBe(8);
    expect(p.warnings).toContain('unknown_bed_type');
    expect(planBeds({ KING_BED: 1 }, 2).warnings).not.toContain('unknown_bed_type');
  });

  it('cribs and toddler beds are ignored', () => {
    const p = planBeds({ KING_BED: 1, CRIB: 1, TODDLER_BED: 1 }, 2);
    expect(p.plan.capacityRegular).toBe(2);
    expect(p.plan.regular).toEqual([{ type: 'KING_BED', qty: 1 }]);
  });

  it('a listing with no beds gets one unknown double bed and a warning', () => {
    const r = computePackage(pkg({ listing: listing({ beds: {}, accommodates: 2 }) }));
    expect(r.warnings).toContain('no_beds');
    expect(count(r, 'paplonV')).toBe(1);
    expect(bedSummary(r)).toBe('1× posteľ');
  });

  it('beds that cannot cover the people produce a warning', () => {
    const r = computePackage(pkg({ listing: listing({ beds: { KING_BED: 1 }, accommodates: 4 }) }));
    expect(r.warnings).toContain('beds_insufficient');
    expect(count(r, 'osuskaV')).toBe(4);
  });
});

describe('test 6: exact duvet counts override the beds', () => {
  it('Paplón malý: 4 replaces the calculated duvets, large becomes 0', () => {
    const r = computePackage(pkg({ listing: listing({ laundry: laundry('Paplón malý: 4') }) }));
    expect(count(r, 'paplonM')).toBe(4);
    expect(count(r, 'paplonV')).toBe(0);
    expect(r.linen.find((l) => l.key === 'paplonM')?.source).toBe('guesty');
    expect(r.duvetSource).toBe('guesty_exact');
    expect(duvetText(r)).toBe('podľa Guesty');
    expect(r.warnings).not.toContain('no_duvet_info');
  });

  it('only Paplón veľký: 2 -> small is 0; king + sofa share the 2 large one each, so 1 or 2 guests on the king get 1, 3 guests (sofa unfolded) 2', () => {
    const r = computePackage(pkg({ listing: listing({ laundry: laundry('Paplón veľký: 2') }), next: sameDay(1) }));
    expect(count(r, 'paplonV')).toBe(1);
    expect(count(r, 'paplonM')).toBe(0);
    expect(count(r, 'vankus')).toBe(2);
    expect(count(computePackage(pkg({ listing: listing({ laundry: laundry('Paplón veľký: 2') }), next: sameDay(2) })), 'paplonV')).toBe(1);
    expect(count(computePackage(pkg({ listing: listing({ laundry: laundry('Paplón veľký: 2') }), next: sameDay(3) })), 'paplonV')).toBe(2);
  });

  it('exact counts win over the Paplóny: line and the Settings choice', () => {
    const r = computePackage(pkg({ listing: listing({ laundry: laundry('Paplón veľký: 1\nPaplóny: malé') }), duvetTypeSetting: 'male' }));
    expect(r.duvetSource).toBe('guesty_exact');
    expect(count(r, 'paplonV')).toBe(1);
  });
});

describe('duvet type precedence', () => {
  it('Paplóny: malé -> 2 small duvets instead of 1 large per double bed and used sofa', () => {
    const r = computePackage(pkg({ listing: listing({ laundry: laundry('Paplóny: malé') }), next: sameDay(3) }));
    expect(count(r, 'paplonV')).toBe(0);
    expect(count(r, 'paplonM')).toBe(4);
    expect(r.duvetSource).toBe('guesty_type');
    expect(duvetText(r)).toBe('malé');
  });

  it('Guesty type line beats the Settings choice', () => {
    const r = computePackage(pkg({ listing: listing({ laundry: laundry('Paplóny: veľké') }), duvetTypeSetting: 'male' }));
    expect(r.duvetSource).toBe('guesty_type');
    expect(count(r, 'paplonV')).toBe(2);
  });

  it('Settings choice is used when Guesty has nothing', () => {
    const r = computePackage(pkg({ duvetTypeSetting: 'male' }));
    expect(r.duvetSource).toBe('setting');
    expect(count(r, 'paplonM')).toBe(4);
    expect(r.warnings).not.toContain('no_duvet_info');
  });

  it('no duvet info at all -> large duvets + warning', () => {
    const r = computePackage(pkg());
    expect(r.duvetSource).toBe('default');
    expect(r.duvetType).toBe('velke');
    expect(count(r, 'paplonV')).toBe(2);
    expect(r.warnings).toContain('no_duvet_info');
    expect(duvetText(r)).toBeNull();
  });
});

describe('test 7: bathrooms', () => {
  it('1.5 bathrooms gives 1 foot towel', () => {
    const r = computePackage(pkg({ listing: listing({ bathrooms: 1.5 }) }));
    expect(count(r, 'predlozka')).toBe(1);
    expect(r.bathrooms).toBe(1);
  });
  it('2 bathrooms give 2, 0.5 gives 1', () => {
    expect(count(computePackage(pkg({ listing: listing({ bathrooms: 2 }) })), 'predlozka')).toBe(2);
    expect(count(computePackage(pkg({ listing: listing({ bathrooms: 0.5 }) })), 'predlozka')).toBe(1);
  });
  it('unknown bathrooms give 1 with a warning', () => {
    const r = computePackage(pkg({ listing: listing({ bathrooms: null }) }));
    expect(count(r, 'predlozka')).toBe(1);
    expect(r.warnings).toContain('bathrooms_missing');
  });
});

describe('per-item overrides and private linen', () => {
  it('Osušky veľké / Uteráky malé / Uteráky na nohy override the counts as fixed numbers', () => {
    const r = computePackage(pkg({ listing: listing({ laundry: laundry('Osušky veľké: 6\nUteráky malé: 2\nUteráky na nohy do kúpeľne: 3') }), next: sameDay(1) }));
    expect(count(r, 'osuskaV')).toBe(6);
    expect(count(r, 'uterakM')).toBe(2);
    expect(count(r, 'predlozka')).toBe(3);
    expect(r.linen.filter((l) => l.source === 'guesty').map((l) => l.key).sort()).toEqual(['osuskaV', 'predlozka', 'uterakM']);
  });

  it('private linen: no linen rows, consumables still packed, banner flag set', () => {
    const r = computePackage(pkg({ listing: listing({ laundry: laundry('Prádlo: súkromné\nPaplón veľký: 2') }) }));
    expect(r.private).toBe(true);
    expect(r.linen).toEqual([]);
    expect(r.consumables.length).toBeGreaterThan(0);
    expect(count(r, 'toaletak')).toBe(4);
    expect(r.capsules.length).toBe(1);
  });

  it('every used bed group and per-person, per-bathroom, per-apartment items are summed', () => {
    const r = computePackage(pkg({ listing: listing({ beds: { KING_BED: 2, SOFA_BED: 1 }, accommodates: 6, bathrooms: 2, laundry: laundry('Paplóny: veľké') }) }));
    expect(r.linen.map((l) => [l.key, l.n])).toEqual([
      ['paplonV', 3],
      ['vankus', 6],
      ['plachta', 3],
      ['osuskaV', 6],
      ['uterakM', 6],
      ['predlozka', 2],
    ]);
    expect(r.consumables.map((l) => [l.key, l.n])).toEqual([
      ['toaletak', 6],
      ['utierky', 1],
      ['spongia', 1],
      ['myckaKaps', 2],
      ['vreckoV', 1],
      ['vreckoM', 1],
    ]);
  });
});
