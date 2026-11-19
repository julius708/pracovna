import { describe, expect, it } from 'vitest';
import { loadCleanedStatus } from '@/app/_lib/board';
import { cleanedFor } from '@/ui/board-model';
import { cleanedLine } from '@/core/i18n/sk';

const dates = ['2026-11-19', '2026-11-20', '2026-11-21'];
const rpcOk = (data: unknown) => ({ rpc: async () => ({ data, error: null }) });

describe('Upratané v Práčovni (stav z hlavnej appky)', () => {
  it('berie len začaté a dokončené upratovania a skracuje dátum', async () => {
    const r = await loadCleanedStatus(
      rpcOk([
        { listing_id: 'L1', date: '2026-11-19', status: 'done', cleaner_name: 'Anna', started_at: 'a', finished_at: 'b', has_problem: false },
        { listing_id: 'L2', date: '2026-11-19T00:00:00', status: 'in_progress', cleaner_name: null, started_at: 'a', finished_at: null, has_problem: true },
        { listing_id: 'L3', date: '2026-11-19', status: 'todo', cleaner_name: 'X', started_at: null, finished_at: null, has_problem: false },
      ]),
      dates,
    );
    expect(r.map((x) => [x.listing_id, x.status, x.date, x.has_problem])).toEqual([['L1', 'done', '2026-11-19', false], ['L2', 'in_progress', '2026-11-19', true]]);
  });

  it('nikdy nezhodí tabuľu: chýbajúca funkcia, chyba aj výnimka dajú prázdny zoznam', async () => {
    expect(await loadCleanedStatus({ rpc: async () => ({ data: null, error: { message: 'Could not find the function' } }) }, dates)).toEqual([]);
    expect(await loadCleanedStatus(rpcOk({ not: 'array' }), dates)).toEqual([]);
    expect(await loadCleanedStatus({ rpc: async () => { throw new Error('boom'); } }, dates)).toEqual([]);
  });

  it('volá funkciu s prvým a posledným dňom tabule', async () => {
    let args: unknown;
    await loadCleanedStatus({ rpc: async (_f, a) => { args = a; return { data: [], error: null }; } }, dates);
    expect(args).toEqual({ p_from: '2026-11-19', p_to: '2026-11-21' });
  });

  it('karta nájde svoj byt a deň; text je po slovensky', () => {
    const list = [{ listing_id: 'L1', date: '2026-11-19', status: 'done' as const, cleaner_name: 'Anna', started_at: null, finished_at: null, has_problem: false }];
    expect(cleanedFor(list, { listing_id: 'L1', date: '2026-11-19' })).toBe(list[0]);
    expect(cleanedFor(list, { listing_id: 'L1', date: '2026-11-20' })).toBeNull();
    expect(cleanedFor(list, { listing_id: 'L2', date: '2026-11-19' })).toBeNull();
    expect(cleanedLine('done', 'Anna', '10:42')).toBe('Upratané · Anna · 10:42');
    expect(cleanedLine('in_progress', null, '09:05')).toBe('Upratuje sa · od 09:05');
  });
});
