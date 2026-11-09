import { loadDelivered } from '@/app/_lib/admin';
import { csvField } from '@/app/_lib/csv';
import { deliveredInOrder, deliveryLine, isYearMonth } from '@/app/_lib/delivery';
import { getViewer } from '@/app/_lib/viewer';
import { formatHM, todayInTz } from '@/core/packing';

export const dynamic = 'force-dynamic';

/** CSV of "Vyúčtovanie": one row per delivered request of the month, in delivery order (UTF-8 with BOM, semicolons). */
export async function GET(req: Request) {
  const viewer = await getViewer();
  if (!viewer || viewer.role !== 'admin') return new Response('unauthorized', { status: 401 });
  const asked = new URL(req.url).searchParams.get('mesiac');
  const ym = isYearMonth(asked) ? asked : todayInTz(new Date()).slice(0, 7);
  const rows: string[] = [['dodane_kedy', 'den_balenia', 'zapis', 'dodal', 'zapisal'].map(csvField).join(';')];
  for (const r of deliveredInOrder(await loadDelivered(ym))) {
    const when = r.delivered_at ? `${todayInTz(new Date(r.delivered_at))} ${formatHM(new Date(r.delivered_at))}` : '';
    rows.push([when, r.date, deliveryLine(r), r.delivered_by_name ?? '', r.author_name].map(csvField).join(';'));
  }
  return new Response(`\uFEFF${rows.join('\r\n')}\r\n`, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="pracovna-vyuctovanie-${ym}.csv"`,
      'cache-control': 'no-store',
    },
  });
}
