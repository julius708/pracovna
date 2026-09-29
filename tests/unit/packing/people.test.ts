import { describe, expect, it } from 'vitest';
import { computePackage, evaluateGap } from '@/core/packing';
import { peopleSentence } from '@/core/i18n/sk';
import { D0, count, listing, pkg, reservation } from './helpers';

describe('people rule 1 – same-day check-in', () => {
  it('test 1: same-day check-in with 3 guests in a 4-person flat packs for 3', () => {
    const r = computePackage(pkg({ next: reservation({ guestyId: 'R2', checkInDate: D0, checkOutDate: '2026-10-08', guests: 3 }) }));
    expect(r.people).toBe(3);
    expect(r.sameDay).toBe(true);
    expect(r.peopleSource).toBe('same_day');
    expect(count(r, 'osuskaV')).toBe(3);
    expect(count(r, 'uterakM')).toBe(3);
    expect(count(r, 'toaletak')).toBe(3);
    expect(peopleSentence(r)).toBe('Balíme na 3 osoby (check-in v ten deň)');
  });

  it('same-day check-in with an unknown guest count falls back to capacity with a warning', () => {
    const r = computePackage(pkg({ next: reservation({ guestyId: 'R2', checkInDate: D0, guests: 0 }) }));
    expect(r.sameDay).toBe(true);
    expect(r.people).toBe(4);
    expect(r.peopleSource).toBe('capacity');
    expect(r.warnings).toContain('guests_missing');
  });
});

describe('people rule 3 – no check-in', () => {
  it('test 2: no check-in packs for max capacity', () => {
    const r = computePackage(pkg({ next: null }));
    expect(r.people).toBe(4);
    expect(r.peopleSource).toBe('capacity');
    expect(r.sameDay).toBe(false);
    expect(r.gap).toBeNull();
    expect(peopleSentence(r)).toBe('Balíme na max. kapacitu 4 osoby');
  });

  it('missing accommodates falls back to bed capacity incl. sofas with a warning', () => {
    const r = computePackage(pkg({ listing: listing({ accommodates: null, beds: { KING_BED: 1, SOFA_BED: 1 } }) }));
    expect(r.people).toBe(4);
    expect(r.peopleSource).toBe('capacity_from_beds');
    expect(r.warnings).toContain('capacity_missing');
  });
});

describe('people rule 2 – gap that cannot be sold', () => {
  const next = reservation({ guestyId: 'R2', checkInDate: '2026-10-06', checkOutDate: '2026-10-09', guests: 5 });

  it('test 3: a 1-night gap with min. stay 2 packs for the next reservation guests', () => {
    const r = computePackage(pkg({ listing: listing({ accommodates: 6, beds: { KING_BED: 2, SOFA_BED: 1 } }), next, calendar: { [D0]: { minNights: 2 } } }));
    expect(r.people).toBe(5);
    expect(r.peopleSource).toBe('gap');
    expect(r.sameDay).toBe(false);
    expect(r.gap).toEqual({ nights: 1, minNightsMax: 2, blocked: true, reason: 'min_nights' });
    expect(peopleSentence(r)).toBe('Balíme na 5 osôb (ďalšia rezervácia – 1 voľná noc, min. pobyt 2 – nič iné sa nezmestí)');
  });

  it('test 4: a 1-night gap with min. stay 1 packs for max capacity and shows the next guests as info', () => {
    const r = computePackage(pkg({ next: reservation({ guestyId: 'R2', checkInDate: '2026-10-06', guests: 2 }), calendar: { [D0]: { minNights: 1 } } }));
    expect(r.people).toBe(4);
    expect(r.peopleSource).toBe('capacity');
    expect(r.gap?.blocked).toBe(false);
    expect(peopleSentence(r)).toBe('Balíme na max. kapacitu 4 osoby (ďalší hostia: 2)');
  });

  it('a 2-night gap with min. stay 3 on both days is blocked; with min. stay 2 on the first day it is sellable', () => {
    const n = reservation({ guestyId: 'R2', checkInDate: '2026-10-07', guests: 3 });
    const blocked = computePackage(pkg({ next: n, calendar: { '2026-10-05': { minNights: 3 }, '2026-10-06': { minNights: 3 } } }));
    expect(blocked.gap?.blocked).toBe(true);
    expect(blocked.people).toBe(3);
    const sellable = computePackage(pkg({ next: n, calendar: { '2026-10-05': { minNights: 2 }, '2026-10-06': { minNights: 3 } } }));
    expect(sellable.gap?.blocked).toBe(false);
    expect(sellable.people).toBe(4);
  });

  it('an unknown calendar day makes the gap unknown -> capacity + warning', () => {
    const r = computePackage(pkg({ next, calendar: {} }));
    expect(r.gap?.blocked).toBeNull();
    expect(r.people).toBe(4);
    expect(r.warnings).toContain('min_nights_unknown');
  });

  it('a known sellable day wins over an unknown day', () => {
    const n = reservation({ guestyId: 'R2', checkInDate: '2026-10-07', guests: 3 });
    const r = computePackage(pkg({ next: n, calendar: { '2026-10-05': { minNights: 1 } } }));
    expect(r.gap?.blocked).toBe(false);
    expect(r.warnings).not.toContain('min_nights_unknown');
  });

  it('a calendar-blocked or closed-to-arrival day counts as unsellable (Q6a)', () => {
    const r = computePackage(pkg({ next, calendar: { [D0]: { minNights: 1, available: false } } }));
    expect(r.gap).toEqual({ nights: 1, minNightsMax: 1, blocked: true, reason: 'calendar_blocked' });
    expect(r.people).toBe(5);
    expect(peopleSentence(r)).toBe('Balíme na 5 osôb (ďalšia rezervácia – medzera je v kalendári blokovaná)');
    const cta = computePackage(pkg({ next, calendar: { [D0]: { minNights: 1, cta: true } } }));
    expect(cta.gap?.blocked).toBe(true);
  });

  it('gaps longer than 14 nights are sellable without a calendar lookup (Q6b)', () => {
    expect(evaluateGap(D0, '2026-10-20', {}).blocked).toBe(false);
    expect(evaluateGap(D0, '2026-10-19', {}).blocked).toBeNull();
  });

  it('the displayed min. stay is the maximum over the gap days', () => {
    const g = evaluateGap(D0, '2026-10-08', { '2026-10-05': { minNights: 4 }, '2026-10-06': { minNights: 5 }, '2026-10-07': { minNights: 4 } });
    expect(g).toEqual({ nights: 3, minNightsMax: 5, blocked: true, reason: 'min_nights' });
  });

  it('blocked gap with unknown next guest count falls back to capacity with a warning', () => {
    const r = computePackage(pkg({ next: reservation({ guestyId: 'R2', checkInDate: '2026-10-06', guests: null }), calendar: { [D0]: { minNights: 2 } } }));
    expect(r.gap?.blocked).toBe(true);
    expect(r.people).toBe(4);
    expect(r.warnings).toContain('guests_missing');
  });
});
