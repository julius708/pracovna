import { describe, expect, it } from 'vitest';
import { listingDisplayName, listingScope, OWNER_CLEANS_IDS } from '@/core/packing';

const base = { guestyId: 'X1', nickname: 'Testovacia, Byt', city: 'Bratislava', active: true, tags: [], laundryRaw: '' };

describe('test 10: which apartments belong to the laundry', () => {
  it('a Bratislava listing is in scope; the city match is diacritics-insensitive and partial', () => {
    expect(listingScope(base)).toEqual({ inScope: true, reason: null });
    expect(listingScope({ ...base, city: 'Bratislava - Staré Mesto' }).inScope).toBe(true);
    expect(listingScope({ ...base, city: 'BRATISLAVA' }).inScope).toBe(true);
    expect(listingScope({ ...base, city: 'Bratislavá' }).inScope).toBe(true);
  });

  it('a non-Bratislava city excludes the listing', () => {
    expect(listingScope({ ...base, city: 'Košice' })).toEqual({ inScope: false, reason: 'city' });
    expect(listingScope({ ...base, city: 'Hrubá Borša' }).reason).toBe('city');
    expect(listingScope({ ...base, city: null }).reason).toBe('city');
  });

  it('nicknames starting with KE: / TT: are excluded, case-insensitive and whitespace-tolerant', () => {
    expect(listingScope({ ...base, nickname: 'KE: Hlavná' }).reason).toBe('prefix');
    expect(listingScope({ ...base, nickname: 'tt :Trojičné' }).reason).toBe('prefix');
    expect(listingScope({ ...base, nickname: 'Kettering' }).inScope).toBe(true);
  });

  it('inactive listings are excluded', () => {
    expect(listingScope({ ...base, active: false }).reason).toBe('inactive');
  });

  it('the owner-cleans text excludes the listing, for each spec phrase, also inside a longer line', () => {
    for (const text of [
      'Upratuje majiteľ',
      'Poznámka: byt upratuje majiteľ sám, nič nebaliť',
      'Majitelia si upratujú sami',
      'Nezaradiť do práčovne',
      'Byt je mimo práčovne',
      'UPRATUJE MAJITEL',
    ]) {
      expect(listingScope({ ...base, laundryRaw: text }), text).toEqual({ inScope: false, reason: 'owner_text' });
    }
  });

  it('merely mentioning majiteľ and upratovanie in a note does not exclude', () => {
    expect(listingScope({ ...base, laundryRaw: 'Poznámka: majiteľ chce po upratovaní zavrieť okná' }).inScope).toBe(true);
  });

  it('the Guesty tag and the hard-coded ids exclude', () => {
    expect(listingScope({ ...base, tags: ['Upratuje majiteľ'] }).reason).toBe('owner_tag');
    for (const id of OWNER_CLEANS_IDS) expect(listingScope({ ...base, guestyId: id }).reason).toBe('owner_id');
    expect(OWNER_CLEANS_IDS.size).toBe(5);
  });

  it('display name is the nickname with the title as fallback', () => {
    expect(listingDisplayName('Skypark, Royal', 'Royal apartment')).toBe('Skypark, Royal');
    expect(listingDisplayName('', 'Royal apartment')).toBe('Royal apartment');
    expect(listingDisplayName(null, null)).toBe('');
  });
});
