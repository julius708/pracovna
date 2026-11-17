import { notFound } from 'next/navigation';
import { inventoryApproveAction, inventoryCloseAction, inventorySaveAction } from '@/app/_lib/sklad-actions';
import { qp, sklad } from '@/app/_lib/sklad-guard';
import { loadInventory, loadStock } from '@/app/_lib/sklad';
import { itemLabel } from '@/app/_lib/sklad-ui';
import { formatDM, formatHM } from '@/core/packing';
import { packInfo } from '@/core/stock';
import { SkladShell } from '@/ui/sklad/SkladShell';

export const dynamic = 'force-dynamic';

const STATE: Record<string, string> = { unset: 'nespočítané', zero: 'overená nula', counted: 'spočítané', unverified: 'Neoverené – balenie bez overeného prepočtu' };

/** One inventory: the counting form (whole packs + loose pieces), close at an exact time, approve. */
export default async function InventuraDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await sklad();
  const { id } = await params;
  const sp = await searchParams;
  const v = await loadStock(viewer);
  const demo = v.mode !== 'live';
  const data = demo ? { inventory: v.inventories.find((i) => i.id === id) ?? v.inventories[0], lines: [] } : await loadInventory(id);
  if (!data || !data.inventory) notFound();
  const inv = data.inventory;
  const lines = new Map(data.lines.map((l) => [l.itemId, l]));
  const items = v.items.filter((i) => v.homeWarehouse[i.id] === inv.warehouseId);
  const draft = inv.status === 'draft';
  const wh = v.warehouses.find((w) => w.id === inv.warehouseId);

  return (
    <SkladShell viewer={viewer} view={v} current="inventura" m={qp(sp, 'm')} title={`Inventúra ${formatDM(inv.inventoryDate)} · ${wh?.name ?? ''}`}>
      <p>
        {inv.title || 'Bez názvu'} · {inv.status === 'draft' ? 'rozpracovaná' : inv.status === 'closed' ? 'uzavretá, čaká na schválenie' : 'schválená'}
        {inv.cutAt && ` · uzávierka ${formatDM(inv.cutAt.slice(0, 10))} ${formatHM(new Date(inv.cutAt))}`}. Súčet = celé balenia × kusov v balení + voľné kusy.
      </p>
      <div className="sk-form">
        <a className="btn ghost" style={{ minHeight: 40, display: 'inline-flex', alignItems: 'center' }} href={`/sklad/inventura/${inv.id}/tlac`} target="_blank" rel="noreferrer">Tlačový list A4 (PDF)</a>
        <a className="btn ghost" style={{ minHeight: 40, display: 'inline-flex', alignItems: 'center' }} href={`/sklad/inventura/${inv.id}/export.csv`}>Export CSV</a>
      </div>
      <form action={inventorySaveAction}>
        <input type="hidden" name="inventory" value={inv.id} />
        <div className="tablewrap sk-wrap"><table><thead><tr><th>Karta</th><th>Balenie</th><th>Polica</th><th className="num">Celé balenia</th><th className="num">Voľné kusy</th><th>Overená nula</th><th className="num">Spolu</th><th>Stav riadku</th></tr></thead><tbody>
          {items.map((i) => {
            const l = lines.get(i.id);
            const skus = v.skus.filter((s) => s.itemId === i.id && s.validFrom <= v.today && (s.validTo === null || s.validTo >= v.today));
            return (
              <tr key={i.id}>
                <td>{itemLabel(i)}<div className="sk-sub">{i.baseUnit}</div><input type="hidden" name="item" value={i.id} />{l && <input type="hidden" name="had" value={i.id} />}</td>
                <td>
                  <select name={`sku.${i.id}`} defaultValue={l?.skuId ?? ''} disabled={!draft}>
                    <option value="">{skus.filter((s) => packInfo(s).verified).length === 1 ? 'jediné overené balenie' : 'vyber balenie'}</option>
                    {skus.map((s) => { const p = packInfo(s); return <option key={s.id} value={s.id}>{s.supplier}: {p.verified ? `${p.piecesPerPack} ${i.baseUnit}/bal.` : 'Neoverené'}</option>; })}
                  </select>
                </td>
                <td><input className="wide" style={{ width: 90 }} name={`shelf.${i.id}`} defaultValue={l?.shelf ?? ''} disabled={!draft} /></td>
                <td className="num"><input name={`packs.${i.id}`} type="number" min={0} step={1} defaultValue={l?.packs ?? ''} disabled={!draft} /></td>
                <td className="num"><input name={`loose.${i.id}`} type="number" min={0} step={1} defaultValue={l?.loose ?? ''} disabled={!draft} /></td>
                <td><input type="checkbox" name={`zero.${i.id}`} defaultChecked={l?.verifiedZero ?? false} disabled={!draft} style={{ width: 22, height: 22 }} /></td>
                <td className="num">{l?.total ?? '—'}</td>
                <td>{l ? STATE[l.state] ?? l.state : STATE.unset}</td>
              </tr>
            );
          })}
          {items.length === 0 && <tr><td colSpan={8} className="empty-note">Tento sklad nemá žiadne karty. Priraď kartám sklad v „Katalóg a nastavenie“.</td></tr>}
        </tbody></table></div>
        {draft && <div className="sk-form" style={{ marginTop: 10 }}><button className="btn primary" style={{ minHeight: 44 }}>Uložiť spočítané</button></div>}
      </form>

      {draft && (
        <form action={inventoryCloseAction} className="sk-form">
          <input type="hidden" name="inventory" value={inv.id} /><input type="hidden" name="aid" value={crypto.randomUUID()} />
          <div className="form-row"><label htmlFor="cut">Čas uzávierky (prázdne = teraz)</label><input id="cut" name="cut" type="datetime-local" /></div>
          <div className="form-row"><button className="btn go" style={{ minHeight: 44 }}>Uzavrieť v tomto čase</button></div>
          <span className="sk-sub" style={{ flexBasis: '100%' }}>Uzavretím sa spočítané porovná s očakávaným stavom k tomuto času; rozdiel sa zapíše ako auditovaný pohyb. Prázdne riadky sa preskočia (nie sú nula). Pohyby po tomto čase sa nepreratúvajú.</span>
        </form>
      )}
      {inv.status === 'closed' && (
        <form action={inventoryApproveAction} className="sk-form">
          <input type="hidden" name="inventory" value={inv.id} />
          <button className="btn primary" style={{ minHeight: 44 }}>Schváliť inventúru{v.config.baselineInventoryId ? '' : ' (stane sa začiatočným stavom)'}</button>
        </form>
      )}
    </SkladShell>
  );
}
