/**
 * Extra cleanings read from board messages (Martina, 2026-11-18). The texts are
 * the shape of real "Dôležité info" messages (no guest data).
 */
import { describe, expect, it } from 'vitest';
import { collectExtras, extraDate, extraPeople, isExtraCleaningText, matchFlats, readExtra } from '@/core/packing';

const NAMES = [
  'Antolská, Studio',
  'Bajkalská, Luxe',
  'Gross. 23, Central',
  'Gross. 38, Elegant',
  'Jarabinková B,Bright',
  'Modrá Guľa 2 (2nd Floor)',
  'Modrá Guľa 3 (3rd Floor)',
  'Na Revíne, Cloud',
  'Skypark Luxe I',
  'Skypark Luxe II',
  'Skypark, Luxury I',
  'Skypark, Luxury II',
  'Skypark, Modern',
  'Skypark, Royal',
  'Štef., City Heart',
  'Strakova, Exclusive',
  'Trnavská A, Fabulous',
  'Trnavská B, Sunny',
  'Vyšehradská, Spacious',
  'Žilinska A, Castle',
  'Žilinska B, Urban',
  'Žilinská C, Art-touched',
];
const L = NAMES.map((name) => ({ id: name, name }));
const flat = (text: string) => matchFlats(text, L).matched.map((m) => m.name);

describe('isExtraCleaningText – what counts as a cleaning request', () => {
  it.each([
    'Žilinská A-extra upratovanie o 10:00 prosím zabaliť (1 osoba)',
    'Prosim nachystat tasku Trnavska cesta A - 1 osoba na pondelok 9.11. - extra upratovanie',
    'Zabalite tašku na Bajkalskej 2F, zajtra bude upratovanie po majiteľovi',
    'Antolská prosím upratat tiež (dlhší pobyt) 1 osoba',
    'Vyšehradská prosím upratať tiež (v nedeľu sa nešlo, čip už má Maťka)',
    'Prosim zabalit aj Skypark Modern, 187 - 2 osoby',
    'Prosím dnes sa upratuje aj Štefániková',
    'Prosim pripravit pradlo Na Revine - 6 osob, bude sa upratovat o den skor',
    'Skypark Luxe I predlzeny pobyt, 2 osoby, prosim tasku',
    'Skypark Luxury 1 – predĺžený pobyt, 1 osoba',
  ])('yes: %s', (t) => expect(isExtraCleaningText(t)).toBe(true));

  it.each([
    'Trnavská A nemisite ísť predĺžili pobyt',
    'Modra Gula 3 - nebalit, predlzili pobyt',
    'Skalicka A neupratovat prosim je tam predlzena rezervacia',
    'Tri veže prosím neupratujte, to je predĺženie.',
    'Ventúrska 16 (B) V apartmáne nikto nebýval, preto sme upratovanie nevykonávali',
    'Dohnanyho prosim zabalit aj ziarovku, je v pracovni',
    'Gorkeho B - pani Angelika prosim pribalte do tasky aj WC kefu',
    'prosim ked pojdete upratovat Moskovsku, odfodte mi wifi router',
    'Skypark elegant: škvrna na záclone – vyčistiť pri hĺbkovom upratovaní',
    'Modra gula 3 Bright: vezmite si extra tablety do umyvacky',
    'Artur, prosim vziat vsetky nase modre tasky ked sa pojde do pracovne',
    'Heuhaus Paradise 2 predĺžil do piatka',
  ])('no: %s', (t) => expect(isExtraCleaningText(t)).toBe(false));
});

describe('matchFlats – the flat a message names', () => {
  it('reads the letter after the street, also with "cesta" and declension', () => {
    expect(flat('Prosim nachystat tasku Trnavska cesta A - 1 osoba')).toEqual(['Trnavská A, Fabulous']);
    expect(flat('taska na Trnavsku cestu B')).toEqual(['Trnavská B, Sunny']);
    expect(flat('Žilinská A-extra upratovanie')).toEqual(['Žilinska A, Castle']);
  });
  it('reads numbers, abbreviations and roman numbers', () => {
    expect(flat('Grosslingova 38 dnes je posledne upratovanie')).toEqual(['Gross. 38, Elegant']);
    expect(flat('Modra gula 3 prosim upratat')).toEqual(['Modrá Guľa 3 (3rd Floor)']);
    expect(flat('Dnes prosim dnes sa upratuje aj Štefániková')).toEqual(['Štef., City Heart']);
    expect(flat('Dnes prosim aj upratat skypark luxury 1 o 10:00')).toEqual(['Skypark, Luxury I']);
    expect(flat('Skypark Luxe 2 prosim upratat')).toEqual(['Skypark Luxe II']);
    expect(flat('Prosim zabalit aj Skypark Modern, 187 - 2 osoby')).toEqual(['Skypark, Modern']);
  });
  it('a street with one flat needs no letter (Jarabinková has only B)', () => {
    expect(flat('Extra upratovanie na Jarabinkova (1osoba) o 10:00')).toEqual(['Jarabinková B,Bright']);
  });
  it('a street with several flats and no letter is unclear, not guessed', () => {
    const m = matchFlats('Nachystajte prosim tasku na Žilinskú (2 osoby)', L);
    expect(m.matched).toEqual([]);
    expect(m.unclear[0].map((l) => l.name)).toEqual(['Žilinska A, Castle', 'Žilinska B, Urban', 'Žilinská C, Art-touched']);
  });
  it('no flat in the text: nothing', () => {
    expect(matchFlats('prosim nachystat tasku', L)).toEqual({ matched: [], unclear: [] });
  });
});

describe('extraDate / extraPeople', () => {
  it('reads the day the message asks for', () => {
    expect(extraDate('na pondelok 9.11. - extra upratovanie', '2026-11-08')).toBe('2026-11-09');
    expect(extraDate('zajtra bude upratovanie', '2026-10-21')).toBe('2026-10-22');
    expect(extraDate('pozajtra', '2026-10-21')).toBe('2026-10-23');
    expect(extraDate('extra upratovanie na pondelok', '2026-11-18')).toBe('2026-11-23');
    expect(extraDate('extra upratovanie o 10:00', '2026-11-18')).toBe('2026-11-18');
    expect(extraDate('upratat (v nedeľu sa nešlo)', '2026-10-26')).toBe('2026-10-26');
    expect(extraDate('bude sa upratovat namiesto Soboty', '2026-10-16')).toBe('2026-10-16');
    expect(extraDate('upratat 2.1.', '2026-12-30')).toBe('2027-01-02');
  });
  it('reads the number of people, else null', () => {
    expect(extraPeople('(1osoba) o 10:00')).toBe(1);
    expect(extraPeople('pre 2 osoby')).toBe(2);
    expect(extraPeople('Na Revine - 6 osob')).toBe(6);
    expect(extraPeople('pre 1 extra osobu')).toBe(1);
    expect(extraPeople('o 10:00 prosim')).toBeNull();
  });
});

describe('collectExtras – one card per flat and day', () => {
  it('merges two messages about the same cleaning and drops days outside the board', () => {
    const { extras, unclear } = collectExtras(
      [
        { id: 'a', from: 'notes', date: '2026-11-08', text: 'Prosim nachystat tasku Trnavska cesta A - 1 osoba na pondelok 9.11. - extra upratovanie' },
        { id: 'b', from: 'notes', date: '2026-11-09', text: 'Skontrolovat, ci je nachystana taska na Trnavsku cestu A - 1 osoba, je tam dnes extra upratovanie' },
        { id: 'c', from: 'notes', date: '2026-11-09', text: 'Antolská extra upratovanie na 20.11.' },
        { id: 'd', from: 'notes', date: '2026-11-09', text: 'Nachystajte prosim tasku na Žilinskú (2 osoby)' },
      ],
      L,
      ['2026-11-09', '2026-11-10'],
    );
    expect(extras).toHaveLength(1);
    expect(extras[0]).toMatchObject({ listingName: 'Trnavská A, Fabulous', date: '2026-11-09', people: 1 });
    expect(extras[0].sources.map((s) => s.id)).toEqual(['a', 'b']);
    expect(unclear.map((u) => u.sourceId)).toEqual(['d']);
  });
  it('a message with a flat picked in the form uses that flat', () => {
    const r = readExtra({ id: 'x', from: 'cleaning', date: '2026-11-18', text: 'prosim upratat aj dnes', listingId: 'Strakova, Exclusive' }, L);
    expect(r?.flats.map((f) => f.name)).toEqual(['Strakova, Exclusive']);
  });
});

describe('extraNoteLine – the line under a message', () => {
  it('names the card, or says why there is none', async () => {
    const { extraNoteLine } = await import('@/ui/board-model');
    const dates = ['2026-11-18', '2026-11-19'];
    const label = (d: string) => (d === '2026-11-18' ? 'Dnes 18.11.' : d === '2026-11-19' ? 'Zajtra 19.11.' : `Po ${d}`);
    expect(extraNoteLine('Trnavská A extra upratovanie zajtra', '2026-11-18', null, L, dates, label)).toBe('🧹 Karta na balenie: Trnavská A, Fabulous · Zajtra 19.11.');
    expect(extraNoteLine('taska na Žilinskú prosím nachystať', '2026-11-18', null, L, dates, label)).toContain('neviem, ktorý byt');
    expect(extraNoteLine('extra upratovanie o 10:00', '2026-11-18', null, L, dates, label)).toContain('nenašla som názov bytu');
    expect(extraNoteLine('Sancova prosim davkovac mydla novy', '2026-11-18', null, L, dates, label)).toBeNull();
  });
});
