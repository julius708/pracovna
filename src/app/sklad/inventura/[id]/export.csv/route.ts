import { csvField } from '@/app/_lib/csv';
import { loadInventory, loadStock } from '@/app/_lib/sklad';
import { itemLabel } from '@/app/_lib/sklad-ui';
import { getViewer } from '@/app/_lib/viewer';

export const dynamic = 'force-dynamic';

/** CSV of one inventory: every card of the warehouse with what was counted (UTF-8 with BOM, semicolons). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const viewer = await getViewer();
  if (!viewer || !viewer.active || viewer.role !== 'admin') return new Response('unauthorized', { status: 401 });
  const { id } = await ctx.params;
  const v = await loadStock(viewer);
  const data = v.mode === 'live' ? await loadInventory(id) : null;
  const inv = data?.inventory ?? v.inventories.find((i) => i.id === id);
  if (!inv) return new Response('not found', { status: 404 });
  const lines = new Map((data?.lines ?? []).map((l) => [l.itemId, l]));
  const wh = v.warehouses.find((w) => w.id === inv.warehouseId);
  const rows = [['sklad', 'datum_inventury', 'karta', 'jednotka', 'polica', 'cele_balenia', 'volne_kusy', 'overena_nula', 'spolu', 'stav'].map(csvField).join(';')];
  for (const i of v.items.filter((x) => v.homeWarehouse[x.id] === inv.warehouseId)) {
    const l = lines.get(i.id);
    rows.push([wh?.name ?? '', inv.inventoryDate, itemLabel(i), i.baseUnit, l?.shelf ?? '', l?.packs ?? '', l?.loose ?? '', l?.verifiedZero ? 'áno' : '', l?.total ?? '', l?.state ?? 'unset'].map(csvField).join(';'));
  }
  return new Response(`﻿${rows.join('\r\n')}\r\n`, {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="pracovna-inventura-${inv.inventoryDate}.csv"`, 'cache-control': 'no-store' },
  });
}
