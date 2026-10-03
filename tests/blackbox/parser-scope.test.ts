/**
 * Black-box tests for the laundry-field parser (parseLaundry, parseCapsules,
 * textSaysOwnerCleans) and the scope rules (listingScope, listingDisplayName).
 *
 * Every expectation is derived from the SPEC (section 3: "Which apartments",
 * "Listing data used", the table of laundry lines) and PROPOSAL.md
 * (section 5 scope paragraph; section 6 rows "Capsules", "Per-item overrides",
 * "Laundry field"; section 9 defaults). The implementation was not consulted
 * before the expectations were written.
 */
import { describe, expect, it } from 'vitest';
import {
  OWNER_CLEANS_IDS,
  listingDisplayName,
  listingScope,
  parseCapsules,
  parseLaundry,
  textSaysOwnerCleans,
  typeKey,
} from '@/core/packing';
import type { ParsedLaundry, ScopeInput } from '@/core/packing';
import { sk } from '@/core/i18n/sk';
import { laundry } from '../unit/packing/helpers';

/** In-scope Bratislava listing; override single fields to break one rule at a time. */
function scope(over: Partial<ScopeInput> = {}): ScopeInput {
  return {
    guestyId: 'L-blackbox',
    nickname: 'Šustekova Sky',
    city: 'Bratislava',
    active: true,
    tags: [],
    laundryRaw: null,
    ...over,
  };
}

/** What an empty field must look like (spec: no line = nothing known). */
const EMPTY: ParsedLaundry = {
  duvetCounts: null,
  duvetType: null,
  overrides: {},
  private: false,
  coffee: null,
  capsules: null,
  extras: [],
  notes: [],
  ownerCleans: false,
};

/* ------------------------------------------------------------------ */
/* Parser – structure of the field                                     */
/* ------------------------------------------------------------------ */

describe('parseLaundry – field structure', () => {
  it('empty, null and undefined text give the neutral result (capsules = null = "druh nezadaný")', () => {
    expect(parseLaundry('')).toEqual(EMPTY);
    expect(parseLaundry(null)).toEqual(EMPTY);
    expect(parseLaundry(undefined)).toEqual(EMPTY);
  });

  it('whitespace-only text and blank lines never become notes', () => {
    expect(parseLaundry('   \n\n  \t \n')).toEqual(EMPTY);
    const p = laundry('\n\nKávovar: DeLonghi\n\n   \nPoznámka: kľúče v schránke\n\n');
    expect(p.coffee).toBe('DeLonghi');
    expect(p.notes).toEqual(['kľúče v schránke']);
  });

  it('Windows line endings (\\r\\n) are treated like \\n and no \\r leaks into values', () => {
    const p = laundry('Kapsule: Tchibo Cafissimo\r\nKávovar: Cafissimo Pure\r\nNavyše: a; b\r\nPoznámka: x\r\n');
    expect(p.capsules).toEqual([{ type: 'Tchibo Cafissimo', n: null, mode: 'ok' }]);
    expect(p.coffee).toBe('Cafissimo Pure');
    expect(p.extras).toEqual(['a', 'b']);
    expect(p.notes).toEqual(['x']);
    for (const s of [p.coffee, ...p.extras, ...p.notes, ...(p.capsules ?? []).map((c) => c.type)]) {
      expect(s).not.toMatch(/\r/);
    }
  });

  it('keys are case- and diacritics-insensitive (UPPER CASE, no diacritics, mixed)', () => {
    const p = laundry(`PAPLÓN VEĽKÝ: 2
paplon maly: 1
UTERAKY NA NOHY DO KUPELNE: 3
Osusky velke: 4
uteráky MALÉ: 5
PRADLO: SUKROMNE
kapsule: Tchibo Cafissimo
KAVOVAR: Cafissimo
navyse: a, b
POZNAMKA: pozor`);
    expect(p.duvetCounts).toEqual({ large: 2, small: 1 });
    expect(p.overrides).toEqual({ predlozka: 3, osuskaV: 4, uterakM: 5 });
    expect(p.private).toBe(true);
    expect(p.capsules).toEqual([{ type: 'Tchibo Cafissimo', n: null, mode: 'ok' }]);
    expect(p.coffee).toBe('Cafissimo');
    expect(p.extras).toEqual(['a', 'b']);
    expect(p.notes).toEqual(['pozor']);
  });

  it('extra spaces around the colon and around the line are tolerated', () => {
    const p = laundry('   Kapsule   :   Tchibo Cafissimo   \n  Kávovar :Nespresso Essenza  \n Paplón veľký :  2  ');
    expect(p.capsules).toEqual([{ type: 'Tchibo Cafissimo', n: null, mode: 'ok' }]);
    expect(p.coffee).toBe('Nespresso Essenza');
    expect(p.duvetCounts).toEqual({ large: 2, small: 0 });
  });

  it('unknown lines become notes, kept whole and in order, mixed with Poznámka values', () => {
    const p = laundry('Plachta: 160×200\nPoznámka: kľúče u suseda\nToto je len text\nPoznámka: druhá');
    expect(p.notes).toEqual(['Plachta: 160×200', 'kľúče u suseda', 'Toto je len text', 'druhá']);
    // unknown lines never touch the typed fields
    expect(p.duvetCounts).toBeNull();
    expect(p.overrides).toEqual({});
    expect(p.capsules).toBeNull();
  });

  it('a "Key:" whose value is the wrong shape does not poison other lines', () => {
    const p = laundry('Paplón veľký: veľa\nKapsule: Tchibo Cafissimo');
    expect(p.capsules).toEqual([{ type: 'Tchibo Cafissimo', n: null, mode: 'ok' }]);
  });
});

/* ------------------------------------------------------------------ */
/* Parser – duvets                                                     */
/* ------------------------------------------------------------------ */

describe('parseLaundry – duvets', () => {
  it('"Paplón veľký: 2 ks" -> large 2, small 0 (missing line = 0); the unit suffix is ignored', () => {
    expect(laundry('Paplón veľký: 2 ks').duvetCounts).toEqual({ large: 2, small: 0 });
    expect(laundry('Paplón malý: 3 kusy').duvetCounts).toEqual({ large: 0, small: 3 });
  });

  it('"Paplóny: 2 veľké" is a type line: duvetType = velke', () => {
    expect(laundry('Paplóny: 2 veľké').duvetType).toBe('velke');
    expect(laundry('Paplóny: 2 malé').duvetType).toBe('male');
  });

  it('"Paplóny: 2 veľké" gives no exact count (exact counts come only from "Paplón veľký: N")', () => {
    expect(laundry('Paplóny: 2 veľké').duvetCounts).toBeNull();
  });

  it('an exact-count line wins over the same-field type line (both are reported)', () => {
    const p = laundry('Paplóny: malé\nPaplón veľký: 1');
    expect(p.duvetCounts).toEqual({ large: 1, small: 0 });
    expect(p.duvetType).toBe('male');
  });

  it('"Paplóny: MALÉ" / "paplony: velke" – case and diacritics do not matter', () => {
    expect(laundry('Paplóny: MALÉ').duvetType).toBe('male');
    expect(laundry('paplony: velke').duvetType).toBe('velke');
    expect(laundry('PAPLONY: Velke').duvetType).toBe('velke');
  });
});

/* ------------------------------------------------------------------ */
/* Parser – per-item overrides                                         */
/* ------------------------------------------------------------------ */

describe('parseLaundry – per-item overrides', () => {
  it('value = first integer: "2 (+1 rezerva)" -> 2, not 21 (proposal §6)', () => {
    const p = laundry('Osušky veľké: 2 (+1 rezerva)\nUteráky malé: 3 ks (1 v skrini)\nUteráky na nohy do kúpeľne: 1 + 1');
    expect(p.overrides).toEqual({ osuskaV: 2, uterakM: 3, predlozka: 1 });
  });

  it('sync.py aliases are accepted: Predložky / Osušky / Uteráky / Uteráky na nohy (proposal §6)', () => {
    const p = laundry('Predložky: 2\nOsušky: 4\nUteráky: 4');
    expect(p.overrides).toEqual({ predlozka: 2, osuskaV: 4, uterakM: 4 });
    expect(laundry('Uteráky na nohy: 3').overrides).toEqual({ predlozka: 3 });
  });

  it('an override line without a number sets nothing (no NaN, no 0)', () => {
    const p = laundry('Osušky veľké: podľa hostí');
    expect(p.overrides.osuskaV).toBeUndefined();
    expect(Object.values(p.overrides).every((n) => Number.isInteger(n))).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Parser – private linen                                              */
/* ------------------------------------------------------------------ */

describe('parseLaundry – Prádlo', () => {
  it('"Prádlo: Súkromné" / "Pradlo: sukromne" -> private, and the purple banner text exists', () => {
    expect(laundry('Prádlo: Súkromné').private).toBe(true);
    expect(laundry('Pradlo: sukromne').private).toBe(true);
    expect(laundry('PRÁDLO: SÚKROMNÉ PRÁDLO MAJITEĽA').private).toBe(true);
    expect(sk.privateBanner).toBe('Súkromné prádlo – nebaliť z našej bielizne');
  });

  it('"Prádlo: naše" is not private, and a private line that mentions majiteľ does not mean owner cleans', () => {
    expect(laundry('Prádlo: naše').private).toBe(false);
    const p = laundry('Prádlo: súkromné (majiteľ)');
    expect(p.private).toBe(true);
    expect(p.ownerCleans).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Parser – capsules                                                   */
/* ------------------------------------------------------------------ */

describe('parseLaundry / parseCapsules – Kapsule', () => {
  it('"Kapsule: L\'OR Nespresso (veľké) 10 ks" -> one type with a fixed count, type text kept as written', () => {
    expect(laundry("Kapsule: L'OR Nespresso (veľké) 10 ks").capsules).toEqual([
      { type: "L'OR Nespresso (veľké)", n: 10, mode: 'ok' },
    ]);
  });

  it('count suffix variants: "10ks", "10 KS"', () => {
    expect(parseCapsules('Tchibo Cafissimo 10ks')).toEqual([{ type: 'Tchibo Cafissimo', n: 10, mode: 'ok' }]);
    expect(parseCapsules('Tchibo Cafissimo 10 KS')).toEqual([{ type: 'Tchibo Cafissimo', n: 10, mode: 'ok' }]);
  });

  it.skip('"10 kusov" – spec_ambiguous: spec §3 defines only "N ks"; proposal §6 says "count = first integer, type = rest"', () => {
    // Reading A (spec, unit word spelled out): the unit belongs to the count -> type "Tchibo Cafissimo".
    // Reading B (proposal, literal "rest"): "kusov" is part of the rest -> type "Tchibo Cafissimo kusov".
    // The implementation follows B (only "ks"/"x"/"×" are stripped); the card would read "Kapsule Tchibo Cafissimo kusov".
    expect(parseCapsules('Tchibo Cafissimo 10 kusov')).toEqual([{ type: 'Tchibo Cafissimo', n: 10, mode: 'ok' }]);
  });

  it('"Kapsule: 10x Tchibo" -> count 10 (first integer), type "Tchibo"', () => {
    const [c] = parseCapsules('10x Tchibo');
    expect(c.n).toBe(10);
    expect(c.mode).toBe('ok');
    expect(typeKey(c.type)).toBe('tchibo');
  });

  it('"Kapsule: 10 ks Tchibo" -> count 10, type "Tchibo" (count = first integer, type = rest)', () => {
    const [c] = parseCapsules('10 ks Tchibo');
    expect(c.n).toBe(10);
    expect(typeKey(c.type)).toBe('tchibo');
  });

  it('multiple types split on ";" and ",", each with its own count', () => {
    expect(parseCapsules("Tchibo Cafissimo; L'OR Nespresso (veľké) 10 ks")).toEqual([
      { type: 'Tchibo Cafissimo', n: null, mode: 'ok' },
      { type: "L'OR Nespresso (veľké)", n: 10, mode: 'ok' },
    ]);
    expect(parseCapsules('Tchibo Cafissimo 4 ks, Nespresso original (malé) 6 ks')).toEqual([
      { type: 'Tchibo Cafissimo', n: 4, mode: 'ok' },
      { type: 'Nespresso original (malé)', n: 6, mode: 'ok' },
    ]);
    expect(parseCapsules('Tchibo Cafissimo , Nespresso original (malé) ; ')).toEqual([
      { type: 'Tchibo Cafissimo', n: null, mode: 'ok' },
      { type: 'Nespresso original (malé)', n: null, mode: 'ok' },
    ]);
  });

  it('"nedávať" / "žiadne" / "nie" / "bez" / "0" (any case, with or without diacritics) -> [] = no row', () => {
    for (const v of ['nedávať', 'nedavat', 'NEDÁVAŤ', 'žiadne', 'ziadne', 'Žiadne', 'nie', 'bez', '0', 'nedávať!']) {
      expect(parseCapsules(v), v).toEqual([]);
    }
    expect(laundry('Kapsule: nedávať').capsules).toEqual([]);
    expect(laundry('Kapsule: žiadne').capsules).toEqual([]);
  });

  it('"upresniť" (any case, with or without diacritics) -> one unsure entry with an empty type, and the red text exists', () => {
    for (const v of ['upresniť', 'upresnit', 'UPRESNIŤ', 'Upresniť!']) {
      const r = parseCapsules(v);
      expect(r, v).toHaveLength(1);
      expect(r[0].mode, v).toBe('unsure');
      expect(r[0].type, v).toBe('');
      expect(r[0].n, v).toBeNull();
    }
    expect(laundry('Kapsule: upresniť').capsules).toEqual([{ type: '', n: null, mode: 'unsure' }]);
    expect(sk.capsuleUnsure).toBe('druh treba upresniť');
    expect(sk.capsuleMissing).toBe('druh nezadaný v Guesty');
  });

  it('"Kapsule: treba upresniť" – any value containing "upresniť" is the unsure row (safer than a bogus type)', () => {
    expect(parseCapsules('treba upresniť')).toEqual([{ type: '', n: null, mode: 'unsure' }]);
  });

  it('no "Kapsule:" line at all -> capsules === null (row with "druh nezadaný v Guesty")', () => {
    expect(laundry('Kávovar: Nespresso').capsules).toBeNull();
    // the word "kapsule" inside a note value is not a "Kapsule:" line
    const p = laundry('Poznámka: kapsule sú v hornej skrinke');
    expect(p.capsules).toBeNull();
    expect(p.notes).toEqual(['kapsule sú v hornej skrinke']);
  });

  it('"Kapsule do umývačky: 2" is not the coffee-capsule key: unknown line -> note, capsules stay null', () => {
    // Spec §3: the coffee line is `Kapsule: <druh>`; "Kapsule do umývačky" is the spec's own name for the
    // dishwasher tablets (§4 consumables table, fixed at 2). Spec: "Unknown lines become a note on the card."
    const p = laundry('Kapsule do umývačky: 2');
    expect(p.notes).toEqual(['Kapsule do umývačky: 2']);
    expect(p.capsules).toBeNull();
  });

  it('bulleted lines ("- ", "• ", "* ") are parsed like plain lines', () => {
    const p = laundry('- Kapsule: Tchibo Cafissimo\n• Kávovar: Cafissimo Pure\n* Navyše: a, b');
    expect(p.capsules).toEqual([{ type: 'Tchibo Cafissimo', n: null, mode: 'ok' }]);
    expect(p.coffee).toBe('Cafissimo Pure');
    expect(p.extras).toEqual(['a', 'b']);
    expect(p.notes).toEqual([]);
  });

  it('a "Nespresso …" type is never mistaken for "nedávať"/"nie" (prefix "ne")', () => {
    expect(parseCapsules('Nespresso original (malé)')).toEqual([{ type: 'Nespresso original (malé)', n: null, mode: 'ok' }]);
    expect(parseCapsules('Nescafé Dolce Gusto')).toEqual([{ type: 'Nescafé Dolce Gusto', n: null, mode: 'ok' }]);
  });

  it('totals are per type after normalising case, diacritics and apostrophes (typeKey)', () => {
    const a = typeKey("L'OR Nespresso (veľké)");
    expect(typeKey('L’OR NESPRESSO (velke)')).toBe(a);
    expect(typeKey('l´or  nespresso (veľké)')).toBe(a);
    expect(typeKey('Tchibo Cafissimo')).not.toBe(a);
    // the type text itself stays as written (typographic apostrophe preserved)
    expect(parseCapsules('L’OR Nespresso (veľké)')[0].type).toBe('L’OR Nespresso (veľké)');
  });
});

/* ------------------------------------------------------------------ */
/* Parser – Kávovar, Navyše                                            */
/* ------------------------------------------------------------------ */

describe('parseLaundry – Kávovar and Navyše', () => {
  it('"Navyše: a; b" and "Navyše: a, b" both give two extras; trailing separators and blanks are dropped', () => {
    expect(laundry('Navyše: a; b').extras).toEqual(['a', 'b']);
    expect(laundry('Navyše: a, b').extras).toEqual(['a', 'b']);
    expect(laundry('Navyse: rozkladacia posteľ ; detská postieľka ;').extras).toEqual(['rozkladacia posteľ', 'detská postieľka']);
  });

  it('two "Navyše" lines accumulate (nothing from Guesty is silently dropped)', () => {
    expect(laundry('Navyše: a\nNavyše: b').extras).toEqual(['a', 'b']);
  });

  it('"Kávovar: …" is shown as written (trimmed); "Kavovar" without diacritics works too', () => {
    expect(laundry('Kávovar: Nespresso Essenza Mini ').coffee).toBe('Nespresso Essenza Mini');
    expect(laundry('kavovar: Tchibo Cafissimo Pure').coffee).toBe('Tchibo Cafissimo Pure');
  });
});

/* ------------------------------------------------------------------ */
/* Owner cleans – text                                                 */
/* ------------------------------------------------------------------ */

describe('textSaysOwnerCleans / ParsedLaundry.ownerCleans', () => {
  const fourPhrases = ['upratuje majiteľ', 'majitelia si upratujú sami', 'nezaradiť do práčovne', 'mimo práčovne'];

  it('each of the four spec phrases matches inside a longer sentence, in any case, with or without diacritics', () => {
    const sentences = [
      'Poznámka: tento byt upratuje majiteľ sám, prosím nebaliť.',
      'Od januára si majitelia si upratujú sami, kľúče sú u nich.',
      'Byt nezaradiť do práčovne (dohoda s majiteľom).',
      'Tento apartmán je mimo práčovne od 1.3.',
      'POZOR – UPRATUJE MAJITEĽ!',
      'poznamka: byt je mimo pracovne',
      'Nezaradit do pracovne',
      'MAJITELIA SI UPRATUJU SAMI',
      // Šustekova, Sky (owner 2026-10-03)
      'NEPATRÍ DO NAŠEJ PRÁČOVNE.\nKapsule: Tchibo Cafissimo',
      'Byt nepatrí do práčovne',
    ];
    for (const s of sentences) {
      expect(textSaysOwnerCleans(s), s).toBe(true);
      expect(laundry(s).ownerCleans, s).toBe(true);
    }
    for (const p of fourPhrases) expect(textSaysOwnerCleans(p), p).toBe(true);
  });

  it('a note that merely mentions majiteľ / práčovňa is NOT owner cleans', () => {
    const sentences = [
      'Poznámka: kľúče u majiteľa na 2. poschodí',
      'Majiteľ býva vedľa, nevolať po 22:00',
      'Poznámka: uteráky prať v práčovni na 60 °C',
      'Navyše: kontakt na majiteľa',
      'Kávovar: majiteľ má vlastný, nebaliť kapsule',
      'Práčovňa je v suteréne domu',
    ];
    for (const s of sentences) {
      expect(textSaysOwnerCleans(s), s).toBe(false);
      expect(laundry(s).ownerCleans, s).toBe(false);
    }
    expect(textSaysOwnerCleans(null)).toBe(false);
    expect(textSaysOwnerCleans(undefined)).toBe(false);
    expect(textSaysOwnerCleans('')).toBe(false);
  });

  it('owner-cleans text still parses the other lines (so the exclusion reason and the data stay consistent)', () => {
    const p = laundry('Kapsule: nedávať\nPoznámka: upratuje majiteľ');
    expect(p.ownerCleans).toBe(true);
    expect(p.capsules).toEqual([]);
    expect(p.notes).toEqual(['upratuje majiteľ']);
  });
});

/* ------------------------------------------------------------------ */
/* Scope                                                               */
/* ------------------------------------------------------------------ */

describe('listingScope – city', () => {
  it('city containing "Bratislava" in any spelling is in scope', () => {
    for (const city of ['Bratislava', 'bratislava', 'BRATISLAVA', 'Bratislava-Petržalka', 'Bratislava - Ružinov', 'Mestská časť Bratislava-Nové Mesto', 'Bratislava 5', ' Bratislava ']) {
      expect(listingScope(scope({ city })), city).toEqual({ inScope: true, reason: null });
    }
  });

  it('a city that does not contain "Bratislava" is excluded (Košice, Trnava, Petržalka alone, Hrubá Borša, empty, null)', () => {
    for (const city of ['Košice', 'Trnava', 'Petržalka', 'Hrubá Borša', '', '   ', null, undefined]) {
      const r = listingScope(scope({ city }));
      expect(r.inScope, String(city)).toBe(false);
      expect(r.reason, String(city)).toBe('city');
    }
  });
});

describe('listingScope – nickname prefix', () => {
  it('nicknames starting with KE: / TT: are excluded whatever the case or spacing', () => {
    for (const nickname of ['KE: Hlavná 1', 'ke:Hlavná 1', ' TT : Trhová 2', 'TT:Trhová', 'Ke: x', 'tT: y', '\tKE:z']) {
      const r = listingScope(scope({ nickname }));
      expect(r.inScope, nickname).toBe(false);
      expect(r.reason, nickname).toBe('prefix');
    }
  });

  it('look-alikes stay in scope: no colon, prefix not at the start, longer prefixes, other cities\' codes', () => {
    for (const nickname of ['Kežmarská 5', 'KE Hlavná', 'Byt KE: 5', 'TTT: x', 'Kemp: x', 'BA: Šustekova', 'TT', null, undefined, '']) {
      expect(listingScope(scope({ nickname })), String(nickname)).toEqual({ inScope: true, reason: null });
    }
  });
});

describe('listingScope – active', () => {
  it('inactive listings are excluded', () => {
    expect(listingScope(scope({ active: false }))).toEqual({ inScope: false, reason: 'inactive' });
  });

  it.skip('active unknown (null/undefined) – spec_ambiguous: "Include only active listings" vs. a missing flag', () => {
    // Reading A (strict): a listing not known to be active is not "active" -> exclude.
    // Reading B: only an explicit `active = false` (proposal §5 wording "active = true" is about Guesty's boolean).
    // The implementation follows B (null/undefined are included). Guesty always sends a boolean, so this
    // only matters for bad or partial data.
    expect(listingScope(scope({ active: null })).inScope).toBe(false);
    expect(listingScope(scope({ active: undefined })).inScope).toBe(false);
  });
});

describe('listingScope – owner cleans', () => {
  it('the five hard-coded ids are excluded even when everything else looks fine', () => {
    const ids = [
      '6a86ff17bca9ae0013a0b530', // Závodná Panoramic
      '6895eb9d1addea001a2a70d5', // Šoltésovej Bus
      '6a8813a766af800011acc0a5', // Hrobákova Family
      '69f88075223f680010e4b4cb', // Hrubá Borša
      '6a69e934295ae3003bea4bb4', // Kopčianka Haven
    ];
    expect([...OWNER_CLEANS_IDS].sort()).toEqual([...ids].sort());
    for (const guestyId of ids) {
      const r = listingScope(scope({ guestyId, laundryRaw: 'Kapsule: Tchibo Cafissimo\nPoznámka: všetko ok' }));
      expect(r.inScope, guestyId).toBe(false);
      expect(r.reason, guestyId).toBe('owner_id');
    }
  });

  it('an id that differs from a hard-coded one by case or a character is not matched', () => {
    expect(listingScope(scope({ guestyId: '6A86FF17BCA9AE0013A0B530' })).inScope).toBe(true);
    expect(listingScope(scope({ guestyId: '6a86ff17bca9ae0013a0b531' })).inScope).toBe(true);
  });

  it('owner-cleans text in the laundry field excludes the listing', () => {
    for (const laundryRaw of [
      'Poznámka: byt upratuje majiteľ',
      'Kapsule: Tchibo\nMajitelia si upratujú sami.',
      'nezaradit do pracovne',
      'Byt je MIMO PRÁČOVNE',
    ]) {
      const r = listingScope(scope({ laundryRaw }));
      expect(r.inScope, laundryRaw).toBe(false);
      expect(r.reason, laundryRaw).toBe('owner_text');
    }
  });

  it('a laundry field that merely mentions majiteľ keeps the listing in scope', () => {
    for (const laundryRaw of ['Poznámka: kľúče u majiteľa', 'Kávovar: majiteľ má vlastný', 'Prádlo: súkromné (majiteľ)']) {
      expect(listingScope(scope({ laundryRaw })), laundryRaw).toEqual({ inScope: true, reason: null });
    }
  });

  it('a Guesty tag "Upratuje majiteľ" (any case/diacritics) excludes; other tags do not', () => {
    expect(listingScope(scope({ tags: ['Upratuje majiteľ'] }))).toEqual({ inScope: false, reason: 'owner_tag' });
    expect(listingScope(scope({ tags: ['x', 'UPRATUJE MAJITEL'] }))).toEqual({ inScope: false, reason: 'owner_tag' });
    expect(listingScope(scope({ tags: ['majiteľ', 'VIP', 'práčovňa'] }))).toEqual({ inScope: true, reason: null });
    expect(listingScope(scope({ tags: null }))).toEqual({ inScope: true, reason: null });
  });

  it('a listing failing several rules is excluded (whichever reason is reported)', () => {
    const r = listingScope(scope({ city: 'Košice', nickname: 'KE: Hlavná', active: false, laundryRaw: 'upratuje majiteľ' }));
    expect(r.inScope).toBe(false);
    expect(r.reason).not.toBeNull();
  });
});

describe('listingDisplayName', () => {
  it('display name = nickname; title only as a fallback; trimmed', () => {
    expect(listingDisplayName('Šustekova Sky', 'Sunny flat near river')).toBe('Šustekova Sky');
    expect(listingDisplayName('  Šustekova Sky  ', 'title')).toBe('Šustekova Sky');
    expect(listingDisplayName(null, 'Sunny flat')).toBe('Sunny flat');
    expect(listingDisplayName('', 'Sunny flat')).toBe('Sunny flat');
    expect(listingDisplayName(undefined, undefined)).toBe('');
  });
});
