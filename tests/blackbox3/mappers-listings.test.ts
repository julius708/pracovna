/**
 * Black-box tests: Guesty mappers (mapListing, mapReservation, bedsFromRooms,
 * customFieldEntries) and the listing sync (syncListings) against the SPEC §3
 * ("Which apartments", "Listing data used") and PROPOSAL §5 step 1 + scope rules.
 * Written from the public signatures only; see the report for verdicts.
 */
import { describe, expect, it } from 'vitest';
import { LAUNDRY_FIELD_ID } from '@/core/packing';
import { MemoryRepo } from '@/db/memory-repo';
import type { GuestyClient } from '@/guesty/client';
import { createFakeGuestyClient, type FakeGuestyData } from '@/guesty/fake-client';
import { silentLogger } from '@/guesty/log';
import { bedsFromRooms, customFieldEntries, mapListing, mapReservation, type ListingMapContext } from '@/guesty/mappers';
import type { ParsedListing, ParsedReservation } from '@/guesty/schemas';
import { MAX_IN_SCOPE_DROP, syncListings } from '@/sync/listings';

const NOW = '2026-10-05T06:00:00.000Z';
const at = (iso: string) => () => new Date(iso);
/** Závodná Panoramic – one of the five hard-coded owner-cleans ids (SPEC §3). */
const OWNER_ID = '6a86ff17bca9ae0013a0b530';
const LAUNDRY_TEXT = 'Paplón malý: 4\nKapsule: Tchibo Cafissimo';

function listing(over: Partial<ParsedListing> & { _id: string }): ParsedListing {
  return {
    nickname: `Byt ${over._id}`,
    title: `Byt ${over._id} – apartment`,
    active: true,
    isListed: true,
    address: { city: 'Bratislava', country: 'SK' },
    accommodates: 4,
    bedrooms: 1,
    bathrooms: 1,
    tags: [],
    customFields: [{ fieldId: LAUNDRY_FIELD_ID, value: LAUNDRY_TEXT }],
    listingRooms: [{ beds: [{ type: 'QUEEN_BED', quantity: 1 }, { type: 'SOFA_BED', quantity: 1 }] }],
    ...over,
  };
}

function ctx(over: Partial<ListingMapContext> = {}): ListingMapContext {
  return { laundryFieldId: LAUNDRY_FIELD_ID, fetchedAt: NOW, ...over };
}

function reservation(over: Partial<ParsedReservation> = {}): ParsedReservation {
  return {
    reservationId: 'r1',
    status: 'confirmed',
    confirmationCode: 'GY-1',
    source: 'airbnb',
    stay: [
      {
        listingId: 'L1',
        checkInDateLocalized: '2026-10-01',
        checkOutDateLocalized: '2026-10-05',
        guestsCount: 3,
        numberOfGuests: { numberOfAdults: 2, numberOfChildren: 1, numberOfInfants: 1 },
      },
    ],
    ...over,
  };
}

function fake(listings: ParsedListing[], extra: Partial<FakeGuestyData> = {}) {
  return createFakeGuestyClient({ listings, reservations: [], calendar: {}, ...extra });
}

/** Wraps a client and records which ids the expensive fallbacks were asked for. */
function spy(client: GuestyClient) {
  const spaces: string[] = [];
  const customFields: string[] = [];
  let defs = 0;
  const wrapped: GuestyClient = {
    ...client,
    getSpaces: (id) => {
      spaces.push(id);
      return client.getSpaces(id);
    },
    getListingCustomFields: (id) => {
      customFields.push(id);
      return client.getListingCustomFields(id);
    },
    getCustomFieldDefs: () => {
      defs++;
      return client.getCustomFieldDefs();
    },
  };
  return { client: wrapped, spaces, customFields, defs: () => defs };
}

function deps(repo: MemoryRepo, client: GuestyClient, now = at(NOW), cleanerFieldId?: string | null) {
  repo.now = now;
  return { repo, client, laundryFieldId: LAUNDRY_FIELD_ID, cleanerFieldId, log: silentLogger, now };
}

const ids = (n: number, prefix = 'L') => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);

// ---------------------------------------------------------------------------
describe('bedsFromRooms', () => {
  it('sums bed quantities across several rooms and repeated bed types', () => {
    const rooms = [
      { beds: [{ type: 'KING_BED', quantity: 1 }, { type: 'SINGLE_BED', quantity: 2 }] },
      { beds: [{ type: 'SINGLE_BED', quantity: 1 }, { type: 'SOFA_BED', quantity: 1 }] },
      { beds: [{ type: 'BUNK_BED', quantity: 1 }] },
    ];
    expect(bedsFromRooms(rooms)).toEqual({ KING_BED: 1, SINGLE_BED: 3, SOFA_BED: 1, BUNK_BED: 1 });
  });

  it('quantity 0 or missing never produces a positive or NaN count', () => {
    const r = bedsFromRooms([{ beds: [{ type: 'KING_BED', quantity: 0 }, { type: 'QUEEN_BED' }, { type: 'SOFA_BED', quantity: null }] }]);
    expect(r.KING_BED ?? 0).toBe(0);
    for (const v of Object.values(r)) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
    }
  });

  it('a numeric string quantity is read as a number (Guesty sends numbers as strings in places)', () => {
    expect(bedsFromRooms([{ beds: [{ type: 'SINGLE_BED', quantity: '2' }] }])).toEqual({ SINGLE_BED: 2 });
  });

  it('tolerates garbage: non-array input, rooms without beds; a bed slot without a type still counts (as UNKNOWN)', () => {
    expect(bedsFromRooms(null)).toEqual({});
    expect(bedsFromRooms(undefined)).toEqual({});
    expect(bedsFromRooms('rooms')).toEqual({});
    expect(bedsFromRooms({ beds: [{ type: 'KING_BED', quantity: 1 }] })).toEqual({});
    // A slot with a quantity but no type is a real bed in Guesty; the domain
    // keeps it as UNKNOWN (= double bed + 'unknown_bed_type' warning) rather
    // than silently under-packing. (First expectation "skip it" was wrong.)
    expect(bedsFromRooms([{ beds: null }, { name: 'Living room' }, { beds: [{ quantity: 2 }, { type: 'KING_BED', quantity: 1 }] }])).toEqual({ KING_BED: 1, UNKNOWN: 2 });
  });
});

// ---------------------------------------------------------------------------
describe('customFieldEntries', () => {
  it('reads the array form [{fieldId, value, fullText?}]', () => {
    const e = customFieldEntries([
      { fieldId: 'a', value: 'x' },
      { fieldId: 'b', value: 'short', fullText: 'short but longer' },
    ]);
    expect(e).toHaveLength(2);
    expect(e[0]).toMatchObject({ fieldId: 'a', value: 'x' });
    expect(e[1]).toMatchObject({ fieldId: 'b', value: 'short', fullText: 'short but longer' });
  });

  it('reads an object keyed by fieldId with plain values', () => {
    const e = customFieldEntries({ a: 'x', b: 'y' });
    expect(e.map((x) => [x.fieldId, x.value])).toEqual([
      ['a', 'x'],
      ['b', 'y'],
    ]);
  });

  // SPEC-AMBIGUOUS: Guesty documents the listing's customFields only as {"type":"object"}
  // with no inner schema (research_listings). Reading A: an object keyed by fieldId
  // holds the raw values. Reading B: it holds {value, fullText} entries like the
  // properties-api endpoint. The mapper implements A; under B the laundry text would
  // become "[object Object]" (fieldText -> String(v)). Skipped until a live probe.
  it.skip('reads an object keyed by fieldId whose values are {value, fullText} objects', () => {
    const e = customFieldEntries({ a: { value: 'short', fullText: 'short but longer' } });
    expect(e).toHaveLength(1);
    expect(e[0].fieldId).toBe('a');
    expect(e[0].value).toBe('short');
    expect(e[0].fullText).toBe('short but longer');
  });

  it('garbage gives an empty list and items without a fieldId are skipped', () => {
    expect(customFieldEntries(null)).toEqual([]);
    expect(customFieldEntries(undefined)).toEqual([]);
    expect(customFieldEntries('x')).toEqual([]);
    expect(customFieldEntries(42)).toEqual([]);
    expect(customFieldEntries([{ value: 'no id' }, null, 'str', { fieldId: 'a', value: 1 }]).map((x) => x.fieldId)).toEqual(['a']);
  });
});

// ---------------------------------------------------------------------------
describe('mapListing', () => {
  it('maps a complete Guesty listing into the listings row', () => {
    const row = mapListing(listing({ _id: 'L1', nickname: 'Hlavatého, Art', tags: ['nový'] }), ctx());
    expect(row).toMatchObject({
      guesty_id: 'L1',
      name: 'Hlavatého, Art',
      title: 'Byt L1 – apartment',
      city: 'Bratislava',
      active: true,
      accommodates: 4,
      bedrooms: 1,
      bathrooms: 1,
      beds: { QUEEN_BED: 1, SOFA_BED: 1 },
      beds_source: 'listingRooms',
      tags: ['nový'],
      laundry_raw: LAUNDRY_TEXT,
      cleaner: null,
      owner_cleans: false,
      in_scope: true,
      exclusion_reason: null,
      fetched_at: NOW,
    });
    expect(row.laundry?.duvetCounts).toEqual({ large: 0, small: 4 });
    expect(row.laundry?.ownerCleans).toBe(false);
  });

  it('beds: listingRooms win over Spaces; without rooms Spaces are used; without both the row says none', () => {
    const spaces = { beds: { KING_BED: 2 }, bathrooms: 1 };
    const withRooms = mapListing(listing({ _id: 'L1' }), ctx({ spaces }));
    expect(withRooms.beds).toEqual({ QUEEN_BED: 1, SOFA_BED: 1 });
    expect(withRooms.beds_source).toBe('listingRooms');

    const noRooms = mapListing(listing({ _id: 'L2', listingRooms: undefined }), ctx({ spaces }));
    expect(noRooms.beds).toEqual({ KING_BED: 2 });
    expect(noRooms.beds_source).toBe('spaces');

    const nothing = mapListing(listing({ _id: 'L3', listingRooms: undefined, beds: undefined }), ctx({ spaces: null }));
    expect(nothing.beds).toEqual({});
    expect(nothing.beds_source).toBe('none');
  });

  it('beds: an empty listingRooms array carries no beds, so Spaces are the source', () => {
    const row = mapListing(listing({ _id: 'L1', listingRooms: [] }), ctx({ spaces: { beds: { DOUBLE_BED: 1, SINGLE_BED: 1 }, bathrooms: 1 } }));
    expect(row.beds).toEqual({ DOUBLE_BED: 1, SINGLE_BED: 1 });
    expect(row.beds_source).toBe('spaces');
  });

  it('bathrooms: the listing value wins, Spaces fill in when the listing has none', () => {
    const spaces = { beds: {}, bathrooms: 1.5 };
    expect(mapListing(listing({ _id: 'L1', bathrooms: 2 }), ctx({ spaces })).bathrooms).toBe(2);
    expect(mapListing(listing({ _id: 'L2', bathrooms: null }), ctx({ spaces })).bathrooms).toBe(1.5);
    expect(mapListing(listing({ _id: 'L3', bathrooms: undefined }), ctx({ spaces })).bathrooms).toBe(1.5);
    expect(mapListing(listing({ _id: 'L4', bathrooms: undefined }), ctx()).bathrooms).toBeNull();
  });

  it('laundry: inline customFields as an object keyed by fieldId', () => {
    const row = mapListing(listing({ _id: 'L1', customFields: { [LAUNDRY_FIELD_ID]: 'Paplón veľký: 1', other: 'x' } }), ctx());
    expect(row.laundry_raw).toBe('Paplón veľký: 1');
    expect(row.laundry?.duvetCounts).toEqual({ large: 1, small: 0 });
  });

  it('laundry: a field whose definition name contains "pracovn" is used when the configured id is absent', () => {
    const row = mapListing(
      listing({ _id: 'L1', customFields: [{ fieldId: 'cf_alt', value: 'Prádlo: súkromné' }] }),
      ctx({ fieldNames: { cf_alt: 'informacie do pracovne', cf_z: 'kod od dveri' } }),
    );
    expect(row.laundry_raw).toBe('Prádlo: súkromné');
    expect(row.laundry?.private).toBe(true);
  });

  it('laundry: values from the custom-field endpoint are used when inline customFields are missing, and fullText beats a truncated value', () => {
    const fullText = 'Paplón malý: 2\nKapsule: Tchibo Cafissimo\nPoznámka: dlhá poznámka pre práčovňu';
    const row = mapListing(
      listing({ _id: 'L1', customFields: undefined }),
      ctx({ customFieldValues: [{ fieldId: LAUNDRY_FIELD_ID, value: 'Paplón malý: 2\nKapsule: Tch', fullText }] }),
    );
    expect(row.laundry_raw).toBe(fullText);
    expect(row.laundry?.duvetCounts).toEqual({ large: 0, small: 2 });
    expect(row.laundry?.notes.some((n) => n.includes('dlhá poznámka'))).toBe(true);

    // without fullText the value is the text
    const plain = mapListing(listing({ _id: 'L2', customFields: undefined }), ctx({ customFieldValues: [{ fieldId: LAUNDRY_FIELD_ID, value: 'Paplón malý: 3', fullText: null }] }));
    expect(plain.laundry_raw).toBe('Paplón malý: 3');

    // inline entries may carry fullText too
    const inline = mapListing(listing({ _id: 'L3', customFields: [{ fieldId: LAUNDRY_FIELD_ID, value: 'Paplón malý: 2\nKap', fullText }] }), ctx());
    expect(inline.laundry_raw).toBe(fullText);
  });

  it('cleaner: taken by the configured field id, or by a definition name containing "upratov"', () => {
    const cf = [
      { fieldId: LAUNDRY_FIELD_ID, value: LAUNDRY_TEXT },
      { fieldId: 'cf_clean', value: 'Mária' },
    ];
    expect(mapListing(listing({ _id: 'L1', customFields: cf }), ctx({ cleanerFieldId: 'cf_clean' })).cleaner).toBe('Mária');
    expect(mapListing(listing({ _id: 'L2', customFields: cf }), ctx({ fieldNames: { cf_clean: 'upratovacka' } })).cleaner).toBe('Mária');
    expect(mapListing(listing({ _id: 'L3', customFields: cf }), ctx()).cleaner).toBeNull();
  });

  it('name: nickname, then title, then the Guesty id', () => {
    expect(mapListing(listing({ _id: 'L1', nickname: 'Nick', title: 'Title' }), ctx()).name).toBe('Nick');
    expect(mapListing(listing({ _id: 'L2', nickname: '', title: 'Title' }), ctx()).name).toBe('Title');
    expect(mapListing(listing({ _id: 'L3', nickname: null, title: 'Title' }), ctx()).name).toBe('Title');
    expect(mapListing(listing({ _id: 'L4', nickname: '', title: '' }), ctx()).name).toBe('L4');
    expect(mapListing(listing({ _id: 'L5', nickname: null, title: null }), ctx()).name).toBe('L5');
  });

  it('scope: every exclusion reason of the spec is reported', () => {
    const reason = (l: ParsedListing) => {
      const r = mapListing(l, ctx());
      return [r.in_scope, r.exclusion_reason, r.owner_cleans] as const;
    };
    expect(reason(listing({ _id: 'L1', active: false }))).toEqual([false, 'inactive', false]);
    expect(reason(listing({ _id: 'L2', address: { city: 'Košice' } }))).toEqual([false, 'city', false]);
    expect(reason(listing({ _id: 'L3', address: null }))).toEqual([false, 'city', false]);
    expect(reason(listing({ _id: 'L4', nickname: 'TT: Byt' }))).toEqual([false, 'prefix', false]);
    expect(reason(listing({ _id: 'L5', nickname: 'ke: Byt' }))).toEqual([false, 'prefix', false]);
    expect(reason(listing({ _id: OWNER_ID }))).toEqual([false, 'owner_id', true]);
    expect(reason(listing({ _id: 'L6', tags: ['Upratuje majiteľ'] }))).toEqual([false, 'owner_tag', true]);
    const text = mapListing(listing({ _id: 'L7', customFields: [{ fieldId: LAUNDRY_FIELD_ID, value: 'Kapsule: nedávať\nNEZARADIŤ DO PRÁČOVNE' }] }), ctx());
    expect([text.in_scope, text.exclusion_reason, text.owner_cleans]).toEqual([false, 'owner_text', true]);
    expect(text.laundry?.ownerCleans).toBe(true);
  });

  it('scope: Bratislava is matched case- and diacritics-insensitively as a substring', () => {
    for (const city of ['Bratislava', 'BRATISLAVA', 'Bratislava - Petržalka', 'Bratislava-Ružinov', 'bratislava']) {
      const r = mapListing(listing({ _id: 'L1', address: { city } }), ctx());
      expect(r.in_scope, city).toBe(true);
      expect(r.city).toBe(city);
    }
  });

  it('a missing active flag is treated the same way by the row and by the scope (Guesty creates properties active)', () => {
    for (const active of [undefined, null]) {
      const r = mapListing(listing({ _id: 'L1', active }), ctx());
      expect(r.active, String(active)).toBe(true);
      expect(r.in_scope, String(active)).toBe(r.active);
      expect(r.exclusion_reason).not.toBe('inactive');
    }
  });

  it('null tags become [] and an empty laundry field becomes null', () => {
    const r = mapListing(listing({ _id: 'L1', tags: null, customFields: [{ fieldId: LAUNDRY_FIELD_ID, value: '' }] }), ctx());
    expect(r.tags).toEqual([]);
    expect(r.laundry).toBeNull();
    expect(r.laundry_raw ?? '').toBe('');
    const none = mapListing(listing({ _id: 'L2', customFields: undefined }), ctx());
    expect(none.laundry).toBeNull();
    expect(none.laundry_raw ?? '').toBe('');
    expect(none.in_scope).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe('mapReservation', () => {
  it('maps a v3 search item (reservationId + stay[]) into the reservations row', () => {
    expect(mapReservation(reservation(), NOW)).toEqual({
      guesty_id: 'r1',
      listing_id: 'L1',
      arrival_listing_id: 'L1',
      status: 'confirmed',
      check_in_date: '2026-10-01',
      check_out_date: '2026-10-05',
      guests: 3,
      adults: 2,
      children: 1,
      infants: 1,
      confirmation_code: 'GY-1',
      source: 'airbnb',
      multi_stay: false,
      not_found_runs: 0,
      fetched_at: NOW,
    });
  });

  it('the id comes from _id when reservationId is absent (get-by-ids shape) and status passes through', () => {
    const r = mapReservation(reservation({ reservationId: undefined, _id: 'abc', status: 'canceled' }), NOW);
    expect(r?.guesty_id).toBe('abc');
    expect(r?.status).toBe('canceled');
    const both = mapReservation(reservation({ reservationId: 'same', _id: 'same' }), NOW);
    expect(both?.guesty_id).toBe('same');
  });

  it('multi-segment stay: arrival = first segment, check-out = last segment, multi_stay only when listing ids differ', () => {
    const stay = [
      { listingId: 'L1', checkInDateLocalized: '2026-10-01', checkOutDateLocalized: '2026-10-03', guestsCount: 2 },
      { listingId: 'L2', checkInDateLocalized: '2026-10-03', checkOutDateLocalized: '2026-10-05', guestsCount: 2 },
    ];
    // the top-level listingId must not override the segments
    const r = mapReservation(reservation({ stay, listingId: 'L9', checkInDateLocalized: '2026-09-01', checkOutDateLocalized: '2026-09-02' }), NOW);
    expect(r).toMatchObject({ listing_id: 'L2', arrival_listing_id: 'L1', check_in_date: '2026-10-01', check_out_date: '2026-10-05', multi_stay: true });

    const same = mapReservation(reservation({ stay: stay.map((s) => ({ ...s, listingId: 'L1' })) }), NOW);
    expect(same).toMatchObject({ listing_id: 'L1', arrival_listing_id: 'L1', check_in_date: '2026-10-01', check_out_date: '2026-10-05', multi_stay: false });
  });

  it('guests: stay[0].guestsCount wins; otherwise adults + children (infants excluded); otherwise null', () => {
    const withCount = mapReservation(reservation({ stay: [{ ...reservation().stay![0], guestsCount: 4 }] }), NOW);
    expect(withCount?.guests).toBe(4);

    const noCount = mapReservation(reservation({ stay: [{ ...reservation().stay![0], guestsCount: undefined }] }), NOW);
    expect(noCount).toMatchObject({ guests: 3, adults: 2, children: 1, infants: 1 });

    const topLevel = mapReservation(
      reservation({
        stay: [{ listingId: 'L1', checkInDateLocalized: '2026-10-01', checkOutDateLocalized: '2026-10-05' }],
        numberOfGuests: { numberOfAdults: 2, numberOfChildren: 2, numberOfInfants: 0 },
      }),
      NOW,
    );
    expect(topLevel).toMatchObject({ guests: 4, adults: 2, children: 2, infants: 0 });

    const nothing = mapReservation(reservation({ stay: [{ listingId: 'L1', checkInDateLocalized: '2026-10-01', checkOutDateLocalized: '2026-10-05' }] }), NOW);
    expect(nothing).toMatchObject({ guests: null, adults: null, children: null, infants: null });
  });

  it('without stay[] the top-level listingId and localized dates are used', () => {
    for (const stay of [undefined, null, [] as never[]]) {
      const r = mapReservation(
        reservation({ stay, listingId: 'L3', checkInDateLocalized: '2026-10-02', checkOutDateLocalized: '2026-10-06', guestsCount: 2, confirmationCode: undefined, source: undefined }),
        NOW,
      );
      expect(r, String(stay)).toMatchObject({ guesty_id: 'r1', listing_id: 'L3', arrival_listing_id: 'L3', check_in_date: '2026-10-02', check_out_date: '2026-10-06', guests: 2, multi_stay: false, confirmation_code: null, source: null });
    }
  });

  it('returns null when the id, the listing or a date is missing', () => {
    expect(mapReservation(reservation({ reservationId: undefined, _id: undefined }), NOW)).toBeNull();
    expect(mapReservation(reservation({ reservationId: '', _id: null }), NOW)).toBeNull();
    expect(mapReservation(reservation({ stay: [{ checkInDateLocalized: '2026-10-01', checkOutDateLocalized: '2026-10-05' }], listingId: null }), NOW)).toBeNull();
    expect(mapReservation(reservation({ stay: [{ listingId: 'L1', checkInDateLocalized: '2026-10-01' }] }), NOW)).toBeNull();
    expect(mapReservation(reservation({ stay: [{ listingId: 'L1', checkOutDateLocalized: '2026-10-05' }] }), NOW)).toBeNull();
    expect(mapReservation(reservation({ stay: undefined, listingId: 'L1' }), NOW)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe('syncListings', () => {
  it('stores every listing with its scope and returns the counts', async () => {
    const repo = new MemoryRepo();
    const client = fake([listing({ _id: 'A' }), listing({ _id: 'K', address: { city: 'Košice' } }), listing({ _id: OWNER_ID })]);
    const r = await syncListings(deps(repo, client));
    expect(r).toMatchObject({ fetched: 3, inScope: 1, removed: 0, applied: true, dropped: 0 });
    const rows = await repo.getListings();
    expect(rows).toHaveLength(3);
    expect(rows.every((x) => x.fetched_at === NOW)).toBe(true);
    expect(await repo.getListing('A')).toMatchObject({ in_scope: true, exclusion_reason: null, beds: { QUEEN_BED: 1, SOFA_BED: 1 } });
    expect(await repo.getListing('K')).toMatchObject({ in_scope: false, exclusion_reason: 'city' });
    expect(await repo.getListing(OWNER_ID)).toMatchObject({ in_scope: false, exclusion_reason: 'owner_id', owner_cleans: true });
  });

  it('Spaces / custom-field calls are made only for listings that could be in scope and only when the listing lacks the data', async () => {
    const bare = { customFields: undefined, listingRooms: undefined };
    const listings = [
      listing({ _id: 'A' }), // complete
      listing({ _id: 'B', ...bare }), // needs both
      listing({ _id: 'C', address: { city: 'Košice' }, ...bare }), // out of scope by city
      listing({ _id: 'D', active: false, ...bare }), // inactive
      listing({ _id: 'E', nickname: 'KE: Byt', ...bare }), // other city by prefix
      listing({ _id: 'F', customFields: undefined }), // only the laundry field is missing
      listing({ _id: 'G', listingRooms: undefined }), // only the beds are missing
    ];
    const repo = new MemoryRepo();
    const s = spy(fake(listings));
    const r = await syncListings(deps(repo, s.client));
    expect(r.applied).toBe(true);
    expect([...s.spaces].sort()).toEqual(['B', 'G']);
    expect([...s.customFields].sort()).toEqual(['B', 'F']);
    expect(r.extraCalls).toEqual({ spaces: 2, customFields: 2 });
    // 1 page of listings + the definitions + the 4 fallbacks, nothing else
    expect(s.client.calls()).toBe(1 + s.defs() + 4);
    expect(s.defs()).toBeLessThanOrEqual(1);
  });

  // SPEC-AMBIGUOUS: PROPOSAL §5 step 1 says "laundry field inline (fallback GET
  // /properties-api/custom-fields/{id})". Reading A: the fallback is consulted whenever
  // the LAUNDRY FIELD is not inline (other inline fields do not count). Reading B: an
  // inline customFields array is authoritative; the endpoint is only for listings with
  // no inline array at all. The sync implements B (no call, so no laundry text here).
  // Whether Guesty omits unset fields from the inline array is a probe question.
  it.skip('inline customFields without the laundry field: the custom-field endpoint is still consulted for it', async () => {
    const repo = new MemoryRepo();
    const s = spy(
      fake([listing({ _id: 'Z', customFields: [{ fieldId: 'cf_door', value: '1234' }] })], {
        customFieldValues: { Z: [{ fieldId: LAUNDRY_FIELD_ID, value: 'Prádlo: súkromné' }] },
      }),
    );
    await syncListings(deps(repo, s.client));
    expect(s.customFields).toEqual(['Z']);
    expect((await repo.getListing('Z'))?.laundry_raw).toBe('Prádlo: súkromné');
  });

  it('fallback data lands in the row: beds and bathrooms from Spaces, laundry (fullText) from the custom-field endpoint', async () => {
    const fullText = 'Paplón veľký: 2\nKapsule: Tchibo Cafissimo\nPoznámka: dlhá poznámka';
    const repo = new MemoryRepo();
    const client = fake([listing({ _id: 'X', customFields: undefined, listingRooms: undefined, bathrooms: undefined })], {
      spaces: { X: { beds: { KING_BED: 1, SINGLE_BED: 2 }, bathrooms: 1.5 } },
      customFieldValues: { X: [{ fieldId: LAUNDRY_FIELD_ID, value: 'Paplón veľký: 2\nKapsule: Tch', fullText }] },
    });
    const r = await syncListings(deps(repo, client));
    expect(r.inScope).toBe(1);
    const row = await repo.getListing('X');
    expect(row).toMatchObject({ beds: { KING_BED: 1, SINGLE_BED: 2 }, beds_source: 'spaces', bathrooms: 1.5, laundry_raw: fullText, in_scope: true });
    expect(row?.laundry?.duvetCounts).toEqual({ large: 2, small: 0 });
  });

  it('account definitions resolve the laundry field by name ("pracovn") and the cleaner by name ("upratov")', async () => {
    const repo = new MemoryRepo();
    const client = fake([listing({ _id: 'Y', customFields: [{ fieldId: 'cf_alt', value: 'Prádlo: súkromné' }, { fieldId: 'cf_clean', value: 'Mária' }] })], {
      customFieldDefs: [
        { fieldId: 'cf_res', displayName: 'Informácie do práčovne', object: 'reservation', type: 'longtext' },
        { fieldId: 'cf_alt', displayName: 'Informácie do práčovne', object: 'listing', type: 'longtext' },
        { fieldId: 'cf_clean', displayName: 'Upratovačka', object: 'listing', type: 'text' },
      ],
    });
    await syncListings(deps(repo, client));
    const row = await repo.getListing('Y');
    expect(row?.laundry_raw).toBe('Prádlo: súkromné');
    expect(row?.laundry?.private).toBe(true);
    expect(row?.cleaner).toBe('Mária');
    expect(row?.in_scope).toBe(true);
  });

  it('custom field definitions are fetched once and cached for a day', async () => {
    const repo = new MemoryRepo();
    const s = spy(fake([listing({ _id: 'A' })], { customFieldDefs: [{ fieldId: 'cf_x', displayName: 'Kód', object: 'listing', type: 'text' }] }));
    await syncListings(deps(repo, s.client, at(NOW)));
    expect(s.defs()).toBe(1);
    expect(await repo.getState('custom_field_defs')).not.toBeNull();
    await syncListings(deps(repo, s.client, at('2026-10-05T18:00:00.000Z')));
    await syncListings(deps(repo, s.client, at('2026-10-06T05:00:00.000Z')));
    expect(s.defs()).toBe(1);
    await syncListings(deps(repo, s.client, at('2026-10-06T07:00:00.000Z')));
    expect(s.defs()).toBe(2);
  });

  it('a listing that vanished from Guesty is marked inactive and out of scope, and comes back when it reappears', async () => {
    const repo = new MemoryRepo();
    const c1 = fake([listing({ _id: 'A' }), listing({ _id: 'B' })]);
    await syncListings(deps(repo, c1));
    const c2 = fake([listing({ _id: 'A' })]);
    const r = await syncListings(deps(repo, c2, at('2026-10-05T07:00:00.000Z')));
    expect(r).toMatchObject({ fetched: 1, inScope: 1, removed: 1, applied: true });
    const b = await repo.getListing('B');
    expect(b).not.toBeNull();
    expect(b?.active).toBe(false);
    expect(b?.in_scope).toBe(false);
    expect(b?.exclusion_reason).toBeTruthy();
    expect((await repo.getListing('A'))?.in_scope).toBe(true);

    const c3 = fake([listing({ _id: 'A' }), listing({ _id: 'B' })]);
    const r3 = await syncListings(deps(repo, c3, at('2026-10-05T08:00:00.000Z')));
    expect(r3).toMatchObject({ fetched: 2, inScope: 2, removed: 0 });
    expect(await repo.getListing('B')).toMatchObject({ active: true, in_scope: true, exclusion_reason: null });
  });

  it('shrink guard: a run that would drop 6 in-scope listings is refused and recorded; 5 are accepted', async () => {
    expect(MAX_IN_SCOPE_DROP).toBe(5);
    // 7 in scope -> 1 left = 6 dropped: refused
    const repo = new MemoryRepo();
    await syncListings(deps(repo, fake(ids(7).map((_id) => listing({ _id })))));
    expect((await repo.getListings()).filter((x) => x.in_scope)).toHaveLength(7);
    const refused = await syncListings(deps(repo, fake([listing({ _id: 'L1' })]), at('2026-10-05T07:00:00.000Z')));
    expect(refused.applied).toBe(false);
    expect(refused.dropped).toBe(6);
    const rows = await repo.getListings();
    expect(rows).toHaveLength(7);
    expect(rows.filter((x) => x.in_scope)).toHaveLength(7);
    expect(rows.every((x) => x.fetched_at === NOW)).toBe(true);
    expect(await repo.getState('listing_drop')).not.toBeNull();

    // 6 in scope -> 1 left = 5 dropped: accepted
    const repo2 = new MemoryRepo();
    await syncListings(deps(repo2, fake(ids(6).map((_id) => listing({ _id })))));
    const ok = await syncListings(deps(repo2, fake([listing({ _id: 'L1' })]), at('2026-10-05T07:00:00.000Z')));
    expect(ok).toMatchObject({ applied: true, removed: 5, inScope: 1 });
    expect((await repo2.getListings()).filter((x) => x.in_scope).map((x) => x.guesty_id)).toEqual(['L1']);
  });

  it('shrink guard: counts listings leaving scope (deactivated) but not out-of-scope listings that vanish', async () => {
    // 7 in scope, 6 of them deactivated -> refused, repo untouched
    const repo = new MemoryRepo();
    await syncListings(deps(repo, fake(ids(7).map((_id) => listing({ _id })))));
    const deactivated = ids(7).map((_id, i) => listing({ _id, active: i === 0 }));
    const refused = await syncListings(deps(repo, fake(deactivated), at('2026-10-05T07:00:00.000Z')));
    expect(refused.applied).toBe(false);
    expect(refused.dropped).toBe(6);
    expect((await repo.getListings()).filter((x) => x.in_scope && x.active)).toHaveLength(7);

    // 6 Košice listings vanish, 1 Bratislava stays -> no in-scope drop, applied
    const repo2 = new MemoryRepo();
    const mixed = [listing({ _id: 'BA' }), ...ids(6, 'KE').map((_id) => listing({ _id, address: { city: 'Košice' } }))];
    await syncListings(deps(repo2, fake(mixed)));
    const ok = await syncListings(deps(repo2, fake([listing({ _id: 'BA' })]), at('2026-10-05T07:00:00.000Z')));
    expect(ok).toMatchObject({ applied: true, dropped: 0, removed: 6, inScope: 1 });
  });

  // SPEC-AMBIGUOUS: PROPOSAL §5 "A run that would drop more than 5 in-scope listings
  // is not applied". Reading A (gross): 6 listings that were in scope leave it -> refused,
  // whatever else arrives. Reading B (net): the in-scope COUNT shrinks by more than 5.
  // The sync implements B (previous - next), so a run in which 6 flats leave scope and
  // 6 unknown flats enter it is applied. Skipped; the reviewer decides which reading holds.
  it.skip('shrink guard counts listings that leave scope even when new in-scope listings arrive in the same run', async () => {
    const repo = new MemoryRepo();
    await syncListings(deps(repo, fake(ids(7).map((_id) => listing({ _id })))));
    const swapped = [listing({ _id: 'L1' }), ...ids(6, 'NEW').map((_id) => listing({ _id }))];
    const r = await syncListings(deps(repo, fake(swapped), at('2026-10-05T07:00:00.000Z')));
    expect(r.dropped).toBe(6);
    expect(r.applied).toBe(false);
    expect((await repo.getListings()).filter((x) => x.in_scope).map((x) => x.guesty_id).sort()).toEqual(ids(7).sort());
  });

  it('an empty listing response is an error, not a wipe of the table', async () => {
    const repo = new MemoryRepo();
    await syncListings(deps(repo, fake([listing({ _id: 'A' })])));
    await expect(syncListings(deps(repo, fake([]), at('2026-10-05T07:00:00.000Z')))).rejects.toThrow();
    expect(await repo.getListing('A')).toMatchObject({ in_scope: true, active: true });
  });
});
