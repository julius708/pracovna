/**
 * Regression tests for the defects found by the independent review of
 * src/core/packing against the spec (§3, §4, §5) and docs/PROPOSAL.md (§6, §9, §10).
 * Findings that the verification refuted (allowed by spec + proposal) are not kept.
 */
import { describe, expect, it } from 'vitest';
import {
  addDays,
  computePackage,
  DEFAULT_SETTINGS,
  diffDays,
  evaluateGap,
  mergeSettings,
  norm,
  parseCapsules,
  parseLaundry,
  planBeds,
  typeKey,
  uniqueStrings,
  windowDates,
  ymdToDate,
} from '@/core/packing';
import type { ListingInput, PackageInput, PackingResult, ReservationInput, WarningCode } from '@/core/packing';
import { capsuleLabel, warningLine } from '@/core/i18n/sk';

const D0 = '2026-10-05';

function listing(over: Partial<ListingInput> = {}): ListingInput {
  return { guestyId: 'L1', name: 'Test', beds: { KING_BED: 1, SOFA_BED: 1 }, accommodates: 4, bathrooms: 1, laundry: null, ...over };
}
function reservation(over: Partial<ReservationInput> = {}): ReservationInput {
  return { guestyId: 'R1', listingId: 'L1', checkInDate: '2026-10-01', checkOutDate: D0, guests: 2, ...over };
}
function pkg(over: Partial<PackageInput> = {}): PackageInput {
  return { date: D0, listing: listing(), outgoing: reservation(), next: null, calendar: {}, settings: DEFAULT_SETTINGS, ...over };
}
const sameDay = (guests: number) => reservation({ guestyId: 'R2', checkInDate: D0, guests });
const count = (r: PackingResult, key: string) => [...r.linen, ...r.consumables].find((l) => l.key === key)?.n ?? 0;

describe('D2 only the coffee keys are coffee lines', () => {
  it('"Kapsule do umývačky: 2" is an unknown line -> note, no coffee row', () => {
    const p = parseLaundry('Kapsule do umývačky: 2');
    expect(p.capsules).toBeNull();
    expect(p.notes).toEqual(['Kapsule do umývačky: 2']);
    const r = computePackage(pkg({ listing: listing({ laundry: p }) }));
    expect(r.capsules.map((c) => c.state)).toEqual(['missing']);
  });
  it('tolerated coffee spellings still work', () => {
    for (const key of ['Kapsula', 'Kapsuly', 'Kapsule do kávy', 'Kapsule do kávovaru']) {
      expect(parseLaundry(`${key}: Tchibo Cafissimo`).capsules, key).toEqual([{ type: 'Tchibo Cafissimo', n: null, mode: 'ok' }]);
    }
  });
});

describe('D3 a count without a type is the generic row with a fixed count', () => {
  it('"Kapsule: 10 ks" -> "Kapsule do kávy", 10, red note', () => {
    const r = computePackage(pkg({ listing: listing({ laundry: parseLaundry('Kapsule: 10 ks') }) }));
    expect(r.capsules).toHaveLength(1);
    expect(r.capsules[0]).toMatchObject({ state: 'missing', n: 10, fixed: true, type: '' });
    expect(capsuleLabel(r.capsules[0])).toEqual({ label: 'Kapsule do kávy', note: 'druh nezadaný v Guesty' });
  });
  it('"Kapsule: 10 ks, Tchibo Cafissimo" does not raise the multi-type warning', () => {
    const r = computePackage(pkg({ listing: listing({ laundry: parseLaundry('Kapsule: 10 ks, Tchibo Cafissimo') }) }));
    expect(r.warnings).not.toContain('capsules_multi');
    expect(r.capsules.map((c) => c.state)).toEqual(['missing', 'ok']);
  });
});

describe('D4 duvet type is a whole word', () => {
  it('"Paplóny: normálne" is not small duvets; the line becomes a note', () => {
    const p = parseLaundry('Paplóny: normálne');
    expect(p.duvetType).toBeNull();
    expect(p.notes).toEqual(['Paplóny: normálne']);
    const r = computePackage(pkg({ listing: listing({ laundry: p, beds: { KING_BED: 1 }, accommodates: 2 }) }));
    expect(count(r, 'paplonV')).toBe(1);
    expect(count(r, 'paplonM')).toBe(0);
    expect(r.warnings).toContain('no_duvet_info');
  });
  it('malé / veľké in any form still match', () => {
    expect(parseLaundry('Paplóny: 2 malé').duvetType).toBe('male');
    expect(parseLaundry('Paplóny: malý').duvetType).toBe('male');
    expect(parseLaundry('Paplóny: Veľké').duvetType).toBe('velke');
  });
});

describe('D7/D8 capsule count spellings and words starting with x', () => {
  it('"x10 Dolce Gusto" and "Nespresso x10"', () => {
    expect(parseCapsules('x10 Dolce Gusto')).toEqual([{ type: 'Dolce Gusto', n: 10, mode: 'ok' }]);
    expect(parseCapsules('Nespresso x10')).toEqual([{ type: 'Nespresso', n: 10, mode: 'ok' }]);
    expect(parseCapsules('10x Dolce Gusto')).toEqual([{ type: 'Dolce Gusto', n: 10, mode: 'ok' }]);
  });
  it("\"L'OR XL\", \"Xpresso\", \"Xtra Nespresso 10 ks\" keep their letters", () => {
    expect(parseCapsules("L'OR XL")[0].type).toBe("L'OR XL");
    expect(parseCapsules('Xpresso')[0].type).toBe('Xpresso');
    expect(parseCapsules('Xtra Nespresso 10 ks')).toEqual([{ type: 'Xtra Nespresso', n: 10, mode: 'ok' }]);
    expect(parseCapsules('Nespresso X')[0].type).toBe('Nespresso X');
  });
});

describe('D9 a dash inside the value is not "no capsules"', () => {
  it('"- Nespresso" is a type; "-" alone and "- nedávať" are none', () => {
    expect(parseCapsules('- Nespresso')).toEqual([{ type: 'Nespresso', n: null, mode: 'ok' }]);
    expect(parseCapsules('– Nespresso')).toEqual([{ type: 'Nespresso', n: null, mode: 'ok' }]);
    expect(parseCapsules('-')).toEqual([]);
    expect(parseCapsules('- nedávať')).toEqual([]);
  });
  it('"treba upresniť" is the unsure row', () => {
    expect(parseCapsules('treba upresniť')).toEqual([{ type: '', n: null, mode: 'unsure' }]);
  });
});

describe('D14 unrelated keys are notes, never silently dropped', () => {
  it('"Prádlo navyše: 2 plachty" and "Extra vankúše: 2" become notes', () => {
    expect(parseLaundry('Prádlo navyše: 2 plachty').notes).toEqual(['Prádlo navyše: 2 plachty']);
    expect(parseLaundry('Prádlo navyše: 2 plachty').private).toBe(false);
    expect(parseLaundry('Extra vankúše: 2').extras).toEqual([]);
    expect(parseLaundry('Extra vankúše: 2').notes).toEqual(['Extra vankúše: 2']);
  });
  it('"Prádlo: bavlnené" is a note, "Prádlo: súkromné" is private', () => {
    expect(parseLaundry('Prádlo: bavlnené').notes).toEqual(['Prádlo: bavlnené']);
    expect(parseLaundry('Prádlo: súkromné').private).toBe(true);
  });
});

describe('bed types outside the proposal table', () => {
  it('COUCH, FLOOR_MATTRESS and HAMMOCK are doubles for 2 with the unknown-type warning', () => {
    const p = planBeds({ KING_BED: 1, COUCH: 1, HAMMOCK: 1, FLOOR_MATTRESS: 1 }, 2);
    expect(p.plan.capacityRegular).toBe(8);
    expect(p.plan.sofasTotal).toBe(0);
    expect(p.warnings).toContain('unknown_bed_type');
  });
});

describe('warning text with the number of people the beds cover', () => {
  it('1 king + 1 sofa for 5 people -> "stačia len pre 4 osoby"', () => {
    const r = computePackage(pkg({ listing: listing({ accommodates: 5 }) }));
    expect(r.warnings).toContain('beds_insufficient');
    expect(warningLine('beds_insufficient', r)).toBe('Postele v Guesty stačia len pre 4 osoby – over na byte');
    const single = computePackage(pkg({ listing: listing({ beds: { SINGLE_BED: 1 }, accommodates: 2 }) }));
    expect(warningLine('beds_insufficient', single)).toBe('Postele v Guesty stačia len pre 1 osobu – over na byte');
    expect(warningLine('bunk', r)).toBe('Poschodová posteľ – over balenie');
  });
});

/* ------------------------------------------------------------------------ */
/* Checked and correct (regression pins)                                     */
/* ------------------------------------------------------------------------ */

describe('checked OK', () => {
  it('keys with spaces before the colon, "N ks" values, bullets', () => {
    expect(parseLaundry('Paplón veľký   : 2 ks').duvetCounts).toEqual({ large: 2, small: 0 });
    expect(parseCapsules('Tchibo Cafissimo 10 ks.')).toEqual([{ type: 'Tchibo Cafissimo', n: 10, mode: 'ok' }]);
    expect(parseLaundry('Kapsule:').capsules).toBeNull();
    expect(parseLaundry("Kapsule: Nespresso\r\nKapsule: L'OR").capsules).toHaveLength(2);
  });

  it('"Nespresso 3" = 3 fixed capsules (PROPOSAL §6: count = first integer, type = rest)', () => {
    expect(parseCapsules('Nespresso 3')).toEqual([{ type: 'Nespresso', n: 3, mode: 'ok' }]);
  });

  it('normalisation: undefined, backticks, uniqueStrings keeps order and drops only blanks/dupes', () => {
    expect(norm(undefined)).toBe('');
    expect(typeKey(undefined)).toBe('');
    expect(typeKey('L`OR')).toBe("l'or");
    expect(uniqueStrings(['b', 'a', 'b', '', ' a '])).toEqual(['b', 'a']);
    const w: WarningCode[] = ['bunk', 'no_beds', 'bunk', 'multi_stay'];
    expect(uniqueStrings(w)).toEqual(['bunk', 'no_beds', 'multi_stay']);
  });

  it('dates: DST nights, year boundary, negative diff, malformed strings throw', () => {
    expect(addDays('2026-10-25', 1)).toBe('2026-10-26');
    expect(addDays('2027-03-28', 1)).toBe('2027-03-29');
    expect(windowDates('2026-12-30')).toEqual(['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03', '2027-01-04', '2027-01-05']);
    expect(diffDays('2026-10-06', '2026-10-05')).toBe(-1);
    expect(diffDays('2026-12-31', '2027-01-01')).toBe(1);
    expect(() => ymdToDate('2026-10-5')).toThrow();
    expect(() => ymdToDate('2026-10-05T00:00:00.000Z')).toThrow();
  });

  it('gap boundary: 14 unknown nights = unknown, 15 = sellable (PROPOSAL Q6b)', () => {
    expect(evaluateGap(D0, '2026-10-19', {}).blocked).toBeNull();
    expect(evaluateGap(D0, '2026-10-20', {}).blocked).toBe(false);
    expect(evaluateGap(D0, '2026-10-06', { [D0]: { minNights: 0 } }).blocked).toBe(false);
    expect(evaluateGap(D0, '2026-10-06', { [D0]: { minNights: '2' as unknown as number } }).blocked).toBeNull();
  });

  it('numeric edge cases that are handled', () => {
    expect(planBeds({ KING_BED: -1, SINGLE_BED: 1.7, SOFA_BED: '2' as unknown as number }, 2).plan).toMatchObject({
      regular: [{ type: 'SINGLE_BED', qty: 1 }],
      sofasTotal: 2,
      sofasUsed: 1,
    });
    const nan = computePackage(pkg({ listing: listing({ accommodates: NaN }) }));
    expect([nan.people, nan.peopleSource]).toEqual([4, 'capacity_from_beds']);
    expect(nan.warnings).toContain('capacity_missing');
    const neg = computePackage(pkg({ listing: listing({ accommodates: -2 }) }));
    expect(neg.peopleSource).toBe('capacity_from_beds');
    const g = computePackage(pkg({ next: sameDay(-1) }));
    expect([g.people, g.peopleSource]).toEqual([4, 'capacity']);
    expect(g.warnings).toContain('guests_missing');
    for (const b of [0, -1, '' as unknown as number]) {
      expect(computePackage(pkg({ listing: listing({ bathrooms: b }) })).bathrooms).toBe(1);
    }
  });

  it('mergeSettings: beds and perApartment partials are merged, null falls back to defaults', () => {
    const m = mergeSettings({ beds: { dvoj: { vankus: 3 } } as never, perApartment: { spongia: 2 } });
    expect(m.beds.dvoj).toEqual({ paplonV: 1, vankus: 3, plachta: 1 });
    expect(m.perApartment).toEqual({ utierky: 1, spongia: 2, myckaKaps: 2, vreckoV: 1, vreckoM: 1 });
    expect(mergeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });
});
