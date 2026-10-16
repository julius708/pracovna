import { describe, expect, it } from 'vitest';
import { BED_140, bagCount, computePackage, DEFAULT_ITEMS, FLAT_FACTS, flatAlias, flatFacts, mergeSettings, toiletPaperCount } from '@/core/packing';
import { bedSummary, duvetText, warningLine } from '@/core/i18n/sk';
import { D0, count, laundry, listing, pkg, reservation } from './helpers';

const sameDay = (guests: number) => reservation({ guestyId: 'R2', checkInDate: D0, guests });

/** Guesty ids of the flats the owner described on 2026-10-10 (src/core/packing/flats.ts). */
const MOYZESOVA = '694aa0c5b0f9ec001691d05d';
const SKALICKA = '688b6dfc3abd4d0010ae4542';
const TOMASIKOVA = '68b84c169c4f710012f3984f';
const VAJNORSKA = '685925a3458130001380e80a';

const moyzesova = (people: number) =>
  computePackage(
    pkg({
      listing: listing({ guestyId: MOYZESOVA, beds: { KING_BED: 1, QUEEN_BED: 2, SINGLE_BED: 1 }, accommodates: 7, bathrooms: 2, laundry: laundry('Paplón veľký: 4\nPaplón malý: 0\nKapsule: Tchibo Cafissimo') }),
      next: sameDay(people),
    }),
  );
const skalicka = (people: number) =>
  computePackage(
    pkg({
      listing: listing({ guestyId: SKALICKA, beds: { KING_BED: 1, SOFA_BED: 1, SINGLE_BED: 2 }, accommodates: 6, laundry: laundry('Paplón veľký: 0\nPaplón malý: 6\nKapsule: Tchibo Cafissimo') }),
      next: sameDay(people),
    }),
  );
const tomasikova = (people: number) =>
  computePackage(
    pkg({
      listing: listing({ guestyId: TOMASIKOVA, beds: { KING_BED: 1, SOFA_BED: 1, SINGLE_BED: 2 }, accommodates: 5, laundry: laundry('Paplón veľký: 0\nPaplón malý: 6\nKapsule: Nespresso original (malé)') }),
      next: sameDay(people),
    }),
  );
const vajnorska = (people: number) =>
  computePackage(
    pkg({
      listing: listing({ guestyId: VAJNORSKA, beds: { KING_BED: 1 }, accommodates: 3, laundry: laundry('Paplón veľký: 1\nPaplón malý: 0\nKapsule: nedávať') }),
      next: sameDay(people),
    }),
  );

describe("Angelika's names for the flats (owner, 2026-10-10)", () => {
  it('the five flats carry their alias; others none', () => {
    expect(flatAlias('69e7584bd6397b001423638a')).toBe('č. bytu 606'); // Poštová, Heart
    expect(flatAlias('69a7f976a4c8180015e47e98')).toBe('č. bytu 310'); // Poštová, Shopping
    expect(flatAlias('68592546458130001380dfc6')).toBe('Eurovea'); // Pribinová, Luxury
    expect(flatAlias('68d3da344f45f70012accb1a')).toBe('byt 190'); // Skypark, Luxury I
    expect(flatAlias('68ecfcd30c0b51002237bdda')).toBe('byt 187'); // Skypark, Modern
    expect(flatAlias('L1')).toBeNull();
    expect(flatAlias(null)).toBeNull();
    expect(flatFacts('L1')).toBeNull();
  });

  it('an alias alone changes nothing in the counts', () => {
    const plain = computePackage(pkg({ next: sameDay(2) }));
    const heart = computePackage(pkg({ listing: listing({ guestyId: '69e7584bd6397b001423638a' }), next: sameDay(2) }));
    expect(heart.linen).toEqual(plain.linen);
    expect(heart.consumables).toEqual(plain.consumables);
    expect(heart.warnings).toEqual(plain.warnings);
  });
});

describe('Moyzesova: 1 small bed, 3 large double beds, a sofa that does not unfold', () => {
  it('a full flat (7) gets 3 large + 2 small duvets "podľa Angeliky", pillows per duvet', () => {
    const r = moyzesova(7);
    expect(r.beds.usedGroups).toEqual(['dvoj', 'dvoj', 'dvoj', 'jedno']);
    expect([count(r, 'paplonV'), count(r, 'paplonM')]).toEqual([3, 2]);
    expect(count(r, 'vankus')).toBe(3 * 2 + 2 * 1);
    expect(r.duvetSource).toBe('facts');
    expect(duvetText(r)).toBe('podľa Angeliky');
    expect(r.warnings).not.toContain('duvets_exceed_capacity');
    expect(r.warnings).not.toContain('duvets_short');
    // the flat's note goes on the card
    expect(FLAT_FACTS[MOYZESOVA].note).toContain('gauč sa nedá rozložiť');
  });

  it('8 guests on the reservation are still the full set, and the card asks no bed question (the 8th sleeps on the sofa)', () => {
    const r = moyzesova(8);
    expect([count(r, 'paplonV'), count(r, 'paplonM'), count(r, 'vankus')]).toEqual([3, 2, 8]);
    expect(r.warnings).not.toContain('beds_insufficient');
  });

  it('3 guests: the three double beds (one bed per guest), one large duvet each, the single bed stays unmade', () => {
    const r = moyzesova(3);
    expect(r.beds.usedGroups).toEqual(['dvoj', 'dvoj', 'dvoj']);
    expect([count(r, 'paplonV'), count(r, 'paplonM'), count(r, 'vankus'), count(r, 'plachta')]).toEqual([3, 0, 6, 3]);
    expect(bedSummary(r)).toBe('1× king, 2× queen · 1× jednolôžko netreba');
    expect(r.warnings).not.toContain('sheet_size_check');
  });

  it('6 guests: every bed (one per guest where the flat has them): three large duvets plus a small one for the single bed', () => {
    const r = moyzesova(6);
    expect(r.beds.usedGroups).toEqual(['dvoj', 'dvoj', 'dvoj', 'jedno']);
    expect([count(r, 'paplonV'), count(r, 'paplonM'), count(r, 'vankus'), count(r, 'plachta')]).toEqual([3, 1, 7, 4]);
  });

  it('4 guests: three doubles with a large duvet each plus the single bed with a small one; its sheet is still a question', () => {
    const r = moyzesova(4);
    expect([count(r, 'paplonV'), count(r, 'paplonM')]).toEqual([3, 1]);
    expect([count(r, 'plachta'), count(r, 'plachtaM')]).toEqual([4, 0]);
    expect(r.warnings).toContain('sheet_size_check');
  });
});

describe('Skalická and Tomášikova: 2 small beds + 3 large, small sheets confirmed', () => {
  it('Skalická full (6): 3 large + 2 small sheets, 6 small duvets, 6 pillows, no sheet question', () => {
    const r = skalicka(6);
    expect(bedSummary(r)).toBe('3× manželská, 2× jednolôžko');
    expect(r.beds.sofasTotal).toBe(0);
    expect([count(r, 'plachta'), count(r, 'plachtaM'), count(r, 'plachta140')]).toEqual([3, 2, 0]);
    expect([count(r, 'paplonV'), count(r, 'paplonM'), count(r, 'vankus')]).toEqual([0, 6, 6]);
    expect(r.warnings).not.toContain('sheet_size_check');
    // Guesty's 6 small duvets cover the three double beds only; the single beds stay bare, which is a question for Angelika
    expect(r.warnings).toContain('duvets_short');
    expect(warningLine('duvets_short', r)).toBe('❓ Paplónov v Guesty je menej, ako treba na pripravené postele – preveriť s Angelikou');
    expect(duvetText(r)).toBe('podľa Guesty'); // the duvet set itself is still the Guesty one
  });

  it('Tomášikova full (5): the same five beds, 3 large + 2 small sheets; the spare small duvet is fine', () => {
    const r = tomasikova(5);
    expect(r.beds.usedGroups).toEqual(['dvoj', 'dvoj', 'dvoj', 'jedno', 'jedno']);
    expect([count(r, 'plachta'), count(r, 'plachtaM')]).toEqual([3, 2]);
    expect(count(r, 'paplonM')).toBe(6);
    expect(r.warnings).not.toContain('duvets_exceed_capacity');
    expect(r.warnings).not.toContain('sheet_size_check');
    expect(r.warnings).toContain('duvets_short'); // 6 small duvets for 3 doubles + 2 singles: the singles get none
  });

  it('Tomášikova with 2 guests: two double beds (one each), large sheets only, no small ones', () => {
    const r = tomasikova(2);
    expect(r.beds.usedGroups).toEqual(['dvoj', 'dvoj']);
    expect([count(r, 'plachta'), count(r, 'plachtaM')]).toEqual([2, 0]);
    expect(count(r, 'paplonM')).toBe(4);
    expect(bedSummary(r)).toBe('2× manželská (z 3) · 2× jednolôžko netreba');
  });

  it('Skalická with 4 guests: three doubles and one single bed, that single bed takes a small sheet', () => {
    const r = skalicka(4);
    expect(r.beds.usedGroups).toEqual(['dvoj', 'dvoj', 'dvoj', 'jedno']);
    expect([count(r, 'plachta'), count(r, 'plachtaM')]).toEqual([3, 1]);
    expect(r.warnings).not.toContain('sheet_size_check');
  });
});

describe('Mestská, Modern: full at 4 although Guesty says 2 (owner, 2026-10-11)', () => {
  const MESTSKA = '689c97f1ebf8060016d60895';
  const mestska = (next: ReturnType<typeof sameDay> | null) =>
    computePackage(pkg({ listing: listing({ guestyId: MESTSKA, beds: { KING_BED: 1, SOFA_BED: 1 }, accommodates: 2, laundry: laundry('Paplón malý: 4\nKapsule: Tchibo Cafissimo') }), next }));

  it('without a next reservation the flat is packed for 4: king + sofa, the four small duvets, no capacity question', () => {
    const r = mestska(null);
    expect(r.people).toBe(4);
    expect(r.peopleSource).toBe('capacity');
    expect(r.beds.usedGroups).toEqual(['dvoj', 'gauc']);
    expect([count(r, 'paplonM'), count(r, 'vankus'), count(r, 'plachta'), count(r, 'osuskaV'), count(r, 'toaletak'), count(r, 'vreckoV')]).toEqual([4, 4, 2, 4, 5, 3]);
    expect(r.warnings).not.toContain('duvets_exceed_capacity');
    expect(r.warnings).not.toContain('duvets_short');
    expect(r.duvetInventory).toBeUndefined();
    expect(FLAT_FACTS[MESTSKA].note).toContain('plný počet sú 4');
  });

  it('2 guests on the same day get the king only with its two small duvets', () => {
    const r = mestska(sameDay(2));
    expect(r.people).toBe(2);
    expect(r.beds.usedGroups).toEqual(['dvoj']);
    expect([count(r, 'paplonM'), count(r, 'vankus'), count(r, 'plachta')]).toEqual([2, 2, 1]);
  });
});

describe('Vajnorská, Terrazzo: packed as it is, no questions', () => {
  it('3 guests: king + 140 cm bed, 1 large sheet + 1 sheet 140 cm, the one large duvet, no bed or duvet warning', () => {
    const r = vajnorska(3);
    expect(r.beds.usedGroups).toEqual(['dvoj', 'jedno']);
    expect(bedSummary(r)).toBe('1× king, 1× posteľ 140 cm');
    expect([count(r, 'plachta'), count(r, 'plachta140'), count(r, 'plachtaM')]).toEqual([1, 1, 0]);
    expect([count(r, 'paplonV'), count(r, 'paplonM'), count(r, 'vankus')]).toEqual([1, 0, 2]);
    expect(r.warnings).not.toContain('beds_insufficient');
    expect(r.warnings).not.toContain('duvets_short');
    expect(r.warnings).not.toContain('sheet_size_check');
    expect(r.warnings).not.toContain('unknown_bed_type');
    expect(count(r, 'osuskaV')).toBe(3);
    expect(DEFAULT_ITEMS.find((i) => i.key === 'plachta140')).toEqual({ key: 'plachta140', label: 'Plachta 140 cm', size: '' });
  });

  it('owner 2026-10-16: no dishwasher tablets and no toilet paper for the flat, said on the card; the rest is packed', () => {
    const r = vajnorska(3);
    expect(flatAlias(VAJNORSKA)).toBe('Vajnorská 32A');
    expect(FLAT_FACTS[VAJNORSKA].note).toBe('Nenosiť tablety do umývačky riadu a zatiaľ ani toaletný papier – v zásuvke v skrini je veľká zásoba.');
    expect(count(r, 'toaletak')).toBe(0);
    expect(count(r, 'myckaKaps')).toBe(0);
    expect(r.consumables.map((l) => l.key)).toEqual(['utierky', 'spongia', 'vreckoV', 'vreckoM']);
    expect(count(r, 'utierky')).toBe(1);
    expect(count(r, 'osuskaV')).toBe(3);
    // other flats are untouched
    expect(count(computePackage(pkg({ next: sameDay(3) })), 'toaletak')).toBe(4);
  });

  it('a reservation with more guests than the two beds sleep still gets the bed warning', () => {
    expect(vajnorska(4).warnings).toContain('beds_insufficient');
  });

  it('1 guest: the king only, no 140 cm sheet; 2 guests get both beds like everywhere (one per guest)', () => {
    const one = vajnorska(1);
    expect(one.beds.usedGroups).toEqual(['dvoj']);
    expect([count(one, 'plachta'), count(one, 'plachta140')]).toEqual([1, 0]);
    expect(bedSummary(one)).toBe('1× king · 1× posteľ 140 cm netreba');
    const two = vajnorska(2);
    expect(two.beds.usedGroups).toEqual(['dvoj', 'jedno']);
    expect([count(two, 'plachta'), count(two, 'plachta140')]).toEqual([1, 1]);
    expect(two.warnings).toContain('separate_beds');
  });

  it('the new sheet item slots in next to the other sheets even for a settings row saved before it existed', () => {
    const saved = mergeSettings({ items: DEFAULT_ITEMS.filter((i) => i.key !== 'plachta140').map((i) => (i.key === 'plachta' ? { ...i, label: 'Plachta veľká' } : i)) });
    expect(saved.items.map((i) => i.key)).toEqual(DEFAULT_ITEMS.map((i) => i.key));
    expect(saved.items.find((i) => i.key === 'plachta')?.label).toBe('Plachta veľká');
    const custom = mergeSettings({ items: [{ key: 'xyz', label: 'Extra' }, { key: 'vankus', label: 'Vankúš 50×70' }] });
    expect(custom.items[custom.items.length - 1]).toEqual({ key: 'xyz', label: 'Extra' });
    expect(custom.items.find((i) => i.key === 'vankus')?.label).toBe('Vankúš 50×70');
  });

  it('a 140 cm bed in another flat is a single-type bed with its own sheet and no question', () => {
    const r = computePackage(pkg({ listing: listing({ beds: { KING_BED: 1, [BED_140]: 1 }, accommodates: 3, laundry: laundry('Paplón veľký: 1\nPaplón malý: 1') }), next: sameDay(3), facts: null }));
    expect([count(r, 'plachta'), count(r, 'plachta140'), count(r, 'paplonV'), count(r, 'paplonM')]).toEqual([1, 1, 1, 1]);
    expect(r.warnings).not.toContain('sheet_size_check');
  });

  it('settled questions stay off the card only for that flat', () => {
    const other = computePackage(pkg({ listing: listing({ beds: { KING_BED: 1 }, accommodates: 3, laundry: laundry('Paplón veľký: 1') }), next: sameDay(3) }));
    expect(other.warnings).toContain('beds_insufficient');
    expect(warningLine('beds_insufficient', other)).toBe('Postele v Guesty stačia len pre 2 osoby – over na byte');
  });
});

describe('toilet paper and bin bags (owner, 2026-10-10)', () => {
  it('toilet paper is always one roll more than the guests', () => {
    expect([1, 2, 3, 6].map(toiletPaperCount)).toEqual([2, 3, 4, 7]);
    expect(count(computePackage(pkg({ next: sameDay(1) })), 'toaletak')).toBe(2);
    expect(count(computePackage(pkg({ next: sameDay(2) })), 'toaletak')).toBe(3);
    expect(count(computePackage(pkg({ next: sameDay(5) })), 'toaletak')).toBe(6);
    // the capacity rule too: a 4-person flat without a next reservation
    expect(count(computePackage(pkg()), 'toaletak')).toBe(5);
  });

  it('bin bags follow the flat, not the guests: 2 + 2 below capacity 4, 3 + 3 from 4', () => {
    expect([1, 2, 3, 4, 5, 8].map(bagCount)).toEqual([2, 2, 2, 3, 3, 3]);
    const small = computePackage(pkg({ listing: listing({ beds: { KING_BED: 1 }, accommodates: 2 }), next: sameDay(1) }));
    expect([count(small, 'vreckoV'), count(small, 'vreckoM')]).toEqual([2, 2]);
    const big = computePackage(pkg({ listing: listing({ accommodates: 4 }), next: sameDay(1) }));
    expect([count(big, 'vreckoV'), count(big, 'vreckoM')]).toEqual([3, 3]);
    const six = computePackage(pkg({ listing: listing({ beds: { KING_BED: 2, SOFA_BED: 1 }, accommodates: 6 }), next: sameDay(2) }));
    expect([count(six, 'vreckoV'), count(six, 'vreckoM')]).toEqual([3, 3]);
  });

  it('without a Guesty capacity the beds decide the flat size', () => {
    const r = computePackage(pkg({ listing: listing({ beds: { KING_BED: 2 }, accommodates: null }), next: sameDay(2) }));
    expect([count(r, 'vreckoV'), count(r, 'vreckoM')]).toEqual([3, 3]);
    const one = computePackage(pkg({ listing: listing({ beds: { KING_BED: 1 }, accommodates: null }), next: sameDay(2) }));
    expect([count(one, 'vreckoV'), count(one, 'vreckoM')]).toEqual([2, 2]);
  });

  it('both rules are fixed in code: Settings values for them are ignored', () => {
    const settings = mergeSettings({ perApartment: { toaletak: 9, vreckoV: 7, vreckoM: 7 } });
    const r = computePackage(pkg({ settings, listing: listing({ accommodates: 2, beds: { KING_BED: 1 } }), next: sameDay(1) }));
    expect([count(r, 'toaletak'), count(r, 'vreckoV'), count(r, 'vreckoM')]).toEqual([2, 2, 2]);
  });
});
