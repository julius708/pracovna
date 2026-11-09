import { describe, expect, it } from 'vitest';
import { billingByFlat, isYearMonth, monthRange, type DeliveryRequest } from '@/app/_lib/delivery';

const r = (id: string, listing_name: string, delivered_at: string | null): DeliveryRequest => ({
  id,
  date: '2026-11-09',
  listing_id: listing_name,
  listing_name,
  text: id,
  author: null,
  author_name: 'Eva',
  created_at: '2026-11-09T07:00:00Z',
  delivered_at,
  delivered_by_name: delivered_at ? 'Angelika' : null,
});

describe('Vyúčtovanie (Martina, 2026-11-09)', () => {
  it('groups the delivered requests by flat, flats by name, items by delivery time; undelivered stay out', () => {
    const groups = billingByFlat([r('b2', 'Žižkova', '2026-11-20T09:00:00Z'), r('a1', 'Antolská', '2026-11-05T09:00:00Z'), r('b1', 'Žižkova', '2026-11-03T09:00:00Z'), r('x', 'Antolská', null)]);
    expect(groups.map((g) => [g.listing_name, g.items.map((i) => i.id)])).toEqual([
      ['Antolská', ['a1']],
      ['Žižkova', ['b1', 'b2']],
    ]);
  });

  it('a month runs from its first day to the first day of the next, December into January', () => {
    expect(monthRange('2026-11')).toEqual({ from: '2026-11-01', to: '2026-12-01' });
    expect(monthRange('2026-12')).toEqual({ from: '2026-12-01', to: '2027-01-01' });
    expect(['2026-11', '2026-13', '2026-1', '', null].map((x) => isYearMonth(x))).toEqual([true, false, false, false, false]);
  });
});
