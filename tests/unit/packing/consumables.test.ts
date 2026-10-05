import { describe, expect, it } from 'vitest';
import { capsulePhoto, computePackage, mergeSettings } from '@/core/packing';
import { capsuleLabel } from '@/core/i18n/sk';
import { D0, count, laundry, listing, pkg, reservation } from './helpers';

const sameDay = (guests: number) => reservation({ guestyId: 'R2', checkInDate: D0, guests });

describe('test 8: toilet paper', () => {
  it('1 person = 2 rolls, 3 people = 3 rolls', () => {
    expect(count(computePackage(pkg({ next: sameDay(1) })), 'toaletak')).toBe(2);
    expect(count(computePackage(pkg({ next: sameDay(3) })), 'toaletak')).toBe(3);
    expect(count(computePackage(pkg({ next: sameDay(2) })), 'toaletak')).toBe(2);
  });

  it('the rule is fixed in code: a Settings value for toaletak is ignored', () => {
    const settings = mergeSettings({ perApartment: { toaletak: 9 } });
    expect(count(computePackage(pkg({ settings, next: sameDay(1) })), 'toaletak')).toBe(2);
  });
});

describe('fixed consumables', () => {
  it('kitchen towels 1, sponge 1, dishwasher capsules 2, big bag 1, small bag 1 – editable in Settings', () => {
    const r = computePackage(pkg());
    expect(count(r, 'utierky')).toBe(1);
    expect(count(r, 'spongia')).toBe(1);
    expect(count(r, 'myckaKaps')).toBe(2);
    expect(count(r, 'vreckoV')).toBe(1);
    expect(count(r, 'vreckoM')).toBe(1);
    const custom = computePackage(pkg({ settings: mergeSettings({ perApartment: { myckaKaps: 3 } }) }));
    expect(count(custom, 'myckaKaps')).toBe(3);
  });
});

describe('test 9: coffee capsules', () => {
  it('Kapsule: nedávať gives no capsule row; žiadne too', () => {
    expect(computePackage(pkg({ listing: listing({ laundry: laundry('Kapsule: nedávať') }) })).capsules).toEqual([]);
    expect(computePackage(pkg({ listing: listing({ laundry: laundry('Kapsule: žiadne') }) })).capsules).toEqual([]);
  });

  it('Kapsule: upresniť gives the warning row with count = people', () => {
    const r = computePackage(pkg({ listing: listing({ laundry: laundry('Kapsule: upresniť') }), next: sameDay(3) }));
    expect(r.capsules).toHaveLength(1);
    expect(r.capsules[0]).toMatchObject({ state: 'unsure', n: 3, fixed: false, photo: null });
    expect(capsuleLabel(r.capsules[0])).toEqual({ label: 'Kapsule do kávy', note: 'druh treba upresniť' });
  });

  it('no Kapsule line gives the red "druh nezadaný v Guesty" row with count = people', () => {
    const r = computePackage(pkg({ next: sameDay(2) }));
    expect(r.capsules[0]).toMatchObject({ state: 'missing', n: 2 });
    expect(capsuleLabel(r.capsules[0])).toEqual({ label: 'Kapsule do kávy', note: 'druh nezadaný v Guesty' });
  });

  it('a type gives count = people, a fixed "N ks" wins', () => {
    const a = computePackage(pkg({ listing: listing({ laundry: laundry('Kapsule: Tchibo Cafissimo') }), next: sameDay(3) }));
    expect(a.capsules[0]).toMatchObject({ type: 'Tchibo Cafissimo', n: 3, fixed: false, state: 'ok', photo: 'kapsula-tchibo-cafissimo.png' });
    expect(capsuleLabel(a.capsules[0])).toEqual({ label: 'Kapsule Tchibo Cafissimo', note: null });
    const b = computePackage(pkg({ listing: listing({ laundry: laundry('Kapsule: L’OR Nespresso (veľké) 10 ks') }), next: sameDay(3) }));
    expect(b.capsules[0]).toMatchObject({ type: "L'OR Tassimo", typeKey: "l'or tassimo", n: 10, fixed: true, photo: null }); // canonical name, no photo yet
  });

  it('several types without counts each get people and raise a warning', () => {
    const r = computePackage(pkg({ listing: listing({ laundry: laundry('Kapsule: Nespresso original (malé); Tchibo Cafissimo') }), next: sameDay(2) }));
    expect(r.capsules.map((c) => c.n)).toEqual([2, 2]);
    expect(r.warnings).toContain('capsules_multi');
    const withCounts = computePackage(pkg({ listing: listing({ laundry: laundry('Kapsule: Nespresso original 4 ks, Tchibo Cafissimo 6 ks') }) }));
    expect(withCounts.warnings).not.toContain('capsules_multi');
    expect(withCounts.capsules.map((c) => c.n)).toEqual([4, 6]);
  });

  it('photos match by substring of the normalised type, longest key first', () => {
    expect(capsulePhoto('Nespresso Original (malé)')).toBe('kapsula-nespresso-original.png');
    expect(capsulePhoto("L'OR Nespresso (veľké)")).toBeNull(); // L'OR Tassimo: no photo yet
    expect(capsulePhoto('L’OR')).toBeNull();
    expect(capsulePhoto('TCHIBO CAFISSIMO')).toBe('kapsula-tchibo-cafissimo.png');
    expect(capsulePhoto('Dolce Gusto')).toBeNull();
    expect(capsulePhoto('')).toBeNull();
  });

  it('typeKey unifies case, diacritics and apostrophes so totals group per type', () => {
    const r = computePackage(pkg({ listing: listing({ laundry: laundry('Kapsule: NESPRESSO Originál 2 ks; nespresso original 3 ks') }) }));
    expect(new Set(r.capsules.map((c) => c.typeKey)).size).toBe(1);
  });
});
