import { inventoryOpenAction } from '@/app/_lib/sklad-actions';
import { qp, sklad } from '@/app/_lib/sklad-guard';
import { loadStock } from '@/app/_lib/sklad';
import { formatDM, formatHM } from '@/core/packing';
import Link from 'next/link';
import { SkladShell } from '@/ui/sklad/SkladShell';

export const dynamic = 'force-dynamic';

const ST = { draft: 'rozpracovaná', closed: 'uzavretá (čaká na schválenie)', approved: 'schválená' } as const;

/** "Inventúra": list and a new inventory with the date set by the správca. */
export default async function Inventura({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await sklad();
  const sp = await searchParams;
  const v = await loadStock(viewer);
  const wh = new Map(v.warehouses.map((w) => [w.id, w.name]));
  return (
    <SkladShell viewer={viewer} view={v} current="inventura" m={qp(sp, 'm')} title="Inventúra">
      <p>
        Dátum inventúry určuje správca. Spočítané sa zapisuje ako celé balenia, voľné kusy a polica; prázdne pole nie je nula (nula sa potvrdzuje osobitne). Uzavretím v presnom čase vznikne začiatočný stav alebo rozdiel.
        Prvá schválená inventúra je začiatočný stav; až potom sa dajú zapnúť odpočty.
      </p>
      <form action={inventoryOpenAction} className="sk-form">
        <input type="hidden" name="aid" value={crypto.randomUUID()} />
        <div className="form-row"><label htmlFor="iw">Sklad</label>
          <select id="iw" name="warehouse" required>{v.warehouses.filter((w) => w.active).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></div>
        <div className="form-row"><label htmlFor="id">Dátum inventúry</label><input id="id" name="date" type="date" defaultValue={v.today} required /></div>
        <div className="form-row"><label htmlFor="it">Názov</label><input id="it" name="title" placeholder="napr. Začiatočná inventúra" /></div>
        <div className="form-row"><button className="btn primary" style={{ minHeight: 44 }}>Založiť inventúru</button></div>
      </form>
      <div className="tablewrap sk-wrap"><table><thead><tr><th>Dátum</th><th>Názov</th><th>Sklad</th><th>Stav</th><th>Čas uzávierky</th><th /></tr></thead><tbody>
        {v.inventories.map((i) => (
          <tr key={i.id}>
            <td>{formatDM(i.inventoryDate)}</td><td>{i.title || '—'}</td><td>{wh.get(i.warehouseId) ?? '—'}</td>
            <td>{ST[i.status]}{v.config.baselineInventoryId === i.id && <span className="sk-tag">začiatočný stav</span>}</td>
            <td>{i.cutAt ? `${formatDM(i.cutAt.slice(0, 10))} ${formatHM(new Date(i.cutAt))}` : '—'}</td>
            <td><Link className="btn ghost" style={{ minHeight: 36, display: 'inline-flex', alignItems: 'center' }} href={`/sklad/inventura/${i.id}`}>Otvoriť</Link></td>
          </tr>
        ))}
        {v.inventories.length === 0 && <tr><td colSpan={6} className="empty-note">Zatiaľ žiadna inventúra.</td></tr>}
      </tbody></table></div>
    </SkladShell>
  );
}
