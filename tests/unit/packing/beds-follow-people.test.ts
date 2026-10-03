import { describe, expect, it } from 'vitest';
import { bedsToMake, computePackage, duvetsFor, madeBeds, planBeds } from '@/core/packing';
import { bedSummary, duvetText } from '@/core/i18n/sk';
import { D0, count, laundry, listing, pkg, reservation } from './helpers';

const sameDay = (guests: number) => reservation({ guestyId: 'R2', checkInDate: D0, guests });

/**
 * Owner's rule of 2026-10-03 (replaces proposal Q4): beds and duvets follow the
 * people. Reported on Klariská (2 guests, 3 king beds, "Paplón veľký: 3" -> 3
 * duvets shown, 2 wanted) and Moyzesova (3 guests, 4 duvets shown, 3 wanted).
 */
describe('beds follow the people', () => {
  it('Klariská: 3 king beds, "Paplón veľký: 3", 2 guests -> 2 beds, 2 large duvets, 2 sheets, 4 pillows', () => {
    const r = computePackage(
      pkg({ listing: listing({ beds: { KING_BED: 3 }, accommodates: 6, laundry: laundry('Paplón veľký: 3\nPaplón malý: 0\nKapsule: Tchibo Cafissimo') }), next: sameDay(2) }),
    );
    expect(r.people).toBe(2);
    expect(count(r, 'paplonV')).toBe(2);
    expect(count(r, 'paplonM')).toBe(0);
    expect(count(r, 'plachta')).toBe(2);
    expect(count(r, 'vankus')).toBe(4);
    expect(r.beds.usedGroups).toEqual(['dvoj', 'dvoj']);
    expect(bedSummary(r)).toBe('2× king (z 3)');
    expect(duvetText(r)).toBe('podľa Guesty');
    // towels and capsules follow people as before
    expect(count(r, 'osuskaV')).toBe(2);
    expect(r.capsules[0]?.n).toBe(2);
  });

  it('Klariská with a full flat (6 guests) packs everything as before', () => {
    const r = computePackage(pkg({ listing: listing({ beds: { KING_BED: 3 }, accommodates: 6, laundry: laundry('Paplón veľký: 3') }), next: sameDay(6) }));
    expect(count(r, 'paplonV')).toBe(3);
    expect(count(r, 'plachta')).toBe(3);
    expect(count(r, 'vankus')).toBe(6);
    expect(bedSummary(r)).toBe('3× king');
  });

  it('Moyzesova: 1 king + 2 queen + 1 single, "Paplón veľký: 4", 3 guests -> 3 double beds made, 3 large duvets', () => {
    const r = computePackage(
      pkg({
        listing: listing({ beds: { KING_BED: 1, QUEEN_BED: 2, SINGLE_BED: 1 }, accommodates: 7, laundry: laundry('Paplón veľký: 4\nPaplón malý: 0') }),
        next: sameDay(3),
      }),
    );
    expect(count(r, 'paplonV')).toBe(3);
    expect(count(r, 'paplonM')).toBe(0);
    expect(count(r, 'plachta')).toBe(3);
    expect(count(r, 'plachtaM')).toBe(0);
    expect(count(r, 'vankus')).toBe(6);
    expect(r.beds.usedGroups).toEqual(['dvoj', 'dvoj', 'dvoj']);
    expect(bedSummary(r)).toBe('1× king, 2× queen · 1× jednolôžko netreba');
    // 7 guests: every bed, the full set of 4 large duvets
    const full = computePackage(
      pkg({ listing: listing({ beds: { KING_BED: 1, QUEEN_BED: 2, SINGLE_BED: 1 }, accommodates: 7, laundry: laundry('Paplón veľký: 4') }), next: sameDay(7) }),
    );
    expect(count(full, 'paplonV')).toBe(4);
    expect(count(full, 'plachtaM')).toBe(1);
    expect(bedSummary(full)).toBe('1× king, 2× queen, 1× jednolôžko');
  });

  it('bed summary: partly made groups say "(z N)" / "(zo 4)", unmade groups are named once as "netreba"', () => {
    const one = computePackage(pkg({ listing: listing({ beds: { KING_BED: 1, QUEEN_BED: 2, SINGLE_BED: 1 }, accommodates: 7 }), next: sameDay(1) }));
    expect(bedSummary(one)).toBe('1× king · 2× queen, 1× jednolôžko netreba');
    const four = computePackage(pkg({ listing: listing({ beds: { KING_BED: 4 }, accommodates: 8 }), next: sameDay(3) }));
    expect(bedSummary(four)).toBe('3× king (zo 4)');
    const singlesFirst = computePackage(pkg({ listing: listing({ beds: { SINGLE_BED: 2, KING_BED: 1 }, accommodates: 4 }), next: sameDay(1) }));
    expect(singlesFirst.beds.usedGroups).toEqual(['dvoj']);
    expect(bedSummary(singlesFirst)).toBe('1× king · 2× jednolôžko netreba');
  });

  it('double beds are made before singles; singles take the people left over', () => {
    expect(bedsToMake(1, 2, 1)).toEqual({ dvoj: 1, jedno: 0 });
    expect(bedsToMake(1, 2, 2)).toEqual({ dvoj: 1, jedno: 1 });
    expect(bedsToMake(1, 2, 3)).toEqual({ dvoj: 1, jedno: 2 });
    expect(bedsToMake(1, 2, 9)).toEqual({ dvoj: 1, jedno: 2 });
    expect(bedsToMake(0, 2, 1)).toEqual({ dvoj: 0, jedno: 1 });
    // at least one bed, whatever the people number
    expect(bedsToMake(2, 0, 0)).toEqual({ dvoj: 1, jedno: 0 });
  });

  it('usedGroups keeps the flat bed order, so flats with every bed made hash exactly as before', () => {
    const plan = planBeds({ BUNK_BED: 1, KING_BED: 1, SOFA_BED: 1 }, 5).plan;
    expect(plan.usedGroups).toEqual(['jedno', 'jedno', 'dvoj', 'gauc']);
    expect(plan.sofasUsed).toBe(1);
    expect(madeBeds(plan)).toEqual([
      { type: 'BUNK_BED', qty: 2, of: 2 },
      { type: 'KING_BED', qty: 1, of: 1 },
    ]);
    // 2 guests: the king first, then one bunk bed; capacity 3 >= 2, so no sofa
    const two = planBeds({ BUNK_BED: 1, KING_BED: 1, SOFA_BED: 1 }, 2).plan;
    expect(two.usedGroups).toEqual(['jedno', 'dvoj']);
    expect(two.sofasUsed).toBe(0);
    expect(madeBeds(two)).toEqual([
      { type: 'BUNK_BED', qty: 1, of: 2 },
      { type: 'KING_BED', qty: 1, of: 1 },
    ]);
  });

  it('sofas are unfolded only when the made beds cannot sleep everyone (unchanged)', () => {
    const beds = { KING_BED: 1, SOFA_BED: 1 };
    expect(planBeds(beds, 1).plan.sofasUsed).toBe(0);
    expect(planBeds(beds, 2).plan.sofasUsed).toBe(0);
    expect(planBeds(beds, 3).plan.sofasUsed).toBe(1);
    expect(planBeds({ SINGLE_BED: 2, SOFA_BED: 1 }, 3).plan.usedGroups).toEqual(['jedno', 'jedno', 'gauc']);
  });

  it('Guesty duvet counts are the full set: one per guest, large first, never more than the flat has', () => {
    expect(duvetsFor({ large: 3, small: 0 }, 2)).toEqual({ large: 2, small: 0 });
    expect(duvetsFor({ large: 3, small: 0 }, 6)).toEqual({ large: 3, small: 0 });
    expect(duvetsFor({ large: 0, small: 6 }, 2)).toEqual({ large: 0, small: 2 });
    expect(duvetsFor({ large: 1, small: 2 }, 1)).toEqual({ large: 1, small: 0 });
    expect(duvetsFor({ large: 1, small: 2 }, 2)).toEqual({ large: 1, small: 1 });
    expect(duvetsFor({ large: 1, small: 2 }, 4)).toEqual({ large: 1, small: 2 });
    expect(duvetsFor({ large: 2, small: 0 }, 1)).toEqual({ large: 1, small: 0 });
    expect(duvetsFor({ large: 0, small: 0 }, 3)).toEqual({ large: 0, small: 0 });
    expect(duvetsFor({ large: -1, small: 2 }, 3)).toEqual({ large: 0, small: 2 });
  });

  it('warns when the Guesty set has fewer duvets than beds that get linen (Tri Veže: 1 large, king + sofa, 3 guests)', () => {
    const short = computePackage(pkg({ listing: listing({ beds: { KING_BED: 1, SOFA_BED: 1 }, accommodates: 4, laundry: laundry('Paplón veľký: 1') }), next: sameDay(3) }));
    expect(short.beds.usedGroups).toEqual(['dvoj', 'gauc']);
    expect(count(short, 'paplonV')).toBe(1);
    expect(short.warnings).toContain('duvets_short');
    const fine = computePackage(pkg({ listing: listing({ beds: { KING_BED: 3 }, accommodates: 6, laundry: laundry('Paplón veľký: 3') }), next: sameDay(2) }));
    expect(fine.warnings).not.toContain('duvets_short');
    const couple = computePackage(pkg({ listing: listing({ beds: { KING_BED: 1, SOFA_BED: 1 }, accommodates: 4, laundry: laundry('Paplón veľký: 1') }), next: sameDay(2) }));
    expect(couple.warnings).not.toContain('duvets_short');
  });

  it('settings-table duvets follow the made beds; the small-duvet conversion still applies per made bed', () => {
    const r = computePackage(pkg({ listing: listing({ beds: { KING_BED: 2 }, accommodates: 4, laundry: laundry('Paplóny: malé') }), next: sameDay(1) }));
    expect(count(r, 'paplonM')).toBe(2);
    expect(count(r, 'paplonV')).toBe(0);
    expect(count(r, 'plachta')).toBe(1);
  });

  it('per-item overrides stay absolute and private linen still omits every linen row', () => {
    const r = computePackage(pkg({ listing: listing({ beds: { KING_BED: 3 }, accommodates: 6, laundry: laundry('Paplón veľký: 3\nOsušky: 5') }), next: sameDay(2) }));
    expect(count(r, 'osuskaV')).toBe(5);
    const priv = computePackage(pkg({ listing: listing({ beds: { KING_BED: 3 }, accommodates: 6, laundry: laundry('Paplón veľký: 3\nPrádlo: súkromné') }), next: sameDay(2) }));
    expect(priv.linen).toEqual([]);
    expect(priv.consumables.length).toBeGreaterThan(0);
  });
});
