import { describe, expect, it } from 'vitest';
import {
  addDays,
  computePackage,
  diffDays,
  formatDM,
  hashOf,
  mergeSettings,
  packageHash,
  parseLaundry,
  stableStringify,
  todayInTz,
  weekdayShort,
  windowDates,
  DEFAULT_SETTINGS,
} from '@/core/packing';
import { angelikaSentence, childrenBanner, dayLabel, dayWord, nextArrival, packedBy, plainText, pluralByt, pluralNoci, pluralOsob, warningText } from '@/core/i18n/sk';
import { D0, pkg, reservation } from './helpers';

describe('Slovak texts', () => {
  it('plurals', () => {
    expect([1, 2, 4, 5, 18].map(pluralByt)).toEqual(['byt', 'byty', 'byty', 'bytov', 'bytov']);
    expect([1, 2, 5].map(pluralOsob)).toEqual(['osobu', 'osoby', 'osôb']);
    expect([1, 3, 5].map(pluralNoci)).toEqual(['voľná noc', 'voľné noci', 'voľných nocí']);
  });

  it("Angelika's sentence from the spec", () => {
    expect(plainText(angelikaSentence({ dayWord: 'Dnes', hasData: true, total: 18, todo: 18, rush: 9, kids: 3 }))).toBe(
      'Dnes balíme 18 bytov z 18. Rýchle výmeny: 9, tie majú prednosť. Pri 3 bytoch prídu deti.',
    );
    expect(plainText(angelikaSentence({ dayWord: 'Dnes', hasData: true, total: 18, todo: 0, rush: 0, kids: 0 }))).toBe('Dnes je všetko zabalené. Výborná práca, ďakujem!');
    expect(plainText(angelikaSentence({ dayWord: 'Zajtra', hasData: true, total: 1, todo: 1, rush: 0, kids: 1 }))).toBe('Zajtra balíme 1 byt z 1. Pri 1 byte prídu deti.');
    expect(plainText(angelikaSentence({ dayWord: 'Št', hasData: true, total: 0, todo: 0, rush: 0, kids: 0 }))).toBe('Št nie sú žiadne check-outy. Pokojný deň.');
    expect(plainText(angelikaSentence({ dayWord: 'Dnes', hasData: false, total: 0, todo: 0, rush: 0, kids: 0 }))).toBe('Dáta z Guesty sa ešte načítavajú.');
    const parts = angelikaSentence({ dayWord: 'Dnes', hasData: true, total: 5, todo: 2, rush: 1, kids: 0 });
    expect(parts.filter((p) => p.bold).map((p) => p.text)).toEqual(['2 byty', '1']);
  });

  it('children banner: both parts always, incoming vs next', () => {
    const same = computePackage(pkg({ next: reservation({ guestyId: 'R2', checkInDate: D0, guests: 4, children: 2, infants: 0 }) }));
    expect(childrenBanner(same)).toBe('👶 Prichádzajúci hostia majú deti: 2 · batoľatá: 0');
    const later = computePackage(pkg({ next: reservation({ guestyId: 'R2', checkInDate: '2026-10-07', guests: 3, children: 0, infants: 1 }) }));
    expect(childrenBanner(later)).toBe('👶 Ďalší hostia majú deti: 0 · batoľatá: 1');
    expect(childrenBanner(computePackage(pkg()))).toBeNull();
    expect(childrenBanner(computePackage(pkg({ next: reservation({ guestyId: 'R2', checkInDate: D0, guests: 2 }) })))).toBeNull();
  });

  it('badges and footer', () => {
    expect(nextArrival('2026-10-01')).toBe('Ďalší príchod št 1.10.');
    expect(dayLabel(0, '2026-10-01')).toBe('Dnes');
    expect(dayLabel(1, '2026-10-01')).toBe('Zajtra');
    expect(dayLabel(2, '2026-10-01')).toBe('št');
    expect(dayWord(2, '2026-10-01')).toBe('Št');
    expect(packedBy('Angelika', '09:41')).toBe('Zabalil(a) Angelika · 09:41');
    expect(packedBy(null, '09:41')).toBe('Zabalil(a) — · 09:41');
    expect(warningText.bunk).toBe('Poschodová posteľ – over balenie');
    expect(warningText.no_duvet_info).toBe('Typ paplónov nezadaný – over na byte');
  });
});

describe('dates in Europe/Bratislava', () => {
  it('window dates across the DST-end night (25.10.2026) have no duplicate day', () => {
    expect(windowDates('2026-10-24')).toEqual(['2026-10-24', '2026-10-25', '2026-10-26']);
    expect(windowDates('2027-03-27')).toEqual(['2027-03-27', '2027-03-28', '2027-03-29']);
  });
  it('today in Bratislava rolls over at local midnight, not UTC', () => {
    expect(todayInTz(new Date('2026-09-29T22:30:00Z'))).toBe('2026-09-30');
    expect(todayInTz(new Date('2026-09-29T21:30:00Z'))).toBe('2026-09-29');
    expect(todayInTz(new Date('2026-12-31T23:30:00Z'))).toBe('2027-01-01');
  });
  it('arithmetic and formatting', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(diffDays('2026-10-05', '2026-10-06')).toBe(1);
    expect(weekdayShort('2026-10-01')).toBe('št');
    expect(weekdayShort('2026-10-04')).toBe('ne');
    expect(formatDM('2026-10-01')).toBe('1.10.');
  });
});

describe('hash and settings', () => {
  it('stable stringify ignores key order; the hash changes with content', () => {
    expect(stableStringify({ b: 1, a: [{ d: 2, c: 3 }] })).toBe('{"a":[{"c":3,"d":2}],"b":1}');
    expect(hashOf({ a: 1, b: 2 })).toBe(hashOf({ b: 2, a: 1 }));
    expect(hashOf({ a: 1 })).not.toBe(hashOf({ a: 2 }));
    const r1 = computePackage(pkg());
    const r2 = computePackage(pkg());
    expect(packageHash(r1)).toBe(packageHash(r2));
    expect(packageHash(computePackage(pkg({ next: reservation({ guestyId: 'R2', checkInDate: D0, guests: 1 }) })))).not.toBe(packageHash(r1));
  });

  it('mergeSettings keeps saved values, appends new default items, fills missing sections', () => {
    const m = mergeSettings({ items: [{ key: 'paplonV', label: 'Veľký paplón' }], beds: { dvoj: { vankus: 3 } } as never, perApartment: { spongia: 2 } });
    expect(m.items[0]).toEqual({ key: 'paplonV', label: 'Veľký paplón' });
    expect(m.items.length).toBe(DEFAULT_SETTINGS.items.length);
    expect(m.beds.dvoj).toEqual({ paplonV: 1, vankus: 3, plachta: 1 });
    expect(m.beds.jedno).toEqual(DEFAULT_SETTINGS.beds.jedno);
    expect(m.perApartment).toEqual({ utierky: 1, spongia: 2, myckaKaps: 2, vreckoV: 1, vreckoM: 1 });
    expect(m.checklist).toEqual([]);
    expect(mergeSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it('the checklist merges the global list with Navyše items without duplicates', () => {
    const r = computePackage(
      pkg({
        settings: mergeSettings({ checklist: ['skontrolovať kľúče', 'zavrieť okná'] }),
        listing: { ...pkg().listing, laundry: parseLaundry('Navyše: zavrieť okná, detská postieľka') },
      }),
    );
    expect(r.checklist).toEqual(['skontrolovať kľúče', 'zavrieť okná', 'detská postieľka']);
  });
});
