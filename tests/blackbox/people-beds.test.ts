/**
 * Black-box tests: number of PEOPLE (computePeople / evaluateGap) and BEDS
 * (planBeds) through computePackage.
 *
 * Expectations come from SPEC §4 ("Number of people to pack for", "Beds") and
 * PROPOSAL §6 (rows "Bed types", "Edge cases", "Gap sentence"), §9 and
 * §10 Q4 (regular beds always fully made) and Q6 (blocked / closed-to-arrival
 * gap days are unsellable; gaps over 14 nights are sellable without lookup).
 */
import { describe, expect, it } from 'vitest';

import {
  addDays,
  bedCapacity,
  bedGroup,
  computePackage,
  computePeople,
  evaluateGap,
  planBeds,
} from '@/core/packing';
import type { CalendarDay, PackingResult } from '@/core/packing';
import { peopleSentence } from '@/core/i18n/sk';

import { D0, count, listing, pkg, reservation } from '../unit/packing/helpers';

/* ------------------------------------------------------------------ helpers */

const day = (n: number) => addDays(D0, n);

/** Next reservation checking in `nights` nights after D0. */
function nextIn(nights: number, guests: number | null = 3) {
  return reservation({
    guestyId: 'R2',
    checkInDate: day(nights),
    checkOutDate: day(nights + 3),
    guests,
  });
}

/** Calendar with the same minNights on every gap day D0 .. D0+nights-1. */
function calAll(nights: number, minNights: number | null): Record<string, CalendarDay> {
  const c: Record<string, CalendarDay> = {};
  for (let i = 0; i < nights; i++) c[day(i)] = { minNights };
  return c;
}

/** Calendar given as an array of per-day entries starting at D0 (undefined = day missing). */
function calDays(days: (CalendarDay | undefined)[]): Record<string, CalendarDay> {
  const c: Record<string, CalendarDay> = {};
  days.forEach((d, i) => {
    if (d) c[day(i)] = d;
  });
  return c;
}

function singlesIn(r: PackingResult | ReturnType<typeof planBeds>['plan']): number {
  const regular = 'beds' in r ? r.beds.regular : r.regular;
  return regular.filter((b) => bedGroup(b.type) === 'jedno').reduce((s, b) => s + b.qty, 0);
}

/* =============================================================== PEOPLE */

describe('people – same-day check-in (spec §4 rule 1)', () => {
  it('packs for the incoming guest count (3 guests in a 4-person flat)', () => {
    const r = computePackage(pkg({ next: nextIn(0, 3) }));
    expect(r.people).toBe(3);
    expect(r.sameDay).toBe(true);
    expect(r.peopleSource).toBe('same_day');
    expect(r.next?.guests).toBe(3);
    expect(peopleSentence(r).startsWith('Balíme na 3 osoby')).toBe(true);
  });

  it('packs for the incoming guest count even above capacity (6 guests in a 4-person flat)', () => {
    const r = computePackage(pkg({ next: nextIn(0, 6) }));
    expect(r.people).toBe(6);
    expect(r.sameDay).toBe(true);
    // KING (2) + one sofa (2) = 4 < 6
    expect(r.beds.sofasUsed).toBe(1);
    expect(r.warnings).toContain('beds_insufficient');
  });

  it('same-day check-in with 0 guests → capacity + "Počet hostí nezadaný" (proposal §6 edge cases)', () => {
    const r = computePackage(pkg({ next: nextIn(0, 0) }));
    expect(r.people).toBe(4);
    expect(r.warnings).toContain('guests_missing');
    expect(r.sameDay).toBe(true);
  });

  it('same-day check-in with null guests → capacity + guests_missing', () => {
    const r = computePackage(pkg({ next: nextIn(0, null) }));
    expect(r.people).toBe(4);
    expect(r.warnings).toContain('guests_missing');
    expect(r.sameDay).toBe(true);
  });

  it('1 incoming guest: towels/toilet paper follow people, one of the two kings is made (owner rule 2026-10-03)', () => {
    const r = computePackage(pkg({ listing: listing({ beds: { KING_BED: 2, SOFA_BED: 1 } }), next: nextIn(0, 1) }));
    expect(r.people).toBe(1);
    expect(count(r, 'osuskaV')).toBe(1);
    expect(count(r, 'uterakM')).toBe(1);
    expect(count(r, 'toaletak')).toBe(2);
    // one king gets a full set, the other stays unmade, the sofa is not used
    expect(count(r, 'paplonV')).toBe(1);
    expect(count(r, 'vankus')).toBe(2);
    expect(count(r, 'plachta')).toBe(1);
    expect(r.beds.usedGroups).toEqual(['dvoj']);
    expect(r.beds.sofasUsed).toBe(0);
  });
});

describe('people – no next reservation (spec §4 rule 3)', () => {
  it('packs for accommodates; next and gap are null', () => {
    const r = computePackage(pkg({ next: null }));
    expect(r.people).toBe(4);
    expect(r.peopleSource).toBe('capacity');
    expect(r.sameDay).toBe(false);
    expect(r.next).toBeNull();
    expect(r.gap).toBeNull();
    expect(peopleSentence(r)).toContain('4 osoby');
    expect(peopleSentence(r)).not.toContain('ďalší hostia');
  });

  it('accommodates null → bed capacity (incl. sofas) + capacity_missing', () => {
    const r = computePackage(pkg({ listing: listing({ accommodates: null }), next: null }));
    expect(r.people).toBe(4); // KING 2 + SOFA 2
    expect(r.warnings).toContain('capacity_missing');
    expect(r.peopleSource).toBe('capacity_from_beds');
  });

  it('accommodates 0 → bed capacity + capacity_missing', () => {
    const r = computePackage(
      pkg({ listing: listing({ accommodates: 0, beds: { SINGLE_BED: 2, SOFA_BED: 1 } }), next: null }),
    );
    expect(r.people).toBe(4); // 1 + 1 + sofa 2
    expect(r.warnings).toContain('capacity_missing');
    // packing for 4 with 2 singles → the sofa is needed
    expect(r.beds.sofasUsed).toBe(1);
  });

  it('accommodates null and no beds → one placeholder double (2 people) + both warnings', () => {
    const r = computePackage(pkg({ listing: listing({ accommodates: null, beds: {} }), next: null }));
    expect(r.people).toBe(2);
    expect(r.warnings).toContain('capacity_missing');
    expect(r.warnings).toContain('no_beds');
  });
});

describe('people – gap that cannot be sold (spec §4 rule 2)', () => {
  it('1 free night, min. stay 2 → next guests + the exact spec sentence', () => {
    const r = computePackage(pkg({ next: nextIn(1, 3), calendar: calAll(1, 2) }));
    expect(r.people).toBe(3);
    expect(r.peopleSource).toBe('gap');
    expect(r.sameDay).toBe(false);
    expect(r.gap).toEqual({ nights: 1, minNightsMax: 2, blocked: true, reason: 'min_nights' });
    expect(peopleSentence(r)).toBe('Balíme na 3 osoby (ďalšia rezervácia – 1 voľná noc, min. pobyt 2 – nič iné sa nezmestí)');
  });

  it('the literal spec sentence for N = 5 ("osôb")', () => {
    const r = computePackage(
      pkg({ listing: listing({ accommodates: 6, beds: { KING_BED: 2, SOFA_BED: 1 } }), next: nextIn(1, 5), calendar: calAll(1, 2) }),
    );
    expect(r.people).toBe(5);
    expect(peopleSentence(r)).toBe('Balíme na 5 osôb (ďalšia rezervácia – 1 voľná noc, min. pobyt 2 – nič iné sa nezmestí)');
  });

  it('1 guest → "1 osobu"', () => {
    const r = computePackage(pkg({ next: nextIn(1, 1), calendar: calAll(1, 2) }));
    expect(r.people).toBe(1);
    expect(peopleSentence(r)).toBe('Balíme na 1 osobu (ďalšia rezervácia – 1 voľná noc, min. pobyt 2 – nič iné sa nezmestí)');
  });

  it('1 free night, min. stay 1 → sellable → capacity, "ďalší hostia: 3" as information', () => {
    const r = computePackage(pkg({ next: nextIn(1, 3), calendar: calAll(1, 1) }));
    expect(r.people).toBe(4);
    expect(r.peopleSource).toBe('capacity');
    expect(r.gap?.blocked).toBe(false);
    expect(r.next?.guests).toBe(3);
    expect(r.warnings).not.toContain('min_nights_unknown');
    expect(peopleSentence(r)).toContain('ďalší hostia: 3');
  });

  it('1-night gap, day missing from the calendar → unknown → capacity + min_nights_unknown', () => {
    const r = computePackage(pkg({ next: nextIn(1, 3), calendar: {} }));
    expect(r.people).toBe(4);
    expect(r.gap?.blocked).toBeNull();
    expect(r.warnings).toContain('min_nights_unknown');
  });

  it('1-night gap, minNights null → unknown → capacity + min_nights_unknown', () => {
    const r = computePackage(pkg({ next: nextIn(1, 3), calendar: calAll(1, null) }));
    expect(r.people).toBe(4);
    expect(r.gap?.blocked).toBeNull();
    expect(r.warnings).toContain('min_nights_unknown');
  });

  it('2 free nights, min 3 then 2 → every arrival day impossible → blocked; sentence shows max minNights', () => {
    const r = computePackage(pkg({ next: nextIn(2, 2), calendar: calDays([{ minNights: 3 }, { minNights: 2 }]) }));
    expect(r.people).toBe(2);
    expect(r.gap).toEqual({ nights: 2, minNightsMax: 3, blocked: true, reason: 'min_nights' });
    expect(peopleSentence(r)).toBe('Balíme na 2 osoby (ďalšia rezervácia – 2 voľné noci, min. pobyt 3 – nič iné sa nezmestí)');
  });

  it('2 free nights, min 2 on both days → arrival on D0 fits exactly (equal, not greater) → sellable', () => {
    const r = computePackage(pkg({ next: nextIn(2, 2), calendar: calAll(2, 2) }));
    expect(r.people).toBe(4);
    expect(r.peopleSource).toBe('capacity');
    expect(r.gap?.blocked).toBe(false);
  });

  it('2 free nights, min 3 on D0 but min 1 on D1 → a 1-night stay fits on D1 → sellable', () => {
    const r = computePackage(pkg({ next: nextIn(2, 2), calendar: calDays([{ minNights: 3 }, { minNights: 1 }]) }));
    expect(r.people).toBe(4);
    expect(r.gap?.blocked).toBe(false);
  });

  it('3 free nights, min 4/3/2 (each one more than the nights left) → blocked, "3 voľné noci, min. pobyt 4"', () => {
    const r = computePackage(
      pkg({ next: nextIn(3, 2), calendar: calDays([{ minNights: 4 }, { minNights: 3 }, { minNights: 2 }]) }),
    );
    expect(r.people).toBe(2);
    expect(r.gap).toEqual({ nights: 3, minNightsMax: 4, blocked: true, reason: 'min_nights' });
    expect(peopleSentence(r)).toBe('Balíme na 2 osoby (ďalšia rezervácia – 3 voľné noci, min. pobyt 4 – nič iné sa nezmestí)');
  });

  it('3 free nights, one day unknown among blocked ones → unknown → capacity + warning', () => {
    const r = computePackage(pkg({ next: nextIn(3, 2), calendar: calDays([{ minNights: 5 }, undefined, { minNights: 3 }]) }));
    expect(r.people).toBe(4);
    expect(r.gap?.blocked).toBeNull();
    expect(r.warnings).toContain('min_nights_unknown');
  });

  it('3 free nights, one known-sellable day among blocked/unknown ones → sellable, no warning', () => {
    const r = computePackage(
      pkg({ next: nextIn(3, 2), calendar: calDays([{ minNights: null, available: false }, undefined, { minNights: 1 }]) }),
    );
    expect(r.people).toBe(4);
    expect(r.peopleSource).toBe('capacity');
    expect(r.gap?.blocked).toBe(false);
    expect(r.warnings).not.toContain('min_nights_unknown');
  });

  it('3 free nights: blocked day + closed-to-arrival day + min 7 → blocked (Q6a)', () => {
    const r = computePackage(
      pkg({
        next: nextIn(3, 2),
        calendar: calDays([{ minNights: 1, available: false }, { minNights: 1, cta: true }, { minNights: 7 }]),
      }),
    );
    expect(r.people).toBe(2);
    expect(r.peopleSource).toBe('gap');
    expect(r.gap?.blocked).toBe(true);
  });

  it('5 free nights, min 6 → "5 voľných nocí"', () => {
    const r = computePackage(
      pkg({ listing: listing({ accommodates: 6, beds: { KING_BED: 3 } }), next: nextIn(5, 5), calendar: calAll(5, 6) }),
    );
    expect(r.people).toBe(5);
    expect(peopleSentence(r)).toBe('Balíme na 5 osôb (ďalšia rezervácia – 5 voľných nocí, min. pobyt 6 – nič iné sa nezmestí)');
  });

  it('14-night gap (the lookup limit), min 15 everywhere → blocked, next guests', () => {
    const r = computePackage(pkg({ next: nextIn(14, 2), calendar: calAll(14, 15) }));
    expect(r.people).toBe(2);
    expect(r.peopleSource).toBe('gap');
    expect(r.gap).toEqual({ nights: 14, minNightsMax: 15, blocked: true, reason: 'min_nights' });
    expect(peopleSentence(r)).toBe('Balíme na 2 osoby (ďalšia rezervácia – 14 voľných nocí, min. pobyt 15 – nič iné sa nezmestí)');
  });

  it('14-night gap, min 14 everywhere → a 14-night stay fits on D0 → sellable', () => {
    const r = computePackage(pkg({ next: nextIn(14, 2), calendar: calAll(14, 14) }));
    expect(r.people).toBe(4);
    expect(r.gap?.blocked).toBe(false);
  });

  it('14-night gap with an empty calendar → still needs the lookup → unknown + warning', () => {
    const r = computePackage(pkg({ next: nextIn(14, 2), calendar: {} }));
    expect(r.people).toBe(4);
    expect(r.gap?.blocked).toBeNull();
    expect(r.warnings).toContain('min_nights_unknown');
  });

  it('15-night gap with an empty calendar → sellable without lookup (Q6b), no warning', () => {
    const r = computePackage(pkg({ next: nextIn(15, 2), calendar: {} }));
    expect(r.people).toBe(4);
    expect(r.peopleSource).toBe('capacity');
    expect(r.gap?.nights).toBe(15);
    expect(r.gap?.blocked).toBe(false);
    expect(r.warnings).not.toContain('min_nights_unknown');
  });

  it('15-night gap even with min 99 on every day → sellable (Q6b: no lookup over 14 nights)', () => {
    const r = computePackage(pkg({ next: nextIn(15, 2), calendar: calAll(15, 99) }));
    expect(r.people).toBe(4);
    expect(r.gap?.blocked).toBe(false);
  });

  it('1-night gap, day blocked in the calendar (no minNights) → unsellable, reason calendar_blocked (Q6a)', () => {
    const r = computePackage(pkg({ next: nextIn(1, 3), calendar: { [D0]: { minNights: null, available: false } } }));
    expect(r.people).toBe(3);
    expect(r.peopleSource).toBe('gap');
    expect(r.gap?.blocked).toBe(true);
    expect(r.gap?.reason).toBe('calendar_blocked');
  });

  it('1-night gap, closed to arrival with min 1 → unsellable (Q6a)', () => {
    const r = computePackage(pkg({ next: nextIn(1, 3), calendar: { [D0]: { minNights: 1, cta: true } } }));
    expect(r.people).toBe(3);
    expect(r.peopleSource).toBe('gap');
    expect(r.gap?.blocked).toBe(true);
  });

  it('1-night gap, min 1, available true, cta false → sellable', () => {
    const r = computePackage(pkg({ next: nextIn(1, 3), calendar: { [D0]: { minNights: 1, available: true, cta: false } } }));
    expect(r.people).toBe(4);
    expect(r.gap?.blocked).toBe(false);
  });

  it('blocked gap but next reservation has 0 guests → capacity + guests_missing (analogous to same-day edge case)', () => {
    const r = computePackage(pkg({ next: nextIn(1, 0), calendar: calAll(1, 2) }));
    expect(r.people).toBe(4);
    expect(r.warnings).toContain('guests_missing');
  });

  it('next check-in BEFORE the package date (data error) → not same-day, not a gap → capacity', () => {
    const r = computePackage(pkg({ next: nextIn(-1, 3) }));
    expect(r.sameDay).toBe(false);
    expect(r.peopleSource).not.toBe('gap');
    expect(r.people).toBe(4);
  });

  it('next check-in BEFORE the package date → no gap days exist, so no "min. pobyt neznámy" note', () => {
    const r = computePackage(pkg({ next: nextIn(-1, 3) }));
    expect(r.warnings).not.toContain('min_nights_unknown');
  });

  it('blocked gap packs for the next guest count even above capacity (6 in a 4-person flat)', () => {
    const r = computePackage(pkg({ next: nextIn(1, 6), calendar: calAll(1, 2) }));
    expect(r.people).toBe(6);
    expect(r.peopleSource).toBe('gap');
    expect(r.beds.sofasUsed).toBe(1);
    expect(r.warnings).toContain('beds_insufficient');
  });

  it('result.next carries the next reservation id, date and guests for the information badge', () => {
    const r = computePackage(pkg({ next: nextIn(2, 3), calendar: calAll(2, 1) }));
    expect(r.next).toMatchObject({ reservationId: 'R2', date: day(2), guests: 3, children: 0, infants: 0 });
  });
});

describe('evaluateGap / computePeople directly', () => {
  it('evaluateGap: 1 night, min 2 → blocked by min nights', () => {
    expect(evaluateGap(D0, day(1), { [D0]: { minNights: 2 } })).toEqual({
      nights: 1,
      minNightsMax: 2,
      blocked: true,
      reason: 'min_nights',
    });
  });

  it('evaluateGap: 3 nights, min 2 everywhere → a 2-night stay fits → sellable', () => {
    const g = evaluateGap(D0, day(3), calAll(3, 2));
    expect(g.nights).toBe(3);
    expect(g.blocked).toBe(false);
  });

  it('evaluateGap: minNightsMax is the max over the gap days', () => {
    const g = evaluateGap(D0, day(2), calDays([{ minNights: 5 }, { minNights: 2 }]));
    expect(g.blocked).toBe(true);
    expect(g.minNightsMax).toBe(5);
  });

  it('evaluateGap: next check-in on the package date → 0 nights, never "blocked"', () => {
    const g = evaluateGap(D0, D0, { [D0]: { minNights: 9 } });
    expect(g.nights).toBe(0);
    expect(g.blocked).not.toBe(true);
  });

  it('computePeople: gap blocked → next guests, source gap', () => {
    const p = computePeople({ date: D0, listing: listing(), next: nextIn(1, 2), calendar: calAll(1, 3) });
    expect(p).toMatchObject({ people: 2, source: 'gap', sameDay: false });
    expect(p.gap?.blocked).toBe(true);
  });

  it('computePeople: no next → capacity', () => {
    const p = computePeople({ date: D0, listing: listing({ accommodates: 5 }), next: null, calendar: {} });
    expect(p).toMatchObject({ people: 5, source: 'capacity', sameDay: false, gap: null });
  });
});

/* ================================================================= BEDS */

describe('beds – planBeds', () => {
  it('KING + SOFA for 2 people: sofa not needed', () => {
    const { plan, warnings } = planBeds({ KING_BED: 1, SOFA_BED: 1 }, 2);
    expect(plan).toMatchObject({ sofasTotal: 1, sofasUsed: 0, capacityRegular: 2, capacityAll: 4, bunk: false });
    expect(plan.usedGroups).toEqual(['dvoj']);
    expect(warnings).toEqual([]);
  });

  it('KING + SOFA for 3 people: sofa unfolded', () => {
    const { plan, warnings } = planBeds({ KING_BED: 1, SOFA_BED: 1 }, 3);
    expect(plan.sofasUsed).toBe(1);
    expect(plan.usedGroups).toEqual(['dvoj', 'gauc']);
    expect(warnings).toEqual([]);
  });

  it('two sofas are added one by one, only while needed', () => {
    const beds = { KING_BED: 1, SOFA_BED: 2 };
    expect(planBeds(beds, 2).plan.sofasUsed).toBe(0);
    expect(planBeds(beds, 3).plan.sofasUsed).toBe(1);
    expect(planBeds(beds, 4).plan.sofasUsed).toBe(1);
    expect(planBeds(beds, 5).plan.sofasUsed).toBe(2);
    expect(planBeds(beds, 6).plan.sofasUsed).toBe(2);
    expect(planBeds(beds, 6).warnings).not.toContain('beds_insufficient');
    const seven = planBeds(beds, 7);
    expect(seven.plan.sofasUsed).toBe(2);
    expect(seven.warnings).toContain('beds_insufficient');
  });

  it('FUTON behaves like a sofa (conditional, sleeps 2), not an unknown type', () => {
    const beds = { SINGLE_BED: 1, FUTON: 1 };
    const one = planBeds(beds, 1);
    expect(one.plan.sofasTotal).toBe(1);
    expect(one.plan.sofasUsed).toBe(0);
    expect(one.warnings).not.toContain('unknown_bed_type');
    const two = planBeds(beds, 2);
    expect(two.plan.sofasUsed).toBe(1);
    expect(two.plan.usedGroups).toEqual(['jedno', 'gauc']);
    expect(two.plan.capacityAll).toBe(3);
  });

  it('AIR_MATTRESS behaves like a sofa', () => {
    const beds = { KING_BED: 1, AIR_MATTRESS: 1 };
    expect(planBeds(beds, 2).plan.sofasUsed).toBe(0);
    const r = planBeds(beds, 3);
    expect(r.plan.sofasUsed).toBe(1);
    expect(r.plan.usedGroups).toEqual(['dvoj', 'gauc']);
    expect(r.warnings).toEqual([]);
  });

  it('BUNK_BED = 2 single beds + "Poschodová posteľ" warning', () => {
    const { plan, warnings } = planBeds({ BUNK_BED: 1 }, 2);
    expect(plan.bunk).toBe(true);
    expect(warnings).toContain('bunk');
    expect(plan.capacityRegular).toBe(2);
    expect(plan.usedGroups).toEqual(['jedno', 'jedno']);
    expect(singlesIn(plan)).toBe(2);
    expect(plan.regular.some((b) => bedGroup(b.type) === 'dvoj')).toBe(false);
  });

  it('two BUNK_BEDs = 4 singles', () => {
    const { plan } = planBeds({ BUNK_BED: 2 }, 4);
    expect(plan.capacityRegular).toBe(4);
    expect(singlesIn(plan)).toBe(4);
    expect(plan.usedGroups.filter((g) => g === 'jedno')).toHaveLength(4);
  });

  it('CRIB and TODDLER_BED are ignored', () => {
    const { plan, warnings } = planBeds({ KING_BED: 1, CRIB: 1, TODDLER_BED: 1 }, 2);
    expect(plan.capacityAll).toBe(2);
    expect(plan.regular.map((b) => b.type)).toEqual(['KING_BED']);
    expect(plan.usedGroups).toEqual(['dvoj']);
    expect(warnings).toEqual([]);
  });

  it('unknown bed type = double for 2 + "Neznámy typ postele" warning', () => {
    const { plan, warnings } = planBeds({ WATER_BED: 1 }, 2);
    expect(plan.capacityRegular).toBe(2);
    expect(plan.usedGroups).toEqual(['dvoj']);
    expect(warnings).toContain('unknown_bed_type');
    expect(warnings).not.toContain('no_beds');
  });

  it('no beds at all → one placeholder double + no_beds warning', () => {
    const { plan, warnings } = planBeds({}, 2);
    expect(warnings).toContain('no_beds');
    expect(plan.capacityRegular).toBe(2);
    expect(plan.usedGroups).toEqual(['dvoj']);
    expect(plan.sofasTotal).toBe(0);
  });

  it('quantity 0 is not a bed: KING 0 + SOFA 1 for 2 people uses the sofa', () => {
    const { plan, warnings } = planBeds({ KING_BED: 0, SOFA_BED: 1 }, 2);
    expect(plan.regular).toEqual([]);
    expect(plan.capacityRegular).toBe(0);
    expect(plan.sofasTotal).toBe(1);
    expect(plan.sofasUsed).toBe(1);
    expect(plan.usedGroups).toEqual(['gauc']);
    expect(warnings).not.toContain('no_beds');
    expect(warnings).not.toContain('beds_insufficient');
  });

  it('only zero quantities → treated as no beds (placeholder double + warning)', () => {
    const { plan, warnings } = planBeds({ KING_BED: 0, SOFA_BED: 0 }, 2);
    expect(warnings).toContain('no_beds');
    expect(plan.capacityRegular).toBe(2);
  });

  it('negative quantity is ignored, never reduces capacity', () => {
    const { plan } = planBeds({ KING_BED: -1, SINGLE_BED: 1 }, 1);
    expect(plan.capacityRegular).toBe(1);
    expect(plan.capacityAll).toBe(1);
    expect(plan.usedGroups).toEqual(['jedno']);
    expect(plan.regular.every((b) => b.qty > 0)).toBe(true);
  });

  it('capacity insufficient without any sofa → beds_insufficient', () => {
    const { plan, warnings } = planBeds({ SINGLE_BED: 1 }, 3);
    expect(plan.capacityAll).toBe(1);
    expect(warnings).toContain('beds_insufficient');
  });

  it('QUEEN and DOUBLE each sleep 2, SINGLE sleeps 1', () => {
    const { plan } = planBeds({ QUEEN_BED: 1, DOUBLE_BED: 1, SINGLE_BED: 3 }, 7);
    expect(plan.capacityRegular).toBe(7);
    expect(plan.usedGroups.filter((g) => g === 'dvoj')).toHaveLength(2);
    expect(plan.usedGroups.filter((g) => g === 'jedno')).toHaveLength(3);
  });

  it('bedCapacity counts every bed including all sofas, ignoring cribs', () => {
    expect(bedCapacity({ KING_BED: 1, SOFA_BED: 2, CRIB: 1 })).toBe(6);
    expect(bedCapacity({ BUNK_BED: 1, FUTON: 1 })).toBe(4);
  });
});

describe('beds through computePackage', () => {
  it('sofa used for 3 same-day guests: sofa linen added, towels per person', () => {
    const r = computePackage(pkg({ next: nextIn(0, 3) }));
    expect(r.beds.sofasUsed).toBe(1);
    expect(count(r, 'paplonV')).toBe(2);
    expect(count(r, 'vankus')).toBe(4);
    expect(count(r, 'plachta')).toBe(2);
    expect(count(r, 'osuskaV')).toBe(3);
    expect(count(r, 'uterakM')).toBe(3);
    expect(count(r, 'toaletak')).toBe(3);
  });

  it('BUNK_BED flat for 2: single-bed linen ×2 + bunk warning', () => {
    const r = computePackage(pkg({ listing: listing({ beds: { BUNK_BED: 1 }, accommodates: 2 }), next: nextIn(0, 2) }));
    expect(r.beds.bunk).toBe(true);
    expect(r.warnings).toContain('bunk');
    expect(count(r, 'paplonM')).toBe(2);
    expect(count(r, 'plachtaM')).toBe(2);
    expect(count(r, 'vankus')).toBe(2);
    expect(count(r, 'paplonV')).toBe(0);
  });

  it('BUNK_BED flat for 1 guest: one of the two bunk singles is made (owner rule 2026-10-03), towels for 1', () => {
    const r = computePackage(pkg({ listing: listing({ beds: { BUNK_BED: 1 }, accommodates: 2 }), next: nextIn(0, 1) }));
    expect(r.people).toBe(1);
    expect(r.beds.usedGroups).toEqual(['jedno']);
    expect(count(r, 'paplonM')).toBe(1);
    expect(count(r, 'plachtaM')).toBe(1);
    expect(count(r, 'osuskaV')).toBe(1);
    const two = computePackage(pkg({ listing: listing({ beds: { BUNK_BED: 1 }, accommodates: 2 }), next: nextIn(0, 2) }));
    expect(two.beds.usedGroups).toEqual(['jedno', 'jedno']);
    expect(count(two, 'paplonM')).toBe(2);
  });

  it('sofa-only flat for 2: the sofa is the bed', () => {
    const r = computePackage(pkg({ listing: listing({ beds: { SOFA_BED: 1 }, accommodates: 2 }), next: null }));
    expect(r.beds.sofasUsed).toBe(1);
    expect(r.warnings).not.toContain('no_beds');
    expect(count(r, 'paplonV')).toBe(1);
    expect(count(r, 'vankus')).toBe(2);
  });

  it('capacity 5 with KING + SOFA and no next → sofa used and beds_insufficient', () => {
    const r = computePackage(pkg({ listing: listing({ accommodates: 5 }), next: null }));
    expect(r.people).toBe(5);
    expect(r.beds.sofasUsed).toBe(1);
    expect(r.warnings).toContain('beds_insufficient');
  });
});
