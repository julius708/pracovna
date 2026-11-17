import { csvField } from '@/app/_lib/csv';
import { loadStock } from '@/app/_lib/sklad';
import { itemLabel } from '@/app/_lib/sklad-ui';
import { getViewer } from '@/app/_lib/viewer';

export const dynamic = 'force-dynamic';

/** CSV of one approved order for the supplier. A file is not a sent order: the status stays "neodoslané" until it is marked sent. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const viewer = await getViewer();
  if (!viewer || !viewer.active || viewer.role !== 'admin') return new Response('unauthorized', { status: 401 });
  const { id } = await ctx.params;
  const v = await loadStock(viewer);
  const o = v.orders.find((x) => x.id === id);
  if (!o) return new Response('not found', { status: 404 });
  if (o.status === 'draft' || o.status === 'review') return new Response('order not approved', { status: 409 });
  const item = new Map(v.items.map((i) => [i.id, i]));
  const sku = new Map(v.skus.map((s) => [s.id, s]));
  const out = [['dodavatel', 'sku_dodavatela', 'polozka', 'jednotky', 'nakupna_jednotka', 'kusov_v_baleni', 'cena_za_jednotku', 'mena', 'dodavka_do'].map(csvField).join(';')];
  for (const l of o.lines) {
    out.push([o.supplier, sku.get(l.skuId)?.sku ?? '', item.get(l.itemId) ? itemLabel(item.get(l.itemId)!) : l.itemId, l.finalUnits, l.purchaseUnit === 'carton' ? 'kartón' : 'balenie', l.piecesPerPack, l.priceCents === null ? '' : (l.priceCents / 100).toFixed(2), l.currency, o.deliveryTargetDate ?? ''].map(csvField).join(';'));
  }
  return new Response(`﻿${out.join('\r\n')}\r\n`, {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="objednavka-${o.id.slice(0, 8)}.csv"`, 'cache-control': 'no-store' },
  });
}
