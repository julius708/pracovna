import { describe, expect, it } from 'vitest';
import type { EarlyArrival } from '@/app/_lib/board';
import { arrivalFor, arrivalNotices } from '@/ui/board-model';
import { sk } from '@/core/i18n/sk';

const day = (d: string) => (d === '2026-10-11' ? 'Dnes 11.10.' : 'Zajtra 12.10.');
const DATES = ['2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17'];

function arrival(over: Partial<EarlyArrival> = {}): EarlyArrival {
  return {
    id: over.id ?? 'a1',
    listing_id: over.listing_id ?? '69e7584bd6397b001423638a',
    listing_name: over.listing_name ?? 'Poštová, Heart',
    date: over.date ?? '2026-10-12',
    arrival: over.arrival ?? '12:00',
    note: over.note ?? '',
    author: null,
    author_name: 'Guesty',
    created_at: over.created_at ?? '2026-10-11T08:00:00Z',
  };
}

describe('early arrivals on the board (owner, 2026-10-11)', () => {
  it('a card shows the arrival recorded for its flat on its day only', () => {
    const a = arrival();
    expect(arrivalFor([a], { listing_id: a.listing_id, date: '2026-10-12' })).toBe(a);
    expect(arrivalFor([a], { listing_id: a.listing_id, date: '2026-10-13' })).toBeNull();
    expect(arrivalFor([a], { listing_id: 'other', date: '2026-10-12' })).toBeNull();
    expect(sk.earlyArrivals.cardLine('12:00')).toBe('⏰ Skorý príchod o 12:00 – hosť môže byť v byte skôr');
  });

  it('a new entry from Guesty is announced with the flat, the time and the day', () => {
    const a = arrival({ id: 't', arrival: '13:30', date: '2026-10-11' });
    expect(arrivalNotices([], [a], DATES, day)).toEqual(['⏰ Skorý príchod: Poštová, Heart o 13:30 · Dnes 11.10.']);
    expect(arrivalNotices([a], [a], DATES, day)).toEqual([]);
  });

  it('an entry Guesty withdrew is announced as cancelled; a changed time reads as cancelled plus new', () => {
    const a = arrival({ id: 'a' });
    const b = arrival({ id: 'b', arrival: '11:00' });
    expect(arrivalNotices([a], [], DATES, day)).toEqual(['Skorý príchod zrušený: Poštová, Heart · Zajtra 12.10.']);
    expect(arrivalNotices([a], [b], DATES, day)).toEqual(['⏰ Skorý príchod: Poštová, Heart o 11:00 · Zajtra 12.10.', 'Skorý príchod zrušený: Poštová, Heart · Zajtra 12.10.']);
  });

  it("yesterday's entry falling out of the window at midnight is not a cancellation", () => {
    const yesterday = arrival({ id: 'y', date: '2026-10-10' });
    expect(arrivalNotices([yesterday], [], DATES, day)).toEqual([]);
  });
});
