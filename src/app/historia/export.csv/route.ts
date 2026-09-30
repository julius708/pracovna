import { loadHistory } from '@/app/_lib/admin';
import { getViewer } from '@/app/_lib/viewer';
import { addDays, todayInTz } from '@/core/packing';

export const dynamic = 'force-dynamic';

function csvField(v: unknown): string {
  const s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV of the filtered events (UTF-8 with BOM, semicolon separated, Excel-friendly). */
export async function GET(req: Request) {
  const viewer = await getViewer();
  if (!viewer || viewer.role !== 'admin') return new Response('unauthorized', { status: 401 });
  const url = new URL(req.url);
  const today = todayInTz(new Date());
  const rows: string[] = ['cas;datum_balenia;byt;udalost;kto;detail;package_id;listing_id'];
  for (let page = 1; page <= 50; page++) {
    const view = await loadHistory({
      from: url.searchParams.get('od') || addDays(today, -7),
      to: url.searchParams.get('do') || today,
      listingId: url.searchParams.get('byt') || undefined,
      actor: url.searchParams.get('osoba') || undefined,
      event: url.searchParams.get('udalost') || undefined,
      page,
    });
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
