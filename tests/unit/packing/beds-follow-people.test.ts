import { describe, expect, it } from 'vitest';
import { bedsToMake, computePackage, DEFAULT_SETTINGS, linenPerDuvet, madeBeds, pillowsPerDuvet, planBeds } from '@/core/packing';
import { bedSummary, duvetText, warningLine } from '@/core/i18n/sk';
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
    expect(count(full, 'plachta')).toBe(4); // sheets by bed, all large: 3 doubles + the single
    expect(count(full, 'plachtaM')).toBe(0);
    expect(full.warnings).toContain('sheet_size_check');
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

  it('beds are made complete even for one guest (owner rule 2026-10-04): a large duvet with 2 pillows, or 2 small duvets with 2 pillows; the bed always gets its sheet', () => {
    const large = computePackage(pkg({ listing: listing({ beds: { KING_BED: 1 }, accommodates: 2, laundry: laundry('Paplón veľký: 1') }), next: sameDay(1) }));
    expect([count(large, 'paplonV'), count(large, 'paplonM'), count(large, 'vankus'), count(large, 'plachta'), count(large, 'plachtaM')]).toEqual([1, 0, 2, 1, 0]);
    expect(count(large, 'osuskaV')).toBe(1); // towels follow the guest
    const small = computePackage(pkg({ listing: listing({ beds: { KING_BED: 1 }, accommodates: 2, laundry: laundry('Paplón malý: 2') }), next: sameDay(1) }));
    expect([count(small, 'paplonV'), count(small, 'paplonM'), count(small, 'vankus'), count(small, 'plachta'), count(small, 'plachtaM')]).toEqual([0, 2, 2, 1, 0]); // the king still gets one large sheet
    // Gross. 23: two large duvets on one queen stay together for one guest
    const two = computePackage(pkg({ listing: listing({ beds: { QUEEN_BED: 1 }, accommodates: 2, laundry: laundry('Paplón veľký: 2') }), next: sameDay(1) }));
    expect(count(two, 'paplonV')).toBe(2);
    expect(count(two, 'vankus')).toBe(4);
  });

  it('3 guests get two complete double beds (for 4); towels, toilet paper and capsules follow the 3 guests', () => {
    const chalupkova = computePackage(pkg({ listing: listing({ beds: { KING_BED: 2 }, accommodates: 4, laundry: laundry('Paplón veľký: 2\nKapsule: Tchibo Cafissimo') }), next: sameDay(3) }));
    expect([count(chalupkova, 'paplonV'), count(chalupkova, 'vankus'), count(chalupkova, 'plachta')]).toEqual([2, 4, 2]);
    expect(count(chalupkova, 'osuskaV')).toBe(3);
    expect(count(chalupkova, 'uterakM')).toBe(3);
    expect(count(chalupkova, 'toaletak')).toBe(4);
    expect(chalupkova.capsules[0]?.n).toBe(3);
    const small = computePackage(pkg({ listing: listing({ beds: { KING_BED: 1, SOFA_BED: 1 }, accommodates: 4, laundry: laundry('Paplón malý: 4') }), next: sameDay(3) }));
    expect(small.beds.usedGroups).toEqual(['dvoj', 'gauc']);
    expect([count(small, 'paplonM'), count(small, 'vankus'), count(small, 'plachta'), count(small, 'plachtaM')]).toEqual([4, 4, 2, 0]); // king + sofa: two large sheets
  });

  it('the Guesty set is handed out per bed: large to double beds (the set divided over them), small per sleeper of the rest, the whole set for a full flat', () => {
    const mixed = { beds: { KING_BED: 1, SOFA_BED: 1 }, accommodates: 4, laundry: laundry('Paplón veľký: 1\nPaplón malý: 2') };
    // a couple on the king: the large duvet only
    const couple = computePackage(pkg({ listing: listing(mixed), next: sameDay(2) }));
    expect([count(couple, 'paplonV'), count(couple, 'paplonM')]).toEqual([1, 0]);
    // 3 guests: king large, sofa its two small ones
    const three = computePackage(pkg({ listing: listing(mixed), next: sameDay(3) }));
    expect([count(three, 'paplonV'), count(three, 'paplonM')]).toEqual([1, 2]);
    // Moyzesova with 4 guests: 3 doubles take 3 large, the single bed gets the leftover large (no small ones in the flat)
    const moyz = computePackage(pkg({ listing: listing({ beds: { KING_BED: 1, QUEEN_BED: 2, SINGLE_BED: 1 }, accommodates: 7, laundry: laundry('Paplón veľký: 4') }), next: sameDay(4) }));
    expect([count(moyz, 'paplonV'), count(moyz, 'paplonM'), count(moyz, 'vankus'), count(moyz, 'plachta'), count(moyz, 'plachtaM')]).toEqual([4, 0, 8, 4, 0]); // sheets by bed, all large
    // Vysoká: 3 large for 2 kings - one per bed until the flat is full
    const vysoka = { beds: { KING_BED: 2 }, accommodates: 4, laundry: laundry('Paplón veľký: 3') };
    expect(count(computePackage(pkg({ listing: listing(vysoka), next: sameDay(3) })), 'paplonV')).toBe(2);
    expect(count(computePackage(pkg({ listing: listing(vysoka), next: sameDay(4) })), 'paplonV')).toBe(3);
    // Tomášikova, 3 guests: king (2 small) + two singles (1 each) = 4 small
    const tom = computePackage(pkg({ listing: listing({ beds: { KING_BED: 1, SOFA_BED: 1, SINGLE_BED: 2 }, accommodates: 5, laundry: laundry('Paplón malý: 6') }), next: sameDay(3) }));
    expect(tom.beds.usedGroups).toEqual(['dvoj', 'jedno', 'jedno']);
    expect(count(tom, 'paplonM')).toBe(4);
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

  it('flags a Guesty duvet set larger than the flat capacity (Mestská: 4 large, capacity 2) with the numbers; never for private linen', () => {
    const mestska = computePackage(pkg({ listing: listing({ beds: { KING_BED: 1, SOFA_BED: 1 }, accommodates: 2, laundry: laundry('Paplón veľký: 4\nPaplón malý: 0') }), next: sameDay(2) }));
    expect(mestska.warnings).toContain('duvets_exceed_capacity');
    expect(mestska.duvetInventory).toEqual({ large: 4, small: 0, capacity: 2 });
    expect(warningLine('duvets_exceed_capacity', mestska)).toBe('❓ Otázka pre Angeliku: v Guesty je 4 veľké paplóny, ale kapacita bytu je 2 osoby – koľko baliť?');
    expect(count(mestska, 'paplonV')).toBe(4); // a full flat (2 of 2) gets the whole set as written
    // one spare duvet is normal (a fold-out bed): Tomášikova, no warning
    const tomasikova = computePackage(pkg({ listing: listing({ beds: { KING_BED: 1, SOFA_BED: 1, SINGLE_BED: 2 }, accommodates: 5, laundry: laundry('Paplón malý: 6') }), next: sameDay(5) }));
    expect(tomasikova.warnings).not.toContain('duvets_exceed_capacity');
    expect(tomasikova.duvetInventory).toBeUndefined();
    expect(count(tomasikova, 'paplonM')).toBe(6); // a full flat gets the whole set: every bed complete
    // two or more spare duvets are flagged, with the plural forms
    const seven = computePackage(pkg({ listing: listing({ beds: { KING_BED: 1, SOFA_BED: 1, SINGLE_BED: 2 }, accommodates: 5, laundry: laundry('Paplón malý: 7') }), next: sameDay(5) }));
    expect(warningLine('duvets_exceed_capacity', seven)).toBe('❓ Otázka pre Angeliku: v Guesty je 7 malých paplónov, ale kapacita bytu je 5 osôb – koľko baliť?');
    const fine = computePackage(pkg({ listing: listing({ beds: { KING_BED: 3 }, accommodates: 6, laundry: laundry('Paplón veľký: 3') }), next: sameDay(2) }));
    expect(fine.warnings).not.toContain('duvets_exceed_capacity');
    expect(fine.duvetInventory).toBeUndefined();
    // private linen is no exception: Jégého A (4 small for 2 guests) gets the question too
    const priv = computePackage(pkg({ listing: listing({ beds: { KING_BED: 1 }, accommodates: 2, laundry: laundry('Paplón malý: 4\nPrádlo: súkromné') }), next: sameDay(2) }));
    expect(priv.warnings).toContain('duvets_exceed_capacity');
  });

  it('sheets follow the beds as Guesty lists them, one large sheet each (never a small one); pillows follow the duvets', () => {
    const r = computePackage(pkg({ listing: listing({ beds: { KING_BED: 1, SOFA_BED: 1 }, accommodates: 4, laundry: laundry('Paplón veľký: 1\nPaplón malý: 2') }), next: sameDay(3) }));
    expect(count(r, 'paplonV')).toBe(1);
    expect(count(r, 'paplonM')).toBe(2);
    expect(count(r, 'plachta')).toBe(2); // king + sofa
    expect(count(r, 'plachtaM')).toBe(0);
    expect(count(r, 'vankus')).toBe(4);
    const singles = computePackage(pkg({ listing: listing({ beds: { KING_BED: 1, SINGLE_BED: 2 }, accommodates: 4, laundry: laundry('Paplón malý: 4') }), next: sameDay(4) }));
    expect([count(singles, 'plachta'), count(singles, 'plachtaM'), count(singles, 'paplonM'), count(singles, 'vankus')]).toEqual([3, 0, 4, 4]);
    expect(singles.warnings).toContain('sheet_size_check');
    expect(r.warnings).not.toContain('sheet_size_check'); // no single bed made: nothing to check
    expect(linenPerDuvet(DEFAULT_SETTINGS)).toEqual({ large: { vankus: 2 }, small: { vankus: 1 } });
    // towels, bathroom and consumables are untouched
    expect(count(r, 'osuskaV')).toBe(3);
    expect(count(r, 'toaletak')).toBe(4);
  });

  it('pillows follow the duvets when Guesty counts apply: 2 per large, 1 per small (owner rule 2026-10-04)', () => {
    // "malý" flat: 2 kings + sofa, 6 small duvets, 2 guests -> 2 beds, 2 small duvets, 2 pillows (not 4)
    const small = computePackage(pkg({ listing: listing({ beds: { KING_BED: 2, SOFA_BED: 1 }, accommodates: 6, laundry: laundry('Paplón veľký: 0\nPaplón malý: 6') }), next: sameDay(2) }));
    expect(count(small, 'paplonM')).toBe(4); // two complete double beds
    expect(count(small, 'vankus')).toBe(4);
    expect(count(small, 'plachta')).toBe(2); // one sheet per double bed
    expect(count(small, 'plachtaM')).toBe(0);
    // full flat: 6 small -> 6 pillows
    expect(count(computePackage(pkg({ listing: listing({ beds: { KING_BED: 2, SOFA_BED: 1 }, accommodates: 6, laundry: laundry('Paplón malý: 6') }), next: sameDay(6) })), 'vankus')).toBe(6);
    // two large duvets on one queen (Gross. 23): 4 pillows for 2 guests
    expect(count(computePackage(pkg({ listing: listing({ beds: { QUEEN_BED: 1 }, accommodates: 2, laundry: laundry('Paplón veľký: 2') }), next: sameDay(2) })), 'vankus')).toBe(4);
    // mixed set, 2 guests: the king's large duvet only -> 2 pillows
    expect(count(computePackage(pkg({ listing: listing({ beds: { KING_BED: 1, SOFA_BED: 1 }, accommodates: 4, laundry: laundry('Paplón veľký: 1\nPaplón malý: 2') }), next: sameDay(2) })), 'vankus')).toBe(2);
    // the ratio comes from the linen table: 4 pillows per double bed -> 4 per large duvet
    const fat = { ...DEFAULT_SETTINGS, beds: { ...DEFAULT_SETTINGS.beds, dvoj: { ...DEFAULT_SETTINGS.beds.dvoj, vankus: 4 } } };
    expect(count(computePackage(pkg({ settings: fat, listing: listing({ beds: { KING_BED: 3 }, accommodates: 6, laundry: laundry('Paplón veľký: 3') }), next: sameDay(2) })), 'vankus')).toBe(8);
    expect(pillowsPerDuvet(DEFAULT_SETTINGS)).toEqual({ large: 2, small: 1 });
    // without Guesty counts the table per made bed still decides
    expect(count(computePackage(pkg({ listing: listing({ beds: { KING_BED: 2 }, accommodates: 4, laundry: null }), next: sameDay(1) })), 'vankus')).toBe(2);
  });

  it('tells Angelika when more beds are made than the guests need if they pair up (2 guests, 2 beds), not otherwise', () => {
    const two = computePackage(pkg({ listing: listing({ beds: { KING_BED: 2, SOFA_BED: 1 }, accommodates: 6, laundry: laundry('Paplón malý: 6') }), next: sameDay(2) }));
    expect(two.beds.usedGroups).toEqual(['dvoj', 'dvoj']);
    expect(two.warnings).toContain('separate_beds');
    expect(warningLine('separate_beds', two)).toBe('ℹ️ Odporúčanie: pre 2 hostí môžeme pripraviť obidve postele, aby mal každý svoju (aplikácia to ráta takto).');
    const three = computePackage(pkg({ listing: listing({ beds: { KING_BED: 3 }, accommodates: 6, laundry: laundry('Paplón veľký: 3') }), next: sameDay(3) }));
    expect(warningLine('separate_beds', three)).toBe('ℹ️ Odporúčanie: pre 3 hostí môžeme pripraviť všetky 3 postele, aby mal každý svoju (aplikácia to ráta takto).');
    // more guests than beds (4 guests in king + 2 singles): the beds are simply full, no rule line
    expect(computePackage(pkg({ listing: listing({ beds: { KING_BED: 1, SINGLE_BED: 2 }, accommodates: 4, laundry: laundry('Paplón malý: 4') }), next: sameDay(4) })).warnings).not.toContain('separate_beds');
    // one bed only, a couple on it, a full flat, one guest: nothing to say
    expect(computePackage(pkg({ listing: listing({ beds: { KING_BED: 1, SOFA_BED: 1 }, accommodates: 4, laundry: laundry('Paplón veľký: 2') }), next: sameDay(2) })).warnings).not.toContain('separate_beds');
    expect(computePackage(pkg({ listing: listing({ beds: { KING_BED: 3 }, accommodates: 6, laundry: laundry('Paplón veľký: 3') }), next: sameDay(6) })).warnings).not.toContain('separate_beds');
    expect(computePackage(pkg({ listing: listing({ beds: { KING_BED: 2 }, accommodates: 4, laundry: laundry('Paplón veľký: 2') }), next: sameDay(1) })).warnings).not.toContain('separate_beds');
  });

  it('settings-table duvets follow the made beds; the small-duvet conversion still applies per made bed', () => {
    const r = computePackage(pkg({ listing: listing({ beds: { KING_BED: 2 }, accommodates: 4, laundry: laundry('Paplóny: malé') }), next: sameDay(1) }));
    expect(count(r, 'paplonM')).toBe(2);
    expect(count(r, 'paplonV')).toBe(0);
    expect(count(r, 'plachta')).toBe(1); // the sheet goes with the (king) bed
    expect(count(r, 'plachtaM')).toBe(0);
  });

  it('per-item overrides stay absolute; private linen changes nothing in the counts (owner 2026-10-05)', () => {
    const r = computePackage(pkg({ listing: listing({ beds: { KING_BED: 3 }, accommodates: 6, laundry: laundry('Paplón veľký: 3\nOsušky: 5') }), next: sameDay(2) }));
    expect(count(r, 'osuskaV')).toBe(5);
    const priv = computePackage(pkg({ listing: listing({ beds: { KING_BED: 3 }, accommodates: 6, laundry: laundry('Paplón veľký: 3\nPrádlo: súkromné') }), next: sameDay(2) }));
    expect(priv.private).toBe(true);
    expect([count(priv, 'paplonV'), count(priv, 'vankus'), count(priv, 'plachta')]).toEqual([2, 4, 2]);
    expect(priv.consumables.length).toBeGreaterThan(0);
  });
});
