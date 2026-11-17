import { orderConfirmAction, orderCreateAction, orderExportedAction, orderReceiveAction, orderReconcileAction, orderSentAction, orderStepAction } from '@/app/_lib/sklad-actions';
import { qp, sklad } from '@/app/_lib/sklad-guard';
import { loadForecastInputs, loadStock, type OrderRow } from '@/app/_lib/sklad';
import { itemLabel, ORDER_STATUS, SEND_STATE } from '@/app/_lib/sklad-ui';
import { addDays, formatDM } from '@/core/packing';
import { calibrate, knownDemand, packInfo, proposeOrder, sellThrough, skuAt, type Coefficient, type StockItem } from '@/core/stock';
import { SkladShell } from '@/ui/sklad/SkladShell';

export const dynamic = 'force-dynamic';

const pct = (s: string | undefined, d: number) => {
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n / 100 : d / 100;
};

function mailto(o: OrderRow, items: Map<string, StockItem>) {
  const body = [`Dobrý deň,`, ``, `posielame objednávku:`, ``, ...o.lines.map((l) => `- ${items.get(l.itemId) ? itemLabel(items.get(l.itemId)!) : l.itemId}: ${l.finalUnits} × ${l.purchaseUnit === 'carton' ? 'kartón' : 'balenie'} (${l.piecesPerPack} ks v balení)`), ``, o.deliveryTargetDate ? `Požadovaná dodávka do: ${formatDM(o.deliveryTargetDate)}` : '', ``, `Prosíme o potvrdenie.`].join('\n');
  return `mailto:?subject=${encodeURIComponent('Objednávka')}&body=${encodeURIComponent(body)}`;
}

/** "Objednávky": a proposal from known demand + a sell-through scenario, then návrh → kontrola → schválenie → odoslanie → príjem. */
export default async function Objednavky({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await sklad();
  const sp = await searchParams;
  const v = await loadStock(viewer, { movementsSince: `${addDays(new Date().toISOString().slice(0, 10), -60)}T00:00:00Z`, movementLimit: 20000 });
  const items = new Map(v.items.map((i) => [i.id, i]));
  const to = /^\d{4}-\d{2}-\d{2}$/.test(qp(sp, 'do') ?? '') ? (qp(sp, 'do') as string) : addDays(v.today, 14);
  const scenario = (['low', 'mid', 'high'] as const).find((s) => s === qp(sp, 'scenar')) ?? 'mid';
  const occ = { low: pct(qp(sp, 'o1'), 40), mid: pct(qp(sp, 'o2'), 60), high: pct(qp(sp, 'o3'), 80) };
  const excluded = Math.max(0, Math.floor(Number(qp(sp, 'vyradene')) || 0));
  const suppliers = [...new Set(v.skus.map((s) => s.supplier))].sort();
  const supplier = suppliers.includes(qp(sp, 'dodavatel') ?? '') ? (qp(sp, 'dodavatel') as string) : (suppliers[0] ?? '');
  const days = Math.max(1, Math.round((Date.parse(to) - Date.parse(v.today)) / 86400000));
  const periodFrom = (v.config.baselineAt && v.config.baselineAt.slice(0, 10) > addDays(v.today, -60) ? v.config.baselineAt.slice(0, 10) : addDays(v.today, -60));
  const fc = v.mode === 'live' ? await loadForecastInputs(v.today, to, periodFrom) : { activeFlats: 12, confirmedStays: 2, avgStayNights: null, recentStays: 0 };

  const known = knownDemand(v.upcoming.filter((u) => u.date <= to).map((u) => u.snapshot), v.aliases);
  // per-stay coefficients from cleaned history (issues minus confirmed returns), with period and sample size shown
  const issued = new Map<string, number>();
  for (const m of v.movements) if (m.at.slice(0, 10) >= periodFrom && ['issue_package', 'issue_flat', 'issue_manual', 'return'].includes(m.kind)) issued.set(m.itemId, (issued.get(m.itemId) ?? 0) - m.qty);
  const perStay = new Map<string, Coefficient>();
  for (const i of v.items) if (i.kind !== 'linen') perStay.set(i.id, calibrate(i.id, Math.max(0, issued.get(i.id) ?? 0), { from: periodFrom, to: v.today, stays: fc.recentStays }));
  const sell = fc.avgStayNights && v.config.deductionEnabled
    ? sellThrough({ flats: [{ listingId: 'all', city: 'BA', availableNights: Math.max(0, fc.activeFlats - excluded) * days }], occupancy: occ, avgStayNights: fc.avgStayNights, confirmedStays: fc.confirmedStays, perStay }).find((s) => s.scenario === scenario)
    : undefined;

  const approver = v.isAdmin && (v.config.approvers.length === 0 || v.config.approvers.includes(viewer.id));
  const rows = v.items.filter((i) => i.kind !== 'linen').map((i) => {
    const skus = v.skus.filter((s) => s.itemId === i.id && s.supplier === supplier);
    const sku = skuAt(skus, i.id, v.today);
    const home = v.homeWarehouse[i.id];
    const stock = v.onHand.find((r) => r.itemId === i.id && r.warehouseId === home)?.qty ?? null;
    const need = Math.ceil((known.byItem.get(i.id) ?? 0) + (sell?.byItem.get(i.id) ?? 0));
    const incoming = v.incoming[i.id] ?? 0;
    const p = proposeOrder({ need, reserve: 0, usableStock: stock ?? 0, incoming, sku });
    return { i, sku, stock, need, incoming, p, noData: sell?.noData.includes(i.id) ?? false };
  }).filter((r) => r.sku);

  return (
    <SkladShell viewer={viewer} view={v} current="objednavky" m={qp(sp, 'm')} title="Objednávky">
      <p>
        Návrh = potreba do ďalšej dodávky + rezerva − použiteľná zásoba − potvrdený príjem (nikdy pod 0), zaokrúhlené nahor na overené nákupné balenia a minimálnu objednávku.
        Ponuka dodávateľa nie je záväzná. Nič sa neodosiela samo: objednávka ide návrh → kontrola → schválenie oprávnenou osobou → odoslanie → potvrdenie dodávateľa → príjem.
      </p>
      <h3>Návrh z potreby</h3>
      <form method="get" className="sk-form">
        <div className="form-row"><label htmlFor="sup">Dodávateľ</label><select id="sup" name="dodavatel" defaultValue={supplier}>{suppliers.map((s) => <option key={s}>{s}</option>)}</select></div>
        <div className="form-row"><label htmlFor="do">Dodávka najneskôr</label><input id="do" name="do" type="date" defaultValue={to} /></div>
        <div className="form-row"><label htmlFor="sc">Scenár predaja</label><select id="sc" name="scenar" defaultValue={scenario}><option value="low">nízky</option><option value="mid">stredný</option><option value="high">vysoký</option></select></div>
        <div className="form-row"><label htmlFor="o1">Obsadenosť nízky/stredný/vysoký (%) – predpoklad</label>
          <span style={{ display: 'flex', gap: 4 }}><input id="o1" name="o1" type="number" min={0} max={100} defaultValue={Math.round(occ.low * 100)} /><input name="o2" type="number" min={0} max={100} defaultValue={Math.round(occ.mid * 100)} /><input name="o3" type="number" min={0} max={100} defaultValue={Math.round(occ.high * 100)} /></span></div>
        <div className="form-row"><label htmlFor="vy">Vyradené byty (opravy/blokácie)</label><input id="vy" name="vyradene" type="number" min={0} defaultValue={excluded} /></div>
        <div className="form-row"><button className="btn ghost" style={{ minHeight: 44 }}>Prepočítať</button></div>
      </form>
      <div className="sk-grid">
        <div className="sk-card"><b>{known.byItem.size}</b><span>kariet so známou potrebou (potvrdené rezervácie cez výpočet balenia)</span></div>
        <div className="sk-card"><b>{sell ? sell.additionalStays.toFixed(1) : '—'}</b><span>ďalších pobytov v scenári „{scenario}“ ({fc.activeFlats - excluded} aktívnych bytov × {days} dní, bez už potvrdených {fc.confirmedStays})</span></div>
        <div className="sk-card"><b>{fc.avgStayNights ? fc.avgStayNights.toFixed(1) : '—'}</b><span>priemerná dĺžka pobytu (nocí, posledných 90 dní)</span></div>
      </div>
      {!sell && <div className="sk-banner">Predaj nad rámec potvrdených rezervácií sa zatiaľ nepočíta: {v.config.deductionEnabled ? 'chýba priemerná dĺžka pobytu z histórie' : 'odpočty sú vypnuté, takže nie je vyčistená história výdajov na kalibráciu'}. Návrh vychádza len zo známych rezervácií. Týždeň sa nikdy nenásobí štyrmi.</div>}
      {sell && sell.noData.length > 0 && <div className="sk-banner">Pre {sell.noData.length} kariet je málo dát na odhad ďalšieho predaja (vzorka pod 20 pobytov v období od {periodFrom}): berie sa len známa potreba.</div>}

      <form action={orderCreateAction}>
        <input type="hidden" name="aid" value={crypto.randomUUID()} /><input type="hidden" name="supplier" value={supplier} /><input type="hidden" name="delivery" value={to} />
        <div className="tablewrap sk-wrap"><table><thead><tr><th>Objednať</th><th>Karta</th><th>Balenie</th><th className="num">Potreba</th><th className="num">Rezerva</th><th className="num">Zásoba</th><th className="num">Príjem</th><th className="num">Návrh</th><th className="num">Objednať (jednotiek)</th><th>Dôvod zmeny</th></tr></thead><tbody>
          {rows.map(({ i, sku, stock, need, incoming, p, noData }) => {
            const info = packInfo(sku);
            const ok = p.status === 'ok';
            return (
              <tr key={i.id}>
                <td><input type="checkbox" name={`use.${i.id}`} defaultChecked={ok && p.units > 0} disabled={!ok} style={{ width: 22, height: 22 }} /><input type="hidden" name="item" value={i.id} /><input type="hidden" name={`sku.${i.id}`} value={sku!.id} /></td>
                <td>{itemLabel(i)}{noData && <div className="sk-sub">málo dát na odhad predaja</div>}</td>
                <td>{info.verified ? `${info.piecesPerPack} ${i.baseUnit}/bal.${sku!.purchaseUnit === 'carton' ? ` · kartón ${sku!.packsPerCarton ?? '?'} bal.` : ''}${sku!.minOrder ? ` · min. ${sku!.minOrder}` : ''}` : <span className="sk-tag warn">Neoverené – {info.reason}</span>}</td>
                <td className="num"><input name={`need.${i.id}`} type="number" min={0} defaultValue={need} /></td>
                <td className="num"><input name={`reserve.${i.id}`} type="number" min={0} defaultValue={0} /></td>
                <td className="num"><input name={`usable.${i.id}`} type="number" defaultValue={Math.max(0, stock ?? 0)} />{stock === null && <div className="sk-sub">stav neznámy</div>}</td>
                <td className="num"><input name={`incoming.${i.id}`} type="number" min={0} defaultValue={incoming} /></td>
                <td className="num">{ok ? `${p.units}${p.basis === 'minimum_order' ? ' (min.)' : ''}` : '—'}</td>
                <td className="num"><input name={`final.${i.id}`} type="number" min={0} defaultValue={ok ? p.units : undefined} disabled={!ok} /></td>
                <td><input className="wide" name={`reason.${i.id}`} placeholder="povinné, ak sa líši od návrhu" disabled={!ok} /></td>
              </tr>
            );
          })}
          {rows.length === 0 && <tr><td colSpan={10} className="empty-note">Pre tohto dodávateľa nie je žiadna ponuka. Pridaj ju v „Katalóg a nastavenie“.</td></tr>}
        </tbody></table></div>
        <p className="sk-sub" style={{ marginTop: 6 }}>Potreba, rezerva, zásoba a príjem sa zadávajú v základnej jednotke (kusoch). Server ich prepočíta znova, nehádá balenie a zmenu oproti návrhu vyžaduje s dôvodom.</p>
        <div className="sk-form"><div className="form-row"><label htmlFor="on">Poznámka</label><input id="on" name="note" /></div><div className="form-row"><button className="btn primary" style={{ minHeight: 44 }} disabled={rows.length === 0}>Vytvoriť návrh objednávky</button></div></div>
      </form>

      <h3>Objednávky</h3>
      {v.orders.map((o) => {
        const canReceive = ['sent', 'confirmed', 'partially_received'].includes(o.status);
        return (
          <div key={o.id} className="sk-card" style={{ marginBottom: 10 }}>
            <b style={{ fontSize: 16 }}>{o.supplier} · {ORDER_STATUS[o.status] ?? o.status}</b>
            <span>
              {SEND_STATE[o.sendState] ?? o.sendState}
              {o.deliveryTargetDate ? ` · dodávka do ${formatDM(o.deliveryTargetDate)}` : ''} · vytvoril(a) {o.createdByName}{o.approvedByName ? ` · schválil(a) ${o.approvedByName}` : ''}{o.supplierRef ? ` · ref. ${o.supplierRef}` : ''}
            </span>
            <div className="tablewrap sk-wrap" style={{ marginTop: 8 }}><table><thead><tr><th>Karta</th><th className="num">Surovo</th><th className="num">Návrh</th><th className="num">Objednané</th><th className="num">Prijaté</th>{canReceive && <th className="num">Prijať teraz</th>}<th>Dôvod zmeny</th></tr></thead><tbody>
              {o.lines.map((l) => (
                <tr key={l.id}><td>{items.get(l.itemId) ? itemLabel(items.get(l.itemId)!) : l.itemId}</td><td className="num">{l.rawBase}</td><td className="num">{l.suggestedUnits}</td><td className="num">{l.finalUnits} {l.purchaseUnit === 'carton' ? 'kartónov' : 'bal.'} · {l.piecesPerPack} ks/bal.</td><td className="num">{l.received}</td>
                  {canReceive && <td className="num"><input form={`rc-${o.id}`} name={`recv.${l.id}`} type="number" min={0} /><input form={`rc-${o.id}`} type="hidden" name="line" value={l.id} /></td>}
                  <td>{l.manualReason ?? ''}</td></tr>
              ))}
            </tbody></table></div>
            <div className="sk-form" style={{ marginTop: 8 }}>
              {o.status === 'draft' && <StepBtn order={o.id} to="review" label="Poslať na kontrolu" />}
              {o.status === 'review' && <><StepBtn order={o.id} to="draft" label="Vrátiť do návrhu" />{approver ? <StepBtn order={o.id} to="approved" label="Schváliť" primary /> : <span className="sk-sub">Schváliť môže len oprávnená osoba.</span>}</>}
              {['draft', 'review', 'approved', 'sent', 'confirmed'].includes(o.status) && <StepBtn order={o.id} to="cancelled" label="Zrušiť" />}
            </div>
            {o.status === 'approved' && (
              <div className="sk-form">
                <a className="btn ghost" style={{ minHeight: 40, display: 'inline-flex', alignItems: 'center' }} href={`/sklad/objednavky/${o.id}/export.csv`}>Export CSV pre dodávateľa</a>
                <a className="btn ghost" style={{ minHeight: 40, display: 'inline-flex', alignItems: 'center' }} href={mailto(o, items)}>Pripravený e-mail (neodošle sa sám)</a>
                <form action={orderExportedAction} style={{ margin: 0 }}><input type="hidden" name="order" value={o.id} /><input type="hidden" name="aid" value={crypto.randomUUID()} /><button className="btn ghost" style={{ minHeight: 40 }}>Zaznamenať export (stále NEODOSLANÉ)</button></form>
                {approver && o.sendState !== 'sent' && (
                  <form action={orderSentAction} className="sk-form" style={{ margin: 0 }}>
                    <input type="hidden" name="order" value={o.id} /><input type="hidden" name="aid" value={crypto.randomUUID()} />
                    <select name="method" style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 8 }}><option value="email">e-mailom</option><option value="export">súborom / ručne</option><option value="api">cez API dodávateľa</option></select>
                    <input name="ref" placeholder="referencia (voliteľné)" style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 8 }} />
                    <select name="state" style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 8 }}><option value="sent">naozaj odoslané</option><option value="ambiguous">výsledok nejasný</option></select>
                    <button className="btn primary" style={{ minHeight: 40 }}>Označiť odoslanie</button>
                  </form>
                )}
                {approver && o.sendState === 'ambiguous' && (
                  <form action={orderReconcileAction} className="sk-form" style={{ margin: 0 }}>
                    <input type="hidden" name="order" value={o.id} /><input type="hidden" name="aid" value={crypto.randomUUID()} />
                    <select name="outcome" style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 8 }}><option value="sent">po overení: odoslané</option><option value="not_sent">po overení: neodišlo</option></select>
                    <button className="btn ghost" style={{ minHeight: 40 }}>Uzavrieť nejasnosť</button>
                  </form>
                )}
              </div>
            )}
            {o.status === 'sent' && (
              <form action={orderConfirmAction} className="sk-form"><input type="hidden" name="order" value={o.id} /><input type="hidden" name="aid" value={crypto.randomUUID()} />
                <input name="ref" placeholder="číslo potvrdenia dodávateľa" style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 8 }} /><button className="btn ghost" style={{ minHeight: 40 }}>Dodávateľ potvrdil</button></form>
            )}
            {canReceive && (
              <form id={`rc-${o.id}`} action={orderReceiveAction} className="sk-form"><input type="hidden" name="order" value={o.id} /><input type="hidden" name="aid" value={crypto.randomUUID()} />
                <input name="note" placeholder="poznámka k dodávke" style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 8 }} /><button className="btn go" style={{ minHeight: 40 }}>Potvrdiť fyzický príjem</button>
                <span className="sk-sub">Sklad sa zvýši až týmto potvrdením; čiastočná dodávka je v poriadku.</span></form>
            )}
          </div>
        );
      })}
      {v.orders.length === 0 && <p className="empty-note">Zatiaľ žiadna objednávka.</p>}
    </SkladShell>
  );
}

function StepBtn({ order, to, label, primary }: { order: string; to: string; label: string; primary?: boolean }) {
  return (
    <form action={orderStepAction} style={{ margin: 0 }}>
      <input type="hidden" name="order" value={order} /><input type="hidden" name="to" value={to} /><input type="hidden" name="aid" value={crypto.randomUUID()} />
      <button className={`btn ${primary ? 'primary' : 'ghost'}`} style={{ minHeight: 40 }}>{label}</button>
    </form>
  );
}
