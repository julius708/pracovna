import { describe, expect, it } from 'vitest';
import { parseCapsules, parseLaundry } from '@/core/packing';

describe('test 11: the laundry-field parser handles every key of the spec', () => {
  it('parses a full field', () => {
    const p = parseLaundry(`Paplón veľký: 2
Paplón malý: 1
Uteráky na nohy do kúpeľne: 2
Osušky veľké: 5
Uteráky malé: 5
Prádlo: súkromné
Kapsule: Nespresso original (malé)
Kávovar: Nespresso Essenza
Navyše: rozkladacia posteľ, detská postieľka
Poznámka: kľúče v schránke
Toto je neznámy riadok`);
    expect(p.duvetCounts).toEqual({ large: 2, small: 1 });
    expect(p.duvetType).toBeNull();
    expect(p.overrides).toEqual({ predlozka: 2, osuskaV: 5, uterakM: 5 });
    expect(p.private).toBe(true);
    expect(p.capsules).toEqual([{ type: 'Nespresso original (malé)', n: null, mode: 'ok' }]);
    expect(p.coffee).toBe('Nespresso Essenza');
    expect(p.extras).toEqual(['rozkladacia posteľ', 'detská postieľka']);
    expect(p.notes).toEqual(['kľúče v schránke', 'Toto je neznámy riadok']);
    expect(p.ownerCleans).toBe(false);
  });

  it('exact duvet counts: one line present -> the other is 0; no line -> null', () => {
    expect(parseLaundry('Paplón veľký: 3').duvetCounts).toEqual({ large: 3, small: 0 });
    expect(parseLaundry('Paplón malý: 4').duvetCounts).toEqual({ large: 0, small: 4 });
    expect(parseLaundry('Kávovar: x').duvetCounts).toBeNull();
    expect(parseLaundry('Paplóny veľké: 2\nPaplóny malé: 2').duvetCounts).toEqual({ large: 2, small: 2 });
  });

  it('duvet type lines: Paplóny: malé / veľké and Obliečky:', () => {
    expect(parseLaundry('Paplóny: malé').duvetType).toBe('male');
    expect(parseLaundry('Paplóny: veľké').duvetType).toBe('velke');
    expect(parseLaundry('Obliečky: MALÉ').duvetType).toBe('male');
    expect(parseLaundry('paplony: 2 velke').duvetType).toBe('velke');
  });

  it('keys are case- and diacritics-insensitive, bullets and extra spaces are tolerated', () => {
    const p = parseLaundry('- PAPLON VELKY :  3\n• osusky velke: 4\n*  kapsule : Tchibo Cafissimo 5 ks');
    expect(p.duvetCounts).toEqual({ large: 3, small: 0 });
    expect(p.overrides.osuskaV).toBe(4);
    expect(p.capsules).toEqual([{ type: 'Tchibo Cafissimo', n: 5, mode: 'ok' }]);
  });

  it('override values take the first integer only', () => {
    expect(parseLaundry('Osušky veľké: 2 (+1 rezerva)').overrides.osuskaV).toBe(2);
    expect(parseLaundry('Uteráky malé: dva').overrides.uterakM).toBeUndefined();
    expect(parseLaundry('Uteráky malé: dva').notes).toEqual(['Uteráky malé: dva']);
  });

  it('override aliases from the prototype are accepted', () => {
    expect(parseLaundry('Predložky: 2').overrides.predlozka).toBe(2);
    expect(parseLaundry('Uterák na nohy: 1').overrides.predlozka).toBe(1);
    expect(parseLaundry('Osušky: 3').overrides.osuskaV).toBe(3);
    expect(parseLaundry('Uteráky: 3').overrides.uterakM).toBe(3);
  });

  it('Prádlo: súkromné sets private; other values do not', () => {
    expect(parseLaundry('Prádlo: súkromné').private).toBe(true);
    expect(parseLaundry('Pradlo: SUKROMNE').private).toBe(true);
    expect(parseLaundry('Prádlo: naše').private).toBe(false);
    expect(parseLaundry('').private).toBe(false);
  });

  it('Kapsule: all four forms', () => {
    expect(parseLaundry('Kapsule: Tchibo Cafissimo').capsules).toEqual([{ type: 'Tchibo Cafissimo', n: null, mode: 'ok' }]);
    expect(parseLaundry("Kapsule: L'OR Nespresso (veľké) 10 ks").capsules).toEqual([{ type: "L'OR Nespresso (veľké)", n: 10, mode: 'ok' }]);
    expect(parseLaundry('Kapsule: nedávať').capsules).toEqual([]);
    expect(parseLaundry('Kapsule: žiadne').capsules).toEqual([]);
    expect(parseLaundry('Kapsule: upresniť').capsules).toEqual([{ type: '', n: null, mode: 'unsure' }]);
    expect(parseLaundry('Kávovar: x').capsules).toBeNull();
  });

  it('parseCapsules splits several types and strips counts in various spellings', () => {
    expect(parseCapsules('Nespresso original 4 ks; Tchibo Cafissimo 6x')).toEqual([
      { type: 'Nespresso original', n: 4, mode: 'ok' },
      { type: 'Tchibo Cafissimo', n: 6, mode: 'ok' },
    ]);
    expect(parseCapsules('10x Dolce Gusto')).toEqual([{ type: 'Dolce Gusto', n: 10, mode: 'ok' }]);
    expect(parseCapsules('Nespresso, nedávať')).toEqual([{ type: 'Nespresso', n: null, mode: 'ok' }]);
  });

  it('Navyše aliases (checklist, extra, pribaliť) are split and de-duplicated', () => {
    expect(parseLaundry('Navyše: a, b; a\nChecklist: c\nExtra: d\nPribaliť: e').extras).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('Poznámka and unknown lines become notes in order; empty field gives defaults', () => {
    expect(parseLaundry('farebné prádlo\nPoznámka: kód 1234').notes).toEqual(['farebné prádlo', 'kód 1234']);
    expect(parseLaundry(null)).toEqual({
      duvetCounts: null,
      duvetType: null,
      overrides: {},
      private: false,
      coffee: null,
      capsules: null,
      extras: [],
      notes: [],
      ownerCleans: false,
    });
  });

  it('owner-cleans phrases are detected anywhere in the text', () => {
    expect(parseLaundry('Poznámka: upratuje majiteľ').ownerCleans).toBe(true);
    expect(parseLaundry('Práčovňa: nie').ownerCleans).toBe(true);
    expect(parseLaundry('Poznámka: majiteľ chce po upratovaní zavrieť okná').ownerCleans).toBe(false);
  });
});
