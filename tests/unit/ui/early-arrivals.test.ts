import { describe, expect, it } from 'vitest';
import type { EarlyArrival } from '@/app/_lib/board';
import { arrivalFor, arrivalNotices, isArrivalTime, sortArrivals } from '@/ui/board-model';
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
    author: over.author ?? 'u-julius',
    author_name: over.author_name ?? 'Július',
    created_at: over.created_at ?? '2026-10-11T08:00:00Z',
  };
}

describe('early arrivals, typed in (owner, 2026-10-11; Martina, 2026-10-19)', () => {
  it('accepts only HH:MM times', () => {
    expect(['12:00', '00:00', '23:59', '09:05'].every(isArrivalTime)).toBe(true);
    expect(['24:00', '12:60', '9:00', '12', '', 'ráno', '12:00:00'].some(isArrivalTime)).toBe(false);
  });

  it('a card shows the arrival recorded for its flat on its day only', () => {
    const a = arrival();
    expect(arrivalFor([a], { listing_id: a.listing_id, date: '2026-10-12' })).toBe(a);
    expect(arrivalFor([a], { listing_id: a.listing_id, date: '2026-10-13' })).toBeNull();
    expect(arrivalFor([a], { listing_id: 'other', date: '2026-10-12' })).toBeNull();
  });

  it('a new entry by someone else is announced with the flat, the time and the day; my own is not', () => {
    const mine = arrival({ id: 'm', author_name: 'Angelika' });
    const theirs = arrival({ id: 't', arrival: '13:30', date: '2026-10-11' });
    expect(arrivalNotices([], [mine, theirs], 'Angelika', new Set(), DATES, day)).toEqual(['⏰ Skorý príchod: Poštová, Heart o 13:30 · Dnes 11.10.']);
    expect(arrivalNotices([mine, theirs], [mine, theirs], 'Angelika', new Set(), DATES, day)).toEqual([]);
  });

  it('a removed entry is announced unless this device removed it; optimistic temp rows never are', () => {
    const a = arrival({ id: 'a' });
    const temp = arrival({ id: 'temp-1' });
    expect(arrivalNotices([a, temp], [], 'Max', new Set(), DATES, day)).toEqual(['Skorý príchod odstránený: Poštová, Heart · Zajtra 12.10.']);
    expect(arrivalNotices([a], [], 'Max', new Set(['a']), DATES, day)).toEqual([]);
    expect(sk.earlyArrivals.cardLine('12:00')).toBe('⏰ Skorý príchod o 12:00 – hosť môže byť v byte skôr');
  });

  it("yesterday's entry falling out of the window at midnight is not a removal", () => {
    const yesterday = arrival({ id: 'y', date: '2026-10-10' });
    const rolled = ['2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17'];
    expect(arrivalNotices([yesterday], [], 'Max', new Set(), rolled, day)).toEqual([]);
  });

  it('the list keeps the board order by day, time and creation', () => {
    const late = arrival({ id: 'l', arrival: '13:30', created_at: '2026-10-11T08:00:00Z' });
    const early = arrival({ id: 'e', arrival: '12:00', created_at: '2026-10-11T09:00:00Z' });
    const nextDay = arrival({ id: 'n', date: '2026-10-13', arrival: '09:00' });
    expect(sortArrivals([nextDay, late, early]).map((a) => a.id)).toEqual(['e', 'l', 'n']);
  });
});
