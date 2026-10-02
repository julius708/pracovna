import { describe, expect, it } from 'vitest';
import { historyFilterFrom } from '@/app/_lib/history-filter';

describe('historyFilterFrom', () => {
  const today = '2026-10-02';
  const from = (q: Record<string, string>) => historyFilterFrom((k) => q[k], today);

  it('defaults to the last 7 days, all listings/people/events, page 1', () => {
    expect(from({})).toEqual({ from: '2026-09-25', to: '2026-10-02', listingId: undefined, actor: undefined, event: undefined, page: 1 });
  });

  it('keeps valid dates and the other filters', () => {
    expect(from({ od: '2026-09-01', do: '2026-09-10', byt: 'L1', osoba: 'Eva', udalost: 'packed', strana: '3' })).toEqual({
      from: '2026-09-01',
      to: '2026-09-10',
      listingId: 'L1',
      actor: 'Eva',
      event: 'packed',
      page: 3,
    });
  });

  it('replaces malformed, impossible or out-of-range dates with the defaults (no 500, no silent empty list)', () => {
    expect(from({ od: 'abc', do: '2026-02-30' })).toMatchObject({ from: '2026-09-25', to: '2026-10-02' });
    expect(from({ od: "2026-09-01' or 1=1" })).toMatchObject({ from: '2026-09-25' });
    // 9999-12-31 + 1 day would leave four-digit years and break the day arithmetic
    expect(from({ do: '9999-12-31' })).toMatchObject({ to: '2026-10-02' });
    expect(from({ od: '1999-12-31' })).toMatchObject({ from: '2026-09-25' });
    expect(from({ od: '2000-01-01', do: '2099-12-31' })).toMatchObject({ from: '2000-01-01', to: '2099-12-31' });
  });

  it('swaps a reversed range', () => {
    expect(from({ od: '2026-09-10', do: '2026-09-01' })).toMatchObject({ from: '2026-09-01', to: '2026-09-10' });
  });

  it('page is at least 1', () => {
    expect(from({ strana: '0' }).page).toBe(1);
    expect(from({ strana: '-4' }).page).toBe(1);
    expect(from({ strana: 'x' }).page).toBe(1);
  });

  it('empty strings mean "all"', () => {
    expect(from({ byt: '', osoba: '', udalost: '' })).toMatchObject({ listingId: undefined, actor: undefined, event: undefined });
  });
});
