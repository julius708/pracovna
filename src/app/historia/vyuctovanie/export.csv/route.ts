import { loadDelivered } from '@/app/_lib/admin';
import { csvField } from '@/app/_lib/csv';
import { billingByFlat, isYearMonth } from '@/app/_lib/delivery';
import { getViewer } from '@/app/_lib/viewer';
import { formatHM, todayInTz } from '@/core/packing';

export const dynamic = 'force-dynamic';

/** CSV of "Vyúčtovanie": one row per delivered request of the month, by flat (UTF-8 with BOM, semicolons). */
export async function GET(req: Request) {
  const viewer = await getViewer();
  if (!viewer || viewer.role !== 'admin') return new Response('unauthorized', { status: 401 });
  const asked = new URL(req.url).searchParams.get('mesiac');
  const ym = isYearMonth(asked) ? asked : todayInTz(new Date()).slice(0, 7);
  const rows: string[] = [['byt', 'den_balenia', 'polozky', 'dodal', 'dodane_kedy', 'zapisal', 'listing_id'].map(csvField).join(';')];
  for (const g of billingByFlat(await loadDelivered(ym))) {
    for (const r of g.items) {
      const when = r.delivered_at ? `${todayInTz(new Date(r.delivered_at))} ${formatHM(new Date(r.delivered_at))}` : '';
      rows.push([g.listing_name, r.date, r.text, r.delivered_by_name ?? '', when, r.author_name, r.listing_id].map(csvField).join(';'));
    }
  }
  return new Response(`\uFEFF${rows.join('\r\n')}\r\n`, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="pracovna-vyuctovanie-${ym}.csv"`,
      'cache-control': 'no-store',
    },
  });
}
