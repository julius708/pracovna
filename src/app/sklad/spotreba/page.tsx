import { qp, sklad } from '@/app/_lib/sklad-guard';
import { loadMonthContext, loadStock } from '@/app/_lib/sklad';
import { itemLabel } from '@/app/_lib/sklad-ui';
import { monthlyConsumption, type ReportMovement } from '@/core/stock';
import { SkladShell } from '@/ui/sklad/SkladShell';

export const dynamic = 'force-dynamic';

const isYm = (s: string | undefined): s is string => !!s && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);

/** Rows of the consumption report for one month (shared with the CSV export). */
async function consumptionRows(viewer: Parameters<typeof loadStock>[0], ym: string) {
  const from = `${ym}-01T00:00:00Z`;
  const v = await loadStock(viewer, { movementsSince: from, movementLimit: 20000 });
  const wh = new Map(v.warehouses.map((w) => [w.id, w]));
  const mv: ReportMovement[] = v.movements.map((m) => ({ ...m, city: wh.get(m.warehouseId)?.city ?? '—', listingId: m.listingId }));
  const rows = monthlyConsumption(mv, v.items, v.skus).filter((r) => r.month === ym);
  return { v, rows, wh };
}

/** "Spotreba": what was ISSUED per month by city, warehouse, flat and card. Issue is not guest consumption. */
export default async function Spotreba({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await sklad();
  const sp = await searchParams;
  const asked = qp(sp, 'mesiac');
  const ym = isYm(asked) ? asked : new Date().toISOString().slice(0, 7);
  const { v, rows, wh } = await consumptionRows(viewer, ym);
  const ctx = v.mode === 'live' ? await loadMonthContext(ym) : null;
  const name = new Map(v.items.map((i) => [i.id, itemLabel(i)]));
  const unverified = rows.filter((r) => r.costCents === null).length;
  const totalCost = rows.reduce((s, r) => s + (r.costCents ?? 0), 0);
  return (
    <SkladShell viewer={viewer} view={v} current="spotreba" m={qp(sp, 'm')} title="Spotreba (výdaj zo skladu)">
      <p>Ukazuje, čo sa zo skladu <b>vydalo</b> (po odpočítaní potvrdených vrátení). Výdaj nie je to isté ako spotreba hosťami. Posteľná bielizeň sa tu nepočíta: je požičaná, nie spotrebovaná. Nehodnotí sa nikto podľa počtu klikov.</p>
      <form method="get" className="sk-form">
        <div className="form-row"><label htmlFor="mes">Mesiac</label><input id="mes" name="mesiac" type="month" defaultValue={ym} /></div>
        <div className="form-row"><button className="btn primary" style={{ minHeight: 44 }}>Zobraziť</button></div>
        <div className="form-row"><a className="btn ghost" style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center' }} href={`/sklad/spotreba/export.csv?mesiac=${ym}`}>Export CSV</a></div>
      </form>
      <div className="sk-grid">
        <div className="sk-card"><b>{ctx ? ctx.stays : '—'}</b><span>pobytov (odchody v mesiaci)</span></div>
        <div className="sk-card"><b>{ctx ? ctx.guests : '—'}</b><span>hostí</span></div>
        <div className="sk-card"><b>{ctx ? ctx.guestNights : '—'}</b><span>nocí hostí</span></div>
        <div className="sk-card"><b>{ctx ? ctx.occupiedFlatNights : '—'}</b><span>obsadených nocí bytov</span></div>
        <div className="sk-card"><b>{unverified === rows.length && rows.length > 0 ? '—' : `${(totalCost / 100).toFixed(2)} €`}</b><span>náklad overených riadkov{unverified ? ` (${unverified} Neoverené)` : ''}</span></div>
      </div>
      <div className="tablewrap sk-wrap"><table><thead><tr><th>Mesto</th><th>Sklad</th><th>Byt</th><th>Karta</th><th className="num">Vydané</th><th className="num">Vrátené</th><th className="num">Čistý výdaj</th><th className="num">Náklad</th></tr></thead><tbody>
        {rows.map((r, i) => (
          <tr key={i}><td>{r.city}</td><td>{wh.get(r.warehouseId)?.name ?? '—'}</td><td>{r.listingId ?? '—'}</td><td>{name.get(r.itemId) ?? r.itemId}</td><td className="num">{r.issued}</td><td className="num">{r.returned}</td><td className="num">{r.netIssue}</td><td className="num">{r.costCents === null ? <span className="sk-tag warn">Neoverené</span> : `${(r.costCents / 100).toFixed(2)} €`}</td></tr>
        ))}
        {rows.length === 0 && <tr><td colSpan={8} className="empty-note">V tomto mesiaci nie sú žiadne výdaje{v.config.deductionEnabled ? '.' : ' (odpočty zo skladu sú vypnuté).'}</td></tr>}
      </tbody></table></div>
    </SkladShell>
  );
}
