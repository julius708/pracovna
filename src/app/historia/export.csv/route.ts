import { loadHistory } from '@/app/_lib/admin';
import { csvField } from '@/app/_lib/csv';
import { historyFilterFrom } from '@/app/_lib/history-filter';
import { getViewer } from '@/app/_lib/viewer';
import { todayInTz } from '@/core/packing';

export const dynamic = 'force-dynamic';

/** CSV of the filtered events (UTF-8 with BOM, semicolon separated, Excel-friendly). */
export async function GET(req: Request) {
  const viewer = await getViewer();
  if (!viewer || viewer.role !== 'admin') return new Response('unauthorized', { status: 401 });
  const url = new URL(req.url);
  const today = todayInTz(new Date());
  const filter = historyFilterFrom((k) => url.searchParams.get(k), today);
  const rows: string[] = ['cas;datum_balenia;byt;udalost;kto;detail;package_id;listing_id'];
  for (let page = 1; page <= 50; page++) {
    const view = await loadHistory({ ...filter, page });
    for (const e of view.rows) {
      rows.push([e.created_at, e.package_date, e.listing_name, e.event, e.actor_name, e.data, e.package_id, e.listing_id].map(csvField).join(';'));
    }
    if (!view.hasMore) break;
  }
  return new Response(`﻿${rows.join('\r\n')}\r\n`, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="pracovna-historia-${today}.csv"`,
      'cache-control': 'no-store',
    },
  });
}
