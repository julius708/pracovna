import { csvField } from '@/app/_lib/csv';
import { itemLabel } from '@/app/_lib/sklad-ui';
import { getViewer } from '@/app/_lib/viewer';
import { loadStock } from '@/app/_lib/sklad';
import { monthlyConsumption, type ReportMovement } from '@/core/stock';

export const dynamic = 'force-dynamic';

/** CSV of the monthly issue report (no person columns by design). */
export async function GET(req: Request) {
  const viewer = await getViewer();
  if (!viewer || !viewer.active || viewer.role !== 'admin') return new Response('unauthorized', { status: 401 });
  const asked = new URL(req.url).searchParams.get('mesiac') ?? '';
  const ym = /^\d{4}-(0[1-9]|1[0-2])$/.test(asked) ? asked : new Date().toISOString().slice(0, 7);
  const v = await loadStock(viewer, { movementsSince: `${ym}-01T00:00:00Z`, movementLimit: 20000 });
  const wh = new Map(v.warehouses.map((w) => [w.id, w]));
  const name = new Map(v.items.map((i) => [i.id, itemLabel(i)]));
  const mv: ReportMovement[] = v.movements.map((m) => ({ ...m, city: wh.get(m.warehouseId)?.city ?? '—' }));
  const out = [['mesiac', 'mesto', 'sklad', 'byt', 'karta', 'vydane', 'vratene', 'cisty_vydaj', 'naklad_eur'].map(csvField).join(';')];
  for (const r of monthlyConsumption(mv, v.items, v.skus).filter((x) => x.month === ym)) {
    out.push([r.month, r.city, wh.get(r.warehouseId)?.name ?? '', r.listingId ?? '', name.get(r.itemId) ?? r.itemId, r.issued, r.returned, r.netIssue, r.costCents === null ? 'Neoverené' : (r.costCents / 100).toFixed(2)].map(csvField).join(';'));
  }
  return new Response(`﻿${out.join('\r\n')}\r\n`, {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="pracovna-sklad-spotreba-${ym}.csv"`, 'cache-control': 'no-store' },
  });
}
