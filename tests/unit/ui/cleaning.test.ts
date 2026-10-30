import { describe, expect, it } from 'vitest';
import { cleaningInfoFlats, cleaningRights } from '@/app/_lib/cleaning';

describe('Info pre upratovačov (Martina, 2026-10-30)', () => {
  it('rights follow the LIVE-IN app roles', () => {
    expect(cleaningRights(['cleaning'])).toEqual({ read: true, write: false, tick: true, admin: false });
    expect(cleaningRights(['customer_service'])).toEqual({ read: true, write: true, tick: true, admin: false });
    expect(cleaningRights(['operations'])).toEqual({ read: true, write: false, tick: false, admin: false });
    expect(cleaningRights(['admin', 'pricing_it'])).toEqual({ read: true, write: true, tick: true, admin: true });
    expect(cleaningRights(['marketing'])).toEqual({ read: false, write: false, tick: false, admin: false });
    expect(cleaningRights([])).toEqual({ read: false, write: false, tick: false, admin: false });
  });

  it("only the day's check-out flats with a Guesty note show, once each, by name; cancelled cards and empty notes do not", () => {
    const p = (listing_id: string, listing_name: string, date = '2026-10-31', status = 'todo') => ({ listing_id, listing_name, date, status });
    const info = { L1: 'Kúrenie max. na 3', L2: '  ', L3: 'Kľúč v zásuvke', L4: 'Iný deň', L5: 'Zrušené' };
    const flats = cleaningInfoFlats([p('L3', 'Žižkova'), p('L1', 'E. Wenzla, Business'), p('L1', 'E. Wenzla, Business'), p('L2', 'Prázdne'), p('L4', 'Iný', '2026-11-01'), p('L5', 'Zrušený', '2026-10-31', 'cancelled'), p('L6', 'Bez info')], info, '2026-10-31');
    expect(flats).toEqual([
      { listing_id: 'L1', listing_name: 'E. Wenzla, Business', info: 'Kúrenie max. na 3' },
      { listing_id: 'L3', listing_name: 'Žižkova', info: 'Kľúč v zásuvke' },
    ]);
  });
});
