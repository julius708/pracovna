/**
 * Shapes recorded from the real Guesty Open API on 2026-10-02 (pnpm probe):
 *  - GET /reservations-v3?reservationIds[]=a&reservationIds[]=b (bracket syntax; a comma-joined
 *    value answers 400 "reservationIds must be an array"); the result is a plain array whose
 *    stay segments carry unitTypeId (= the listing) and unitId, but no listingId;
 *  - GET /reservations-v3/search answers {results, pagination} and its stay segments carry listingId;
 *  - the calendar batch answers {status, data: {days: [...]}, message} with listingId on each day.
 */
import { describe, expect, it } from 'vitest';
import { extractCalendarDays } from '@/guesty/endpoints/calendar';
import { getReservationsByIds } from '@/guesty/endpoints/reservations';
import { GuestyHttp } from '@/guesty/http';
import { mapReservation } from '@/guesty/mappers';
import { calendarDaySchema, parseMany, reservationSchema } from '@/guesty/schemas';

const byIdsShape = (id: string, unitTypeId: string, unitId: string) => ({
  _id: id,
  accountId: 'acc',
  bookingDate: '2026-09-12T09:08:31.000Z',
  confirmationCode: 'BC-1',
  confirmedAt: '2026-09-12T09:08:31.000Z',
  createdAt: '2026-09-12T09:08:31.000Z',
  guestStay: { status: 'pending', createdAt: 'x', updatedAt: 'x' },
  platform: 'bookingCom',
  source: 'Booking.com',
  status: 'confirmed',
  stay: [
    {
      checkInDateLocalized: '2026-10-03',
      checkOutDateLocalized: '2026-10-04',
      guestsCount: 4,
      numberOfGuests: { numberOfAdults: 2, numberOfChildren: 2, numberOfInfants: 0 },
      unitTypeId,
      unitId,
      eta: '15:00',
      etd: '11:00',
    },
  ],
  unifiedId: 'u1',
});

const searchShape = (id: string, listingId: string) => ({
  reservationId: id,
  confirmationCode: 'BC-1',
  status: 'confirmed',
  checkIn: '2026-10-03T13:00:00.000Z',
  checkOut: '2026-10-04T09:00:00.000Z',
  checkInDateLocalized: '2026-10-03',
  checkOutDateLocalized: '2026-10-04',
  source: 'Booking.com',
  channel: 'bookingCom',
  createdAt: '2026-09-12T09:08:31.000Z',
  bookingDate: '2026-09-12T09:08:31.000Z',
  stay: [
    {
      listingId,
      checkIn: '2026-10-03T13:00:00.000Z',
      checkOut: '2026-10-04T09:00:00.000Z',
      checkInDateLocalized: '2026-10-03',
      checkOutDateLocalized: '2026-10-04',
      guestsCount: 4,
      numberOfGuests: { numberOfAdults: 2, numberOfChildren: 2, numberOfInfants: 0 },
    },
  ],
  guestStay: { status: 'pending', createdAt: 'x', updatedAt: 'x' },
  unifiedId: 'u1',
});

describe('reservations by ids', () => {
  it('sends reservationIds[] once per id, at most 10 per request, and parses the plain array answer', async () => {
    const urls: string[] = [];
    const fetchFn = (async (input: string | URL | Request) => {
      const url = String(input);
      urls.push(url);
      const ids = [...new URL(url).searchParams.entries()].filter(([k]) => k === 'reservationIds[]').map(([, v]) => v);
      return new Response(JSON.stringify(ids.map((id) => byIdsShape(id, 'L1', 'L1'))), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    const http = new GuestyHttp(async () => 'token', { fetch: fetchFn });
    const ids = Array.from({ length: 12 }, (_, i) => `6aa516eb4b0afa5c8ca1c9${String(i).padStart(2, '0')}`);
    const parsed = await getReservationsByIds(http, ids);
    expect(urls).toHaveLength(2);
    for (const u of urls) {
      const params = [...new URL(u).searchParams.entries()];
      expect(params.every(([k]) => k === 'reservationIds[]')).toBe(true);
      expect(params.every(([, v]) => !v.includes(','))).toBe(true);
    }
    expect(new URL(urls[0]).searchParams.getAll('reservationIds[]')).toHaveLength(10);
    expect(new URL(urls[1]).searchParams.getAll('reservationIds[]')).toHaveLength(2);
    expect(parsed.map((r) => r._id)).toEqual(ids);
  });
});

describe('reservation mapper on the real shapes', () => {
  it('by-ids shape: the listing is the unitTypeId, dates and guests come from the stay segment', () => {
    const row = mapReservation(reservationSchema.parse(byIdsShape('R1', 'TYPE1', 'UNIT1')), '2026-10-02T10:00:00.000Z');
    expect(row).toMatchObject({
      guesty_id: 'R1',
      listing_id: 'TYPE1',
      arrival_listing_id: 'TYPE1',
      status: 'confirmed',
      check_in_date: '2026-10-03',
      check_out_date: '2026-10-04',
      guests: 4,
      adults: 2,
      children: 2,
      infants: 0,
      multi_stay: false,
    });
  });

  it('search shape: the listing is stay[0].listingId; both shapes of the same reservation map to the same row', () => {
    const a = mapReservation(reservationSchema.parse(searchShape('R1', 'TYPE1')), '2026-10-02T10:00:00.000Z');
    const b = mapReservation(reservationSchema.parse(byIdsShape('R1', 'TYPE1', 'TYPE1')), '2026-10-02T10:00:00.000Z');
    expect(a?.listing_id).toBe('TYPE1');
    expect(a).toEqual(b);
  });

  it('a stay over two unit types is a multi-listing reservation whose package belongs to the last listing', () => {
    const raw = byIdsShape('R2', 'TYPE1', 'UNIT1');
    raw.stay.push({ ...raw.stay[0], unitTypeId: 'TYPE2', unitId: 'UNIT2', checkInDateLocalized: '2026-10-04', checkOutDateLocalized: '2026-10-06' });
    const row = mapReservation(reservationSchema.parse(raw), '2026-10-02T10:00:00.000Z');
    expect(row).toMatchObject({ listing_id: 'TYPE2', arrival_listing_id: 'TYPE1', check_in_date: '2026-10-03', check_out_date: '2026-10-06', multi_stay: true });
  });
});

describe('calendar batch on the real shape', () => {
  it('reads data.days with listingId, minNights, status and cta', () => {
    const json = {
      status: 200,
      data: {
        days: [
          { date: '2026-10-02', listingId: 'L1', currency: 'EUR', price: 74, minNights: 2, status: 'booked', blocks: { b: true }, cta: false, ctd: false },
          { date: '2026-10-03', listingId: 'L1', currency: 'EUR', price: 90, minNights: 2, status: 'available', blocks: {}, cta: true, ctd: false },
          { date: '2026-10-02', listingId: 'L2', currency: 'EUR', price: 60, minNights: 1, status: 'unavailable', blocks: { m: true }, cta: false, ctd: false },
        ],
      },
      message: 'ok',
    };
    const days = parseMany(calendarDaySchema, extractCalendarDays(json));
    expect(days.map((d) => [d.listingId, d.date, d.minNights, d.status, d.cta])).toEqual([
      ['L1', '2026-10-02', 2, 'booked', false],
      ['L1', '2026-10-03', 2, 'available', true],
      ['L2', '2026-10-02', 1, 'unavailable', false],
    ]);
  });
});
