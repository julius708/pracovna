import { loadPackingLog } from '@/app/_lib/admin';
import { csvField } from '@/app/_lib/csv';
import { historyFilterFrom } from '@/app/_lib/history-filter';
import { SNAPSHOT_COLUMNS, snapshotCells, statusNote } from '@/app/_lib/packing-log';
import { getViewer } from '@/app/_lib/viewer';
import { addDays, formatHM, todayInTz, WINDOW_DAYS } from '@/core/packing';

export const dynamic = 'force-dynamic';

/** CSV of the packing history: one row per packed card, one column per item (UTF-8 with BOM, semicolons). */
export async function GET(req: Request) {
  const viewer = await getViewer();
  if (!viewer || viewer.role !== 'admin') return new Response('unauthorized', { status: 401 });
  const url = new URL(req.url);
  const today = todayInTz(new Date());
  const filter = historyFilterFrom((k) => url.searchParams.get(k), today, { to: addDays(today, WINDOW_DAYS - 1) });
  const header = ['den_balenia', 'byt', 'zabalil', 'zabalene_kedy', 'osoby', ...SNAPSHOT_COLUMNS, 'kapsule', 'sukromne_pradlo', 'stav_teraz', 'zdroj_poctov', 'package_id', 'listing_id'];
  const rows: string[] = [header.map(csvField).join(';')];
  for (let page = 1; page <= 50; page++) {
    const view = await loadPackingLog({ ...filter, page });
    for (const e of view.rows) {
      const when = `${todayInTz(new Date(e.created_at))} ${formatHM(new Date(e.created_at))}`;
      const cells = [
        e.package_date,
        e.listing_name,
        e.actor_name,
        when,
        e.snapshot?.people ?? '',
        ...snapshotCells(e.snapshot),
        e.snapshot?.private ? 'áno' : '',
        statusNote(e.status, e.superseded) ?? 'zabalené',
        e.exact ? 'karta pri zabalení' : 'aktuálna karta',
        e.package_id,
        e.listing_id,
      ];
      rows.push(cells.map(csvField).join(';'));
    }
    if (!view.hasMore) break;
  }
  return new Response(`﻿${rows.join('\r\n')}\r\n`, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="pracovna-zabalene-${today}.csv"`,
      'cache-control': 'no-store',
    },
  });
}
