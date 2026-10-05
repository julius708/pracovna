/**
 * Blackbox spec-compliance probes. Each assertion states what the SPEC
 * (Pracovna_Claude_Code_prompt.md §3–§5) or the accepted PROPOSAL (§6, §9, §10)
 * requires. A failing test = a candidate deviation to report.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  OWNER_CLEANS_IDS,
  capsulePhoto,
  computePackage,
  evaluateGap,
  formatHM,
  listingScope,
  parseCapsules,
  parseLaundry,
  planBeds,
} from '@/core/packing';
import type { ListingInput, PackageInput, PackingResult, ReservationInput } from '@/core/packing';
import {
  angelikaSentence,
  capsuleLabel,
  cheerDone,
  childrenBanner,
  packedBy,
  peopleSentence,
  plainText,
  sk,
  sofaText,
  warningLine,
  warningText,
} from '@/core/i18n/sk';

const D0 = '2026-10-05';
const D1 = '2026-10-06';
const D2 = '2026-10-07';
const D3 = '2026-10-08';

function listing(over: Partial<ListingInput> = {}): ListingInput {
  return { guestyId: 'L1', name: 'Skypark, Royal', beds: { KING_BED: 1, SOFA_BED: 1 }, accommodates: 4, bathrooms: 1, laundry: null, ...over };
}
function res(over: Partial<ReservationInput> = {}): ReservationInput {
  return { guestyId: 'R1', listingId: 'L1', checkInDate: '2026-10-01', checkOutDate: D0, guests: 2, ...over };
}
function pkg(over: Partial<PackageInput> = {}): PackageInput {
  return { date: D0, listing: listing(), outgoing: res(), next: null, calendar: {}, settings: DEFAULT_SETTINGS, ...over };
}
const n = (r: PackingResult, key: string) => [...r.linen, ...r.consumables].find((l) => l.key === key)?.n ?? 0;
const sameDay = (guests: number | null, extra: Partial<ReservationInput> = {}) => res({ guestyId: 'R2', checkInDate: D0, checkOutDate: D3, guests, ...extra });

/* ------------------------------------------------------------------ */
describe('§4 people – precedence and texts', () => {
  it('rule 1: same-day check-in packs for the incoming guests even above capacity', () => {
    const r = computePackage(pkg({ next: sameDay(5) }));
    expect(r.people).toBe(5);
    expect(r.sameDay).toBe(true);
  });

  it('rule 1 wins over rule 2: same-day check-in is never treated as a gap', () => {
    const r = computePackage(pkg({ next: sameDay(3), calendar: { [D0]: { minNights: 5 } } }));
    expect(r.peopleSource).toBe('same_day');
    expect(r.gap).toBeNull();
  });

  it('rule 2 definition: blocked only when EVERY arrival day has minNights > nights left', () => {
    // 3-night gap D0..D2, next check-in D3. nights left: D0=3, D1=2, D2=1
    const next = res({ guestyId: 'R2', checkInDate: D3, guests: 3 });
    const blocked = computePackage(pkg({ next, calendar: { [D0]: { minNights: 4 }, [D1]: { minNights: 3 }, [D2]: { minNights: 2 } } }));
    expect(blocked.gap?.blocked).toBe(true);
    expect(blocked.people).toBe(3);
    // D1 minNights 2 == nights left 2 -> a 2-night stay fits -> sellable
    const sellable = computePackage(pkg({ next, calendar: { [D0]: { minNights: 4 }, [D1]: { minNights: 2 }, [D2]: { minNights: 2 } } }));
    expect(sellable.gap?.blocked).toBe(false);
    expect(sellable.people).toBe(4);
    // last day D2 with minNights 1 fits a 1-night stay
    const lastDay = computePackage(pkg({ next, calendar: { [D0]: { minNights: 4 }, [D1]: { minNights: 3 }, [D2]: { minNights: 1 } } }));
    expect(lastDay.gap?.blocked).toBe(false);
  });

  it('rule 2 spec example text: 1 free night, min. stay 2', () => {
    const r = computePackage(pkg({ listing: listing({ accommodates: 6 }), next: res({ guestyId: 'R2', checkInDate: D1, guests: 4 }), calendar: { [D0]: { minNights: 2 } } }));
    expect(r.people).toBe(4);
    expect(peopleSentence(r)).toBe('Balíme na 4 osoby (ďalšia rezervácia – 1 voľná noc, min. pobyt 2 – nič iné sa nezmestí)');
  });

  it('rule 3: capacity with "ďalší hostia: N" as information only', () => {
    const r = computePackage(pkg({ next: res({ guestyId: 'R2', checkInDate: D1, guests: 2 }), calendar: { [D0]: { minNights: 1 } } }));
    expect(r.people).toBe(4);
    expect(peopleSentence(r)).toContain('(ďalší hostia: 2)');
  });

  it('badge text starts with "Rýchla výmena" (spec §4); the prototype long form is the accepted text', () => {
    expect(sk.rushTag.startsWith('Rýchla výmena')).toBe(true);
    expect(sk.rushTag).toBe('Rýchla výmena · príchod v ten istý deň');
  });

  it('Q6b: gap > 14 nights sellable without calendar; 14 nights still needs the calendar', () => {
    expect(evaluateGap(D0, '2026-10-20', {}).blocked).toBe(false);
    expect(evaluateGap(D0, '2026-10-19', {}).blocked).toBeNull();
  });

  it('data anomaly: a "next" reservation that checked in BEFORE the package date', () => {
    const r = computePackage(pkg({ next: res({ guestyId: 'R2', checkInDate: '2026-10-03', guests: 3 }) }));
    // spec has no rule; documenting behaviour: falls to capacity, no gap, no warning
    expect(r.peopleSource).toBe('capacity');
    expect(r.gap).toBeNull();
    expect(r.warnings).toEqual(expect.not.arrayContaining(['min_nights_unknown']));
  });
});

/* ------------------------------------------------------------------ */
describe('§4 beds', () => {
  it('KING/QUEEN/DOUBLE + unknown = double for 2; SINGLE = 1; BUNK = 2 singles + warning', () => {
    expect(planBeds({ KING_BED: 1, QUEEN_BED: 1, DOUBLE_BED: 1, WATER_BED: 1 }, 1).plan.capacityRegular).toBe(8);
    expect(planBeds({ SINGLE_BED: 3 }, 1).plan.capacityRegular).toBe(3);
    const b = planBeds({ BUNK_BED: 1 }, 2);
    expect(b.plan.capacityRegular).toBe(2);
    expect(b.plan.usedGroups).toEqual(['jedno', 'jedno']);
    expect(planBeds({ BUNK_BED: 1 }, 1).plan.usedGroups).toEqual(['jedno']);
    expect(b.warnings).toContain('bunk');
    expect(warningText.bunk).toBe('Poschodová posteľ – over balenie');
  });

  it('sofa only when regular beds cannot cover people, one by one', () => {
    const beds = { SINGLE_BED: 2, SOFA_BED: 2 };
    expect(planBeds(beds, 2).plan.sofasUsed).toBe(0);
    expect(planBeds(beds, 3).plan.sofasUsed).toBe(1);
    expect(planBeds(beds, 4).plan.sofasUsed).toBe(1);
    expect(planBeds(beds, 5).plan.sofasUsed).toBe(2);
    expect(sofaText(computePackage(pkg({ next: sameDay(3) })))).toBe('rozložiť gauč');
    expect(sofaText(computePackage(pkg({ next: sameDay(2) })))).toBe('gauč netreba');
  });

  it('PROPOSAL §6: only SOFA_BED/AIR_MATTRESS/FUTON are conditional; any other type = double + warning', () => {
    // COUCH is not in the proposal list -> spec "unknown types = double bed for 2"
    const couch = planBeds({ KING_BED: 1, COUCH: 1 }, 2);
    expect(couch.plan.capacityRegular).toBe(4);
    expect(couch.plan.sofasTotal).toBe(0);
    expect(couch.warnings).toContain('unknown_bed_type');
  });

  it('PROPOSAL §6: CRIB/TODDLER_BED ignored; HAMMOCK is not listed as ignored', () => {
    expect(planBeds({ KING_BED: 1, CRIB: 1, TODDLER_BED: 1 }, 2).plan.regular).toEqual([{ type: 'KING_BED', qty: 1 }]);
    const h = planBeds({ KING_BED: 1, HAMMOCK: 1 }, 2);
    expect(h.plan.capacityRegular).toBe(4);
    expect(h.warnings).toContain('unknown_bed_type');
  });
});

/* ------------------------------------------------------------------ */
describe('§4 linen table', () => {
  it('double bed and used sofa: 1 Paplón veľký, 2 Vankúš, 1 Plachta; single: 1 Paplón malý, 1 Vankúš, 1 Plachta (small sheets are never packed)', () => {
    const r = computePackage(pkg({ listing: listing({ beds: { DOUBLE_BED: 1, SINGLE_BED: 1, SOFA_BED: 1 }, accommodates: 5, laundry: parseLaundry('Paplóny: veľké') }), next: sameDay(5) }));
    expect(n(r, 'paplonV')).toBe(2);
    expect(n(r, 'paplonM')).toBe(1);
    expect(n(r, 'vankus')).toBe(5);
    expect(n(r, 'plachta')).toBe(3);
    expect(n(r, 'plachtaM')).toBe(0);
  });

  it('small duvets: 2 Paplón malý instead of 1 Paplón veľký per double/used sofa; single bed unchanged', () => {
    const r = computePackage(pkg({ listing: listing({ beds: { DOUBLE_BED: 1, SINGLE_BED: 1, SOFA_BED: 1 }, accommodates: 5, laundry: parseLaundry('Paplóny: malé') }), next: sameDay(5) }));
    expect(n(r, 'paplonV')).toBe(0);
    expect(n(r, 'paplonM')).toBe(5); // 2 + 2 + 1
  });

  it('per person: 1 Osuška veľká + 1 Uterák malý; per bathroom: 1 foot towel; bathrooms max(1, floor)', () => {
    const r = computePackage(pkg({ next: sameDay(3) }));
    expect(n(r, 'osuskaV')).toBe(3);
    expect(n(r, 'uterakM')).toBe(3);
    for (const [b, want] of [
      [1.5, 1],
      [2.5, 2],
      [0.5, 1],
      [0, 1],
      [3, 3],
    ] as const) {
      expect(n(computePackage(pkg({ listing: listing({ bathrooms: b }) })), 'predlozka'), `bathrooms ${b}`).toBe(want);
    }
  });

  it('exact duvet counts replace the calculation; missing line = 0; overrides replace items', () => {
    const r = computePackage(pkg({ listing: listing({ beds: { KING_BED: 1, SINGLE_BED: 2 }, laundry: parseLaundry('Paplón veľký: 3\nOsušky veľké: 7') }) }));
    expect(n(r, 'paplonV')).toBe(3);
    expect(n(r, 'paplonM')).toBe(0);
    expect(n(r, 'osuskaV')).toBe(7);
    expect(n(r, 'vankus')).toBe(6); // pillows follow the duvets: 2 per large (owner rule 2026-10-04)
  });

  it('no duvet info at all: large duvets + "Typ paplónov nezadaný – over na byte"', () => {
    const r = computePackage(pkg({ listing: listing({ beds: { KING_BED: 1 }, accommodates: 2 }) }));
    expect(n(r, 'paplonV')).toBe(1);
    expect(n(r, 'paplonM')).toBe(0);
    expect(r.warnings).toContain('no_duvet_info');
    expect(warningText.no_duvet_info).toBe('Typ paplónov nezadaný – over na byte');
  });

  it('PROPOSAL §6 precedence: exact > "Paplóny:" line > Settings > default', () => {
    expect(computePackage(pkg({ listing: listing({ laundry: parseLaundry('Paplón malý: 2\nPaplóny: veľké') }), duvetTypeSetting: 'velke' })).duvetSource).toBe('guesty_exact');
    expect(computePackage(pkg({ listing: listing({ laundry: parseLaundry('Paplóny: malé') }), duvetTypeSetting: 'velke' })).duvetSource).toBe('guesty_type');
    expect(computePackage(pkg({ duvetTypeSetting: 'male' })).duvetSource).toBe('setting');
    expect(computePackage(pkg()).duvetSource).toBe('default');
  });

  it('Q5 private linen: no linen rows at all, consumables + capsules still packed, banner text', () => {
    const r = computePackage(pkg({ listing: listing({ laundry: parseLaundry('Prádlo: súkromné\nKapsule: Tchibo Cafissimo') }) }));
    expect(r.private).toBe(true);
    expect(r.linen).toEqual([]);
    expect(r.consumables.map((l) => l.key)).toEqual(['toaletak', 'utierky', 'spongia', 'myckaKaps', 'vreckoV', 'vreckoM']);
    expect(r.capsules[0].n).toBe(4);
    expect(sk.privateBanner).toBe('Súkromné prádlo – nebaliť z našej bielizne');
  });
});

/* ------------------------------------------------------------------ */
describe('§4 consumables', () => {
  it('toilet paper max(2, people): 1->2, 2->2, 3->3, 6->6', () => {
    expect(n(computePackage(pkg({ next: sameDay(1) })), 'toaletak')).toBe(2);
    expect(n(computePackage(pkg({ next: sameDay(2) })), 'toaletak')).toBe(2);
    expect(n(computePackage(pkg({ next: sameDay(3) })), 'toaletak')).toBe(3);
    expect(n(computePackage(pkg({ next: sameDay(6) })), 'toaletak')).toBe(6);
  });

  it('fixed: utierky 1 rolka, špongia 1, kapsule do umývačky 2, vrecko veľké 1, vrecko malé 1', () => {
    const r = computePackage(pkg());
    expect(r.consumables.map((l) => [l.label, l.size, l.n])).toEqual([
      ['Toaletný papier', '', 4],
      ['Kuchynské utierky', 'rolka', 1],
      ['Špongia na riad', '', 1],
      ['Kapsule do umývačky', '', 2],
      ['Vrecko do koša veľké', '', 1],
      ['Vrecko do koša malé', '', 1],
    ]);
  });

  it('capsules: count = people unless "N ks"; missing type -> "druh nezadaný v Guesty"; upresniť -> "druh treba upresniť"; nedávať/žiadne -> no row', () => {
    const typed = computePackage(pkg({ listing: listing({ laundry: parseLaundry("Kapsule: L'OR Nespresso (veľké)") }) }));
    expect(typed.capsules).toMatchObject([{ type: "L'OR Tassimo", n: 4, fixed: false, photo: 'kapsula-lor-tassimo.png' }]); // every L'OR entry is shown as L'OR Tassimo (owner 2026-10-05)
    const fixed = computePackage(pkg({ listing: listing({ laundry: parseLaundry('Kapsule: Nespresso original (malé) 10 ks') }) }));
    expect(fixed.capsules).toMatchObject([{ type: 'Nespresso original (malé)', n: 10, fixed: true, photo: 'kapsula-nespresso-original.png' }]);
    const missing = computePackage(pkg());
    expect(capsuleLabel(missing.capsules[0])).toEqual({ label: 'Kapsule do kávy', note: 'druh nezadaný v Guesty' });
    const unsure = computePackage(pkg({ listing: listing({ laundry: parseLaundry('Kapsule: upresniť') }) }));
    expect(capsuleLabel(unsure.capsules[0])).toEqual({ label: 'Kapsule do kávy', note: 'druh treba upresniť' });
    expect(computePackage(pkg({ listing: listing({ laundry: parseLaundry('Kapsule: nedávať') }) })).capsules).toEqual([]);
    expect(computePackage(pkg({ listing: listing({ laundry: parseLaundry('Kapsule: žiadne') }) })).capsules).toEqual([]);
  });

  it('photo keys: cafissimo, l\'or, nespresso original', () => {
    expect(capsulePhoto('Tchibo Cafissimo')).toBe('kapsula-tchibo-cafissimo.png');
    expect(capsulePhoto("L'OR Nespresso (veľké)")).toBe('kapsula-lor-tassimo.png');
    expect(capsulePhoto('Nespresso original (malé)')).toBe('kapsula-nespresso-original.png');
  });

  it('PROPOSAL §6 capsule parsing: "x10 Dolce Gusto" keeps a clean type text', () => {
    expect(parseCapsules('x10 Dolce Gusto')).toEqual([{ type: 'Dolce Gusto', n: 10, mode: 'ok' }]);
  });
});

/* ------------------------------------------------------------------ */
describe('§4 children banner', () => {
  it('"👶 Prichádzajúci/Ďalší hostia majú deti: N · batoľatá: N"', () => {
    const same = computePackage(pkg({ next: sameDay(4, { children: 1, infants: 2 }) }));
    expect(childrenBanner(same)).toBe('👶 Prichádzajúci hostia majú deti: 1 · batoľatá: 2');
    const later = computePackage(pkg({ next: res({ guestyId: 'R2', checkInDate: D2, guests: 3, children: 2 }) }));
    expect(childrenBanner(later)).toBe('👶 Ďalší hostia majú deti: 2 · batoľatá: 0');
    expect(childrenBanner(computePackage(pkg({ next: sameDay(2, { children: 0, infants: 0 }) })))).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
describe('§3 scope', () => {
  const base = { guestyId: 'X', nickname: 'Byt', city: 'Bratislava', active: true };
  it('city contains Bratislava (diacritics-insensitive), KE:/TT: prefixes, owner-cleans phrases, 5 hard-coded ids', () => {
    expect(listingScope({ ...base, city: 'BRATISLAVÁ – Ružinov' }).inScope).toBe(true);
    expect(listingScope({ ...base, city: 'Trnava' }).inScope).toBe(false);
    expect(listingScope({ ...base, nickname: 'KE: Hlavná' }).inScope).toBe(false);
    expect(listingScope({ ...base, nickname: 'TT: Hlavná' }).inScope).toBe(false);
    for (const t of ['upratuje majiteľ', 'majitelia si upratujú sami', 'nezaradiť do práčovne', 'mimo práčovne']) {
      expect(listingScope({ ...base, laundryRaw: `Poznámka: ${t}` }).inScope, t).toBe(false);
    }
    expect([...OWNER_CLEANS_IDS].sort()).toEqual(
      ['6a86ff17bca9ae0013a0b530', '6895eb9d1addea001a2a70d5', '6a8813a766af800011acc0a5', '69f88075223f680010e4b4cb', '6a69e934295ae3003bea4bb4'].sort(),
    );
  });

  it('"Include only active listings": only an explicit false excludes (DB default is active = true)', () => {
    expect(listingScope({ ...base, active: false }).inScope).toBe(false);
    expect(listingScope({ ...base, active: null }).inScope).toBe(true);
    expect(listingScope({ ...base, active: undefined }).inScope).toBe(true);
  });

  it('owner-cleans is a whole-phrase match: listed phrases exclude, loose word co-occurrence does not', () => {
    expect(listingScope({ ...base, laundryRaw: 'Majiteľ si upratuje sám' }).inScope).toBe(false);
    expect(listingScope({ ...base, laundryRaw: 'Poznámka: majiteľ chce po upratovaní zavrieť okná' }).inScope).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
describe('§3 laundry-field parser – every key of the spec table, spelled as in the spec', () => {
  it('all keys', () => {
    const p = parseLaundry([
      'Paplón veľký: 2',
      'Paplón malý: 3',
      'Uteráky na nohy do kúpeľne: 2',
      'Osušky veľké: 5',
      'Uteráky malé: 6',
      'Prádlo: súkromné',
      "Kapsule: L'OR Nespresso (veľké) 10 ks",
      'Kávovar: DeLonghi',
      'Navyše: a, b',
      'Poznámka: kľúče v schránke',
      'Wifi: heslo123',
    ].join('\n'));
    expect(p.duvetCounts).toEqual({ large: 2, small: 3 });
    expect(p.overrides).toEqual({ predlozka: 2, osuskaV: 5, uterakM: 6 });
    expect(p.private).toBe(true);
    expect(p.capsules).toEqual([{ type: "L'OR Nespresso (veľké)", n: 10, mode: 'ok' }]);
    expect(p.coffee).toBe('DeLonghi');
    expect(p.extras).toEqual(['a', 'b']);
    expect(p.notes).toEqual(['kľúče v schránke', 'Wifi: heslo123']);
    expect(parseLaundry('Paplóny: malé').duvetType).toBe('male');
    expect(parseLaundry('Paplóny: veľké').duvetType).toBe('velke');
    expect(parseLaundry('PAPLON VELKY: 1').duvetCounts).toEqual({ large: 1, small: 0 });
  });

  it('"Paplóny: malé" is used only when exact counts are missing', () => {
    const p = parseLaundry('Paplóny: malé\nPaplón veľký: 2');
    const r = computePackage(pkg({ listing: listing({ laundry: p }) }));
    expect(r.duvetSource).toBe('guesty_exact');
    expect(n(r, 'paplonV')).toBe(2);
    expect(n(r, 'paplonM')).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
describe('§5 UI texts', () => {
  it('static strings', () => {
    expect(sk.angelikaRole).toBe('Angelika · vedúca práčovne');
    expect(sk.filters).toEqual({ todo: 'Na balenie', packed: 'Zabalené', all: 'Všetko' });
    expect(sk.pill).toEqual({ todo: 'Nezabalené', packed: 'Zabalené ✓', cancelled: 'Zrušené' });
    expect(sk.buttons.pack).toBe('Zabaliť');
    expect(sk.buttons.packed).toBe('Zabalené ✓');
    expect(sk.buttons.undo).toBe('Späť');
    expect(sk.buttons.note).toBe('Poznámka');
    expect(sk.consumablesTitle).toBe('Spotrebný tovar');
    expect(sk.today).toBe('Dnes');
    expect(sk.tomorrow).toBe('Zajtra');
    expect([...sk.cheers]).toEqual(['Super, ďakujem!', 'Výborne, ďalší hotový!', 'Paráda, len tak ďalej!', 'Skvelá práca!', 'Perfektné!']);
    expect(cheerDone('Skypark, Royal')).toBe('Skypark, Royal je zabalené.');
  });

  it('Angelika sentences', () => {
    expect(plainText(angelikaSentence({ dayWord: 'Dnes', hasData: true, total: 18, todo: 18, rush: 9, kids: 3 }))).toBe(
      'Dnes balíme 18 bytov z 18. Rýchle výmeny: 9, tie majú prednosť. Pri 3 bytoch prídu deti.',
    );
    expect(plainText(angelikaSentence({ dayWord: 'Dnes', hasData: true, total: 3, todo: 0, rush: 0, kids: 0 }))).toBe('Dnes je všetko zabalené. Výborná práca, ďakujem!');
  });

  it('footer "Zabalil(a) <meno> · 09:41" with Bratislava time', () => {
    expect(packedBy('Angelika', formatHM(new Date('2026-10-05T07:41:00Z')))).toBe('Zabalil(a) Angelika · 09:41');
    expect(packedBy('Angelika', formatHM(new Date('2026-12-05T08:41:00Z')))).toBe('Zabalil(a) Angelika · 09:41');
  });

  it('PROPOSAL §6/§9 warning wordings', () => {
    const r = computePackage(pkg({ listing: listing({ accommodates: 5 }) }));
    expect(warningLine('beds_insufficient', r)).toMatch(/^Postele v Guesty stačia len pre \d+ osoby – over na byte$/);
    expect(warningText.capsules_multi).toBe('viac druhov kapsúl – over počet');
    expect(warningText.guests_missing).toBe('Počet hostí nezadaný v Guesty – balíme na max. kapacitu');
  });
});
