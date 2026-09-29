/** Extra edge probes; see spec-review.test.ts for the rule-by-rule suite. */
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, computePackage, evaluateGap, norm, parseCapsules, parseLaundry } from '@/core/packing';
import type { ListingInput, PackageInput, ReservationInput } from '@/core/packing';
import { peopleSentence } from '@/core/i18n/sk';

const D0 = '2026-10-05';
const D1 = '2026-10-06';
const D2 = '2026-10-07';
function listing(over: Partial<ListingInput> = {}): ListingInput {
  return { guestyId: 'L1', name: 'Byt', beds: { KING_BED: 1, SOFA_BED: 1 }, accommodates: 4, bathrooms: 1, laundry: null, ...over };
}
function res(over: Partial<ReservationInput> = {}): ReservationInput {
  return { guestyId: 'R1', listingId: 'L1', checkInDate: '2026-10-01', checkOutDate: D0, guests: 2, ...over };
}
function pkg(over: Partial<PackageInput> = {}): PackageInput {
  return { date: D0, listing: listing(), outgoing: res(), next: null, calendar: {}, settings: DEFAULT_SETTINGS, ...over };
}

describe('edge probes', () => {
  it('norm strips every Slovak diacritic', () => {
    expect(norm('áäčďéíĺľňóôŕšťúýž ÁÄČĎÉÍĹĽŇÓÔŔŠŤÚÝŽ')).toBe('aacdeillnoorstuyz aacdeillnoorstuyz');
  });

  it('capsule type starting with x/X keeps its first letter', () => {
    expect(parseCapsules('Xtra Nespresso')).toEqual([{ type: 'Xtra Nespresso', n: null, mode: 'ok' }]);
    expect(parseCapsules('10 ks Tchibo Cafissimo')).toEqual([{ type: 'Tchibo Cafissimo', n: 10, mode: 'ok' }]);
  });

  it('"Kapsule: 0" and "Kapsule: 0 ks" give no row', () => {
    expect(computePackage(pkg({ listing: listing({ laundry: parseLaundry('Kapsule: 0') }) })).capsules).toEqual([]);
    expect(computePackage(pkg({ listing: listing({ laundry: parseLaundry('Kapsule: 0 ks') }) })).capsules).toEqual([]);
  });

  it('"Kapsule: Nespresso original, upresniť" -> one unsure row + one typed row', () => {
    const r = computePackage(pkg({ listing: listing({ laundry: parseLaundry('Kapsule: Nespresso original, upresniť') }) }));
    expect(r.capsules.map((c) => c.state)).toEqual(['unsure', 'ok']);
  });

  it('"Paplón veľký: 0" -> exact counts {0,0}: no duvet rows, no warning', () => {
    const r = computePackage(pkg({ listing: listing({ laundry: parseLaundry('Paplón veľký: 0') }) }));
    expect(r.linen.map((l) => l.key)).not.toContain('paplonV');
    expect(r.linen.map((l) => l.key)).not.toContain('paplonM');
    expect(r.warnings).not.toContain('no_duvet_info');
    expect(r.duvetSource).toBe('guesty_exact');
  });

  it('same-day check-in with unknown guests: rush badge still, capacity + warning', () => {
    const r = computePackage(pkg({ next: res({ guestyId: 'R2', checkInDate: D0, guests: null }) }));
    expect(r.sameDay).toBe(true);
    expect(r.people).toBe(4);
    expect(r.warnings).toContain('guests_missing');
    expect(peopleSentence(r)).toBe('Balíme na max. kapacitu 4 osoby');
  });

  it('gap reason when one day is min-nights blocked and another calendar-only blocked', () => {
    const g = evaluateGap(D0, D2, { [D0]: { minNights: 3 }, [D1]: { minNights: 1, available: false } });
    expect(g.blocked).toBe(true);
    // documenting: which sentence is shown
    const r = computePackage(pkg({ next: res({ guestyId: 'R2', checkInDate: D2, guests: 3 }), calendar: { [D0]: { minNights: 3 }, [D1]: { minNights: 1, available: false } } }));
    expect(peopleSentence(r)).toBe('Balíme na 3 osoby (ďalšia rezervácia – medzera je v kalendári blokovaná)');
  });

  it('unknown gap day + a known blocked day -> unknown (capacity + warning)', () => {
    const r = computePackage(pkg({ next: res({ guestyId: 'R2', checkInDate: D2, guests: 3 }), calendar: { [D0]: { minNights: 3 } } }));
    expect(r.gap?.blocked).toBeNull();
    expect(r.people).toBe(4);
    expect(r.warnings).toContain('min_nights_unknown');
  });

  it('override value "2 ks" and "2 (+1 rezerva)" -> 2', () => {
    expect(parseLaundry('Uteráky na nohy do kúpeľne: 2 ks').overrides.predlozka).toBe(2);
    expect(parseLaundry('Osušky veľké: 2 (+1 rezerva)').overrides.osuskaV).toBe(2);
  });
});
