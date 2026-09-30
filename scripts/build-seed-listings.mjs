// Builds src/guesty/fixtures/seed/listings.json from the reference export
// (reference/data/listings.json in the OneDrive folder): the 107 real listing
// shapes as Guesty Open API objects, without guest data. Run once; the output is committed.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const src = process.argv[2] ?? 'C:/Users/melik/OneDrive/Počítač/Pracovna app/reference/data/listings.json';
const out = resolve('src/guesty/fixtures/seed/listings.json');
const LAUNDRY_FIELD_ID = '6ab385c5bcf98e0011a9419d';

const data = JSON.parse(readFileSync(src, 'utf8'));
const entries = Object.entries(data.items);

// a few listings get extra laundry lines so seed mode exercises every rule
const extras = {
  0: ['Kapsule: Tchibo Cafissimo', 'Kávovar: Tchibo Cafissimo Pure'],
  1: ['Kapsule: Nespresso original (malé)', 'Navyše: detská postieľka, rozkladacia posteľ'],
  2: ["Kapsule: L'OR Nespresso (veľké) 10 ks", 'Kávovar: Philips L\'OR Barista'],
  3: ['Kapsule: nedávať'],
  4: ['Kapsule: upresniť'],
  5: ['Osušky veľké: 6', 'Uteráky malé: 6', 'Uteráky na nohy do kúpeľne: 2'],
  6: ['Paplóny: malé'],
  7: ['Kapsule: Nespresso original (malé); Tchibo Cafissimo'],
};

function laundryText(l, i) {
  const lines = [];
  const c = l.laundry?.counts ?? {};
  if ('paplonV' in c || 'paplonM' in c) {
    if (c.paplonV) lines.push(`Paplón veľký: ${c.paplonV}`);
    if (c.paplonM) lines.push(`Paplón malý: ${c.paplonM}`);
  }
  if (l.laundry?.private) lines.push('Prádlo: súkromné');
  if (l.laundry?.note) lines.push(`Poznámka: ${l.laundry.note}`);
  for (const x of extras[i] ?? []) lines.push(x);
  return lines.join('\n');
}

const listings = entries.map(([id, l], i) => {
  const beds = Object.entries(l.beds ?? {}).map(([type, quantity]) => ({ type, quantity }));
  const text = laundryText(l, i);
  return {
    _id: id,
    nickname: l.name,
    title: `${l.name} – apartment`,
    active: true,
    isListed: true,
    address: { city: 'Bratislava', country: 'SK' },
    accommodates: l.accommodates,
    bedrooms: l.bedrooms,
    bathrooms: l.bathrooms,
    beds: beds.reduce((s, b) => s + b.quantity, 0),
    tags: [],
    customFields: text ? [{ fieldId: LAUNDRY_FIELD_ID, value: text }] : [],
    listingRooms: beds.length ? [{ beds }] : [],
  };
});

// out-of-scope examples
listings.push({
  _id: 'aaaaaaaaaaaaaaaaaaaaaa01',
  nickname: 'KE: Hlavná, Test',
  title: 'Košice test',
  active: true,
  isListed: true,
  address: { city: 'Košice', country: 'SK' },
  accommodates: 2,
  bedrooms: 1,
  bathrooms: 1,
  beds: 1,
  tags: [],
  customFields: [],
  listingRooms: [{ beds: [{ type: 'KING_BED', quantity: 1 }] }],
});
listings.push({
  _id: 'aaaaaaaaaaaaaaaaaaaaaa02',
  nickname: 'Testovacia, Neaktívna',
  title: 'Inactive test',
  active: false,
  isListed: false,
  address: { city: 'Bratislava', country: 'SK' },
  accommodates: 2,
  bedrooms: 1,
  bathrooms: 1,
  beds: 1,
  tags: [],
  customFields: [],
  listingRooms: [{ beds: [{ type: 'KING_BED', quantity: 1 }] }],
});

mkdirSync(resolve('src/guesty/fixtures/seed'), { recursive: true });
writeFileSync(out, JSON.stringify(listings, null, 1) + '\n');
console.log(`wrote ${listings.length} listings to ${out}`);
