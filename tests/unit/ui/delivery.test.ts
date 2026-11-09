import { describe, expect, it } from 'vitest';
import { deliveredInOrder, deliveryLine, isYearMonth, monthRange, type DeliveryRequest } from '@/app/_lib/delivery';

const r = (id: string, text: string, delivered_at: string | null, listing_name: string | null = null): DeliveryRequest => ({
  id,
  date: '2026-11-09',
  listing_id: listing_name,
  listing_name,
  text,
  author: null,
  author_name: 'Eva',
  created_at: '2026-11-09T07:00:00Z',
  delivered_at,
  delivered_by_name: delivered_at ? 'Angelika' : null,
});

describe('Vyúčtovanie (Martina, 2026-11-09)', () => {
  it('lists the delivered requests in the order they were ticked; undelivered stay out', () => {
    const rows = deliveredInOrder([r('b', 'Žižkova – 1× vankúš', '2026-11-20T09:00:00Z'), r('a', 'Poštová Heart – 2× osuška', '2026-11-05T09:00:00Z'), r('x', 'nedodané', null)]);
    expect(rows.map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('the flat is in the text; older rows with a picked flat show it in front', () => {
    expect(deliveryLine(r('a', 'Poštová Heart – 2× osuška', null))).toBe('Poštová Heart – 2× osuška');
    expect(deliveryLine(r('b', '2× osuška', null, 'Bajkalská, Luxe'))).toBe('Bajkalská, Luxe: 2× osuška');
  });

  it('a month runs from its first day to the first day of the next, December into January', () => {
    expect(monthRange('2026-11')).toEqual({ from: '2026-11-01', to: '2026-12-01' });
    expect(monthRange('2026-12')).toEqual({ from: '2026-12-01', to: '2027-01-01' });
    expect(['2026-11', '2026-13', '2026-1', '', null].map((x) => isYearMonth(x))).toEqual([true, false, false, false, false]);
  });
});
