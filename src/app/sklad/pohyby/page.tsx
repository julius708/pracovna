import { movementAction, transferAction } from '@/app/_lib/sklad-actions';
import { qp, sklad } from '@/app/_lib/sklad-guard';
import { loadStock } from '@/app/_lib/sklad';
import { itemLabel, KIND_LABEL } from '@/app/_lib/sklad-ui';
import { formatDM, formatHM } from '@/core/packing';
import { SkladShell } from '@/ui/sklad/SkladShell';

export const dynamic = 'force-dynamic';

/** "Pohyby": the ledger (správca) and the form for a manual issue / damage / return (every active user). */
export default async function Pohyby({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await sklad({ admin: false });
  const sp = await searchParams;
  const v = await loadStock(viewer, { movementLimit: 200 });
  const item = new Map(v.items.map((i) => [i.id, i]));
  const wh = new Map(v.warehouses.map((w) => [w.id, w.name]));
  const opts = v.items.map((i) => <option key={i.id} value={i.id}>{itemLabel(i)}</option>);
  const whOpts = v.warehouses.filter((w) => w.active).map((w) => <option key={w.id} value={w.id}>{w.name}</option>);
  return (
    <SkladShell viewer={viewer} view={v} current="pohyby" m={qp(sp, 'm')} title="Pohyby">
      <p>Každý pohyb má množstvo v základnej jednotke, čas, osobu a dôvod. Opravy sa robia novým pohybom, nikdy prepísaním. Záporný stav nič neblokuje, len sa ukáže.</p>
      <h3>Zapísať pohyb</h3>
      <form action={movementAction} className="sk-form">
        <input type="hidden" name="aid" value={crypto.randomUUID()} />
        <div className="form-row"><label htmlFor="mk">Druh</label>
          <select id="mk" name="kind"><option value="issue_manual">Ručný výdaj</option><option value="issue_flat">Výdaj do bytu</option><option value="damage">Poškodenie</option><option value="return">Vrátenie do skladu</option>{v.isAdmin && <option value="receipt">Príjem tovaru</option>}</select></div>
        <div className="form-row"><label htmlFor="mi">Karta</label><select id="mi" name="item" required>{opts}</select></div>
        <div className="form-row"><label htmlFor="mw">Sklad</label><select id="mw" name="warehouse" required>{whOpts}</select></div>
        <div className="form-row"><label htmlFor="mq">Množstvo</label><input id="mq" name="qty" type="number" min={1} step={1} required /></div>
        <div className="form-row"><label htmlFor="mr">Dôvod</label><input id="mr" name="reason" required placeholder="napr. doplnenie bytu" /></div>
        <div className="form-row"><label htmlFor="ml">Byt (ak sa týka)</label><input id="ml" name="listing" placeholder="voliteľné" /></div>
        <div className="form-row"><button className="btn primary" style={{ minHeight: 44 }}>Zapísať</button></div>
      </form>
      {v.isAdmin && (
        <>
          <h3>Presun medzi skladmi</h3>
          <form action={transferAction} className="sk-form">
            <input type="hidden" name="aid" value={crypto.randomUUID()} />
            <div className="form-row"><label htmlFor="ti">Karta</label><select id="ti" name="item" required>{opts}</select></div>
            <div className="form-row"><label htmlFor="tf">Z</label><select id="tf" name="from" required>{whOpts}</select></div>
            <div className="form-row"><label htmlFor="tt">Do</label><select id="tt" name="to" required>{whOpts}</select></div>
            <div className="form-row"><label htmlFor="tq">Množstvo</label><input id="tq" name="qty" type="number" min={1} step={1} required /></div>
            <div className="form-row"><label htmlFor="tr">Dôvod</label><input id="tr" name="reason" required placeholder="napr. špinavá bielizeň do práčovne" /></div>
            <div className="form-row"><button className="btn ghost" style={{ minHeight: 44 }}>Presunúť</button></div>
          </form>
          <h3>Posledné pohyby</h3>
          <div className="tablewrap sk-wrap"><table><thead><tr><th>Kedy</th><th>Druh</th><th>Karta</th><th>Sklad</th><th className="num">Množstvo</th><th>Dôvod / zdroj</th><th>Zapísal(a)</th></tr></thead><tbody>
            {v.movements.map((m) => (
              <tr key={m.id}><td>{formatDM(m.at.slice(0, 10))} {formatHM(new Date(m.at))}</td><td>{KIND_LABEL[m.kind] ?? m.kind}</td><td>{item.get(m.itemId) ? itemLabel(item.get(m.itemId)!) : m.itemId}</td><td>{wh.get(m.warehouseId) ?? '—'}</td><td className="num">{m.qty > 0 ? `+${m.qty}` : m.qty}</td><td>{m.reason ?? ''}{m.listingId ? <div className="sk-sub">{m.listingId}</div> : null}</td><td>{m.actorName}</td></tr>
            ))}
            {v.movements.length === 0 && <tr><td colSpan={7} className="empty-note">Zatiaľ žiadne pohyby.</td></tr>}
          </tbody></table></div>
        </>
      )}
    </SkladShell>
  );
}
