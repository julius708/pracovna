import { confirmReturnAction, resolveDiscrepancyAction, retryIssueAction } from '@/app/_lib/sklad-actions';
import { qp, sklad } from '@/app/_lib/sklad-guard';
import { loadStock } from '@/app/_lib/sklad';
import { DISCREPANCY_LABEL, itemLabel } from '@/app/_lib/sklad-ui';
import { addDays, formatDM, formatHM } from '@/core/packing';
import { knownDemand, packInfo, skuAt } from '@/core/stock';
import { SkladShell } from '@/ui/sklad/SkladShell';

export const dynamic = 'force-dynamic';

/** "Stav": what is in stock, how long it lasts, what is short, and everything that needs a human look. */
export default async function SkladStav({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await sklad();
  const sp = await searchParams;
  const since = `${addDays(new Date().toISOString().slice(0, 10), -30)}T00:00:00Z`;
  const v = await loadStock(viewer, { movementsSince: since, movementLimit: 5000 });
  const wh = new Map(v.warehouses.map((w) => [w.id, w]));
  const itemName = new Map(v.items.map((i) => [i.id, itemLabel(i)]));

  const week = v.upcoming.filter((u) => u.date <= addDays(v.today, 6)).map((u) => u.snapshot);
  const demand7 = knownDemand(week, v.aliases);
  // average issue per day from the last 30 days (only what really left the stock for packing and flats)
  const issued30 = new Map<string, number>();
  for (const m of v.movements) if (['issue_package', 'issue_flat', 'issue_manual'].includes(m.kind)) issued30.set(m.itemId, (issued30.get(m.itemId) ?? 0) - m.qty);
  const baselineAge = v.config.baselineAt ? (Date.parse(v.today) - Date.parse(v.config.baselineAt.slice(0, 10))) / 86400000 : 0;

  const rows = v.items.map((i) => {
    const mine = v.onHand.filter((r) => r.itemId === i.id);
    const home = v.homeWarehouse[i.id];
    const qty = mine.find((r) => r.warehouseId === home)?.qty ?? null;
    const sku = skuAt(v.skus, i.id, v.today);
    const verified = packInfo(sku).verified;
    const per30 = issued30.get(i.id) ?? 0;
    const days = qty !== null && qty > 0 && per30 > 0 && baselineAge >= 14 ? Math.floor(qty / (per30 / 30)) : null;
    const need7 = demand7.byItem.get(i.id) ?? 0;
    return { i, mine, home, qty, verified, days, need7, short: qty !== null && need7 > qty };
  });
  const unknown = rows.filter((r) => r.qty === null && r.i.kind !== 'linen').length;
  const negative = rows.filter((r) => r.qty !== null && r.qty < 0).length;
  const unverified = rows.filter((r) => !r.verified && r.i.kind !== 'linen').length;

  return (
    <SkladShell viewer={viewer} view={v} current="stav" m={qp(sp, 'm')} title="Stav zásob">
      <div className="sk-grid">
        <div className="sk-card"><b>{rows.length - unknown}</b><span>kariet so známym stavom z {rows.length}</span></div>
        <div className="sk-card"><b>{unknown}</b><span>bez začiatočného stavu (neznámy, nie 0)</span></div>
        <div className="sk-card"><b>{negative}</b><span>pod nulou (zobrazené, nič sa neblokuje)</span></div>
        <div className="sk-card"><b>{unverified}</b><span>s neoveriteľným balením (Neoverené)</span></div>
        <div className="sk-card"><b>{v.unmapped.length}</b><span>riadkov kariet bez priradenia</span></div>
        <div className="sk-card"><b>{v.discrepancies.length + v.errors.length}</b><span>nezrovnalostí / chýb na kontrolu</span></div>
      </div>
      <p className="sk-sub" style={{ marginTop: -4 }}>
        Posledná synchronizácia rezervácií: {v.lastSyncAt ? `${formatDM(v.lastSyncAt.slice(0, 10))} ${formatHM(new Date(v.lastSyncAt))}` : 'neznáma'}. Začiatočný stav:{' '}
        {v.config.baselineAt ? `schválený ${formatDM(v.config.baselineAt.slice(0, 10))} ${formatHM(new Date(v.config.baselineAt))}` : 'ešte nie je schválený'}. Pokrytie sa počíta, až keď máme aspoň 14 dní od začiatočného stavu.
      </p>

      <div className="tablewrap sk-wrap">
        <table>
          <thead>
            <tr><th>Karta</th><th>Sklad</th><th className="num">Stav</th><th className="num">Treba 7 dní</th><th className="num">Pokrytie</th><th>Upozornenia</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.i.id}>
                <td>{itemLabel(r.i)}<div className="sk-sub">{r.i.kind === 'linen' ? 'bielizeň (požičaná, nie spotreba)' : r.i.kind === 'capsule' ? 'káva' : r.i.category}</div></td>
                <td>{r.home ? wh.get(r.home)?.name ?? '—' : <span className="sk-tag warn">bez skladu</span>}</td>
                <td className="num">{r.qty === null ? <span className="sk-sub">neznámy</span> : `${r.qty} ${r.i.baseUnit}`}</td>
                <td className="num">{r.need7 ? `${r.need7} ${r.i.baseUnit}` : '—'}</td>
                <td className="num">{r.days === null ? <span className="sk-sub">málo dát</span> : `${r.days} dní`}</td>
                <td>
                  {r.qty !== null && r.qty < 0 && <span className="sk-tag bad">pod nulou</span>}
                  {r.short && <span className="sk-tag bad">nedostatok na 7 dní</span>}
                  {!r.verified && r.i.kind !== 'linen' && <span className="sk-tag warn">Neoverené balenie</span>}
                  {r.qty === null && r.i.kind !== 'linen' && <span className="sk-tag warn">bez začiatočného stavu</span>}
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={6} className="empty-note">Zatiaľ nie sú žiadne karty. Vytvor ich v „Katalóg a nastavenie“.</td></tr>}
          </tbody>
        </table>
      </div>

      {(v.pendingBatches.length > 0 || v.discrepancies.length > 0 || v.errors.length > 0 || v.unmapped.length > 0) && <h3>Na kontrolu</h3>}
      {v.pendingBatches.length > 0 && (
        <>
          <p>Zabalenie bolo vrátené tlačidlom Späť, ale tovar sa do skladu automaticky nevracia. Ak sa naozaj vrátil, potvrď to; ak zabalenie ide znova, nič nerob (znova sa nevydáva).</p>
          <div className="tablewrap sk-wrap"><table><thead><tr><th>Byt</th><th>Deň balenia</th><th /></tr></thead><tbody>
            {v.pendingBatches.map((b) => (
              <tr key={b.id}><td>{b.listingId}</td><td>{formatDM(b.packageDate)}</td><td>
                <form action={confirmReturnAction} className="sk-form" style={{ margin: 0 }}>
                  <input type="hidden" name="batch" value={b.id} /><input type="hidden" name="aid" value={crypto.randomUUID()} />
                  <button className="btn ghost" style={{ minHeight: 36 }}>Potvrdiť, že sa tovar vrátil do skladu</button>
                </form></td></tr>
            ))}
          </tbody></table></div>
        </>
      )}
      {v.discrepancies.length > 0 && (
        <div className="tablewrap sk-wrap" style={{ marginTop: 10 }}><table><thead><tr><th>Nezrovnalosť</th><th>Byt</th><th>Položka</th><th className="num">Množstvo</th><th>Uzavrieť (s dôvodom)</th></tr></thead><tbody>
          {v.discrepancies.map((d) => (
            <tr key={d.id}><td>{DISCREPANCY_LABEL[d.kind] ?? d.kind}</td><td>{d.listingName ?? '—'}</td><td>{d.itemId ? itemName.get(d.itemId) : '—'}</td><td className="num">{d.qty ?? '—'}</td><td>
              <form action={resolveDiscrepancyAction} className="sk-form" style={{ margin: 0 }}>
                <input type="hidden" name="id" value={d.id} /><input className="wide" name="resolution" placeholder="napr. tovar ostal v byte" required style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 6 }} />
                <button className="btn ghost" style={{ minHeight: 36 }}>Uzavrieť</button>
              </form></td></tr>
          ))}
        </tbody></table></div>
      )}
      {v.errors.length > 0 && (
        <div className="tablewrap sk-wrap" style={{ marginTop: 10 }}><table><thead><tr><th>Chyba pri výdaji</th><th>Kedy</th><th /></tr></thead><tbody>
          {v.errors.map((e) => (
            <tr key={e.id}><td>Výdaj sa nepodarilo zapísať (balenie hostí prešlo): {e.error}</td><td>{formatDM(e.createdAt.slice(0, 10))} {formatHM(new Date(e.createdAt))}</td><td>
              <form action={retryIssueAction} style={{ margin: 0 }}><input type="hidden" name="event" value={e.packedEventId} /><button className="btn ghost" style={{ minHeight: 36 }}>Zopakovať (bez dvojitého odpočtu)</button></form></td></tr>
          ))}
        </tbody></table></div>
      )}
      {v.unmapped.length > 0 && (
        <>
          <p style={{ marginTop: 10 }}>Tieto riadky z balenia sa nevydali zo skladu, lebo nemajú priradenú kartu alebo nemajú určený druh. Nič sa nehádá. Priraď ich v „Katalóg a nastavenie“.</p>
          <div className="tablewrap sk-wrap"><table><thead><tr><th>Riadok karty</th><th>Kľúč</th><th className="num">Počet</th><th>Dôvod</th></tr></thead><tbody>
            {v.unmapped.slice(0, 30).map((u) => (<tr key={u.id}><td>{u.label}</td><td>{u.sourceKind}: {u.sourceKey || '—'}</td><td className="num">{u.n}</td><td>{u.reason}</td></tr>))}
          </tbody></table></div>
        </>
      )}
    </SkladShell>
  );
}
