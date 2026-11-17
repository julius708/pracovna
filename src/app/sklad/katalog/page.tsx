import { saveAliasAction, saveItemAction, saveSkuAction, saveWarehouseAction, seedCatalogAction, setApproversAction, setDeductionAction } from '@/app/_lib/sklad-actions';
import { qp, sklad } from '@/app/_lib/sklad-guard';
import { loadStock } from '@/app/_lib/sklad';
import { itemLabel } from '@/app/_lib/sklad-ui';
import { formatDM, formatHM } from '@/core/packing';
import { packInfo } from '@/core/stock';
import { SkladShell } from '@/ui/sklad/SkladShell';

export const dynamic = 'force-dynamic';
const inp = { border: '1px solid var(--line)', borderRadius: 8, padding: 8 } as const;

/** Catalog and settings: warehouses, cards, supplier offers (versioned), the mapping of packing rows, approvers and the deduction switch. */
export default async function Katalog({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await sklad();
  const sp = await searchParams;
  const v = await loadStock(viewer);
  const wh = new Map(v.warehouses.map((w) => [w.id, w.name]));
  const item = new Map(v.items.map((i) => [i.id, i]));
  const whOpts = v.warehouses.filter((w) => w.active).map((w) => <option key={w.id} value={w.id}>{w.name}</option>);
  const itemOpts = v.items.map((i) => <option key={i.id} value={i.id}>{itemLabel(i)}</option>);
  const canEnable = !!v.config.baselineInventoryId;
  return (
    <SkladShell viewer={viewer} view={v} current="katalog" m={qp(sp, 'm')} title="Katalóg a nastavenie">
      <h3>Odpočty zo skladu pri zabalení</h3>
      <p>
        Stav: <b>{v.config.deductionEnabled ? 'zapnuté' : 'vypnuté'}</b>. Zapnúť sa dajú len po schválenej začiatočnej inventúre
        {v.config.baselineAt ? ` (schválená, uzávierka ${formatDM(v.config.baselineAt.slice(0, 10))} ${formatHM(new Date(v.config.baselineAt))})` : ' (zatiaľ nie je)'}, nie k dátumu.
        Pri zapnutí sa doplnia len balenia zabalené po uzávierke inventúry, práve raz; staršie sa nikdy nepočítajú.
      </p>
      <form action={setDeductionAction} className="sk-form">
        <input type="hidden" name="enabled" value={v.config.deductionEnabled ? '0' : '1'} />
        <button className={`btn ${v.config.deductionEnabled ? 'ghost' : 'primary'}`} style={{ minHeight: 44 }} disabled={!v.config.deductionEnabled && !canEnable}>{v.config.deductionEnabled ? 'Vypnúť odpočty' : 'Zapnúť odpočty'}</button>
        {!v.config.deductionEnabled && !canEnable && <span className="sk-sub">Najprv schváľ začiatočnú inventúru.</span>}
      </form>

      <h3>Kto schvaľuje objednávky a inventúru</h3>
      <form action={setApproversAction} className="sk-form">
        {v.staff.filter((s) => s.role === 'admin').map((s) => (
          <label key={s.id} style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" name="approver" value={s.id} defaultChecked={v.config.approvers.includes(s.id)} style={{ width: 20, height: 20 }} />{s.name}</label>
        ))}
        <button className="btn ghost" style={{ minHeight: 40 }}>Uložiť</button>
        <span className="sk-sub" style={{ flexBasis: '100%' }}>Nikto nezaškrtnutý = schvaľuje každý správca.</span>
      </form>

      <h3>Sklady</h3>
      <div className="tablewrap sk-wrap"><table><thead><tr><th>Názov</th><th>Mesto</th><th>Druh</th></tr></thead><tbody>
        {v.warehouses.map((w) => <tr key={w.id}><td>{w.name}</td><td>{w.city}</td><td>{w.kind}</td></tr>)}
      </tbody></table></div>
      <form action={saveWarehouseAction} className="sk-form" style={{ marginTop: 8 }}>
        <input style={inp} name="name" placeholder="názov skladu" required /><input style={inp} name="city" placeholder="mesto" defaultValue="Bratislava" />
        <select style={inp} name="kind"><option value="warehouse">sklad</option><option value="clean">čistá bielizeň</option><option value="flats">zabalené v bytoch</option><option value="laundry">práčovňa</option><option value="damaged">poškodené</option></select>
        <button className="btn ghost" style={{ minHeight: 40 }}>Pridať sklad</button>
      </form>

      <h3>Skladové karty</h3>
      <form action={seedCatalogAction} className="sk-form"><button className="btn ghost" style={{ minHeight: 40 }}>Vytvoriť základné karty a priradenia (bez čísel)</button><span className="sk-sub">Vytvorí karty pre toaletný papier, utierky, vrecká a štyri kávové systémy; ceny ani balenia nedopĺňa.</span></form>
      <div className="tablewrap sk-wrap"><table><thead><tr><th>Karta</th><th>Druh</th><th>Jednotka</th><th>Sklad pri balení</th></tr></thead><tbody>
        {v.items.map((i) => <tr key={i.id}><td>{itemLabel(i)}</td><td>{i.kind}</td><td>{i.baseUnit}</td><td>{v.homeWarehouse[i.id] ? wh.get(v.homeWarehouse[i.id]!) : <span className="sk-tag warn">nepriradený</span>}</td></tr>)}
      </tbody></table></div>
      <form action={saveItemAction} className="sk-form" style={{ marginTop: 8 }}>
        <select style={inp} name="kind"><option value="consumable">spotrebný materiál</option><option value="capsule">kávové kapsule</option><option value="linen">posteľná bielizeň</option></select>
        <input style={inp} name="product" placeholder="produkt" required /><input style={inp} name="variant" placeholder="variant (veľkosť, hrúbka…)" /><input style={inp} name="system" placeholder="kávový systém" />
        <select style={inp} name="base_unit"><option>ks</option><option>rolka</option><option>ml</option><option>g</option></select>
        <select style={inp} name="home"><option value="">sklad: nepriradený</option>{whOpts}</select>
        <button className="btn ghost" style={{ minHeight: 40 }}>Pridať kartu</button>
      </form>
      <form action={saveItemAction} className="sk-form">
        <span className="sk-sub">Priradiť existujúcej karte sklad:</span>
        <select style={inp} name="id">{itemOpts}</select>
        <select style={inp} name="home" required>{whOpts}</select>
        <button className="btn ghost" style={{ minHeight: 40 }}>Uložiť sklad karty</button>
      </form>

      <h3>Ponuky dodávateľov (verzie podľa platnosti)</h3>
      <div className="tablewrap sk-wrap"><table><thead><tr><th>Karta</th><th>Dodávateľ</th><th>Balenie</th><th className="num">Cena</th><th>Platnosť</th><th>Min. obj.</th><th>Dodanie</th><th>Overenie</th></tr></thead><tbody>
        {v.skus.map((s) => { const p = packInfo(s); const i = item.get(s.itemId); return (
          <tr key={s.id}><td>{i ? itemLabel(i) : '—'}</td><td>{s.supplier}</td>
            <td>{p.verified ? `${p.piecesPerPack} ${i?.baseUnit ?? ''}/bal.${s.purchaseUnit === 'carton' ? ` · kartón ${s.packsPerCarton ?? '?'}` : ''}` : <span className="sk-tag warn">Neoverené – {p.reason}</span>}</td>
            <td className="num">{s.priceCents === null ? '—' : `${(s.priceCents / 100).toFixed(2)} ${s.currency}${s.vatRate !== null ? ` (DPH ${Math.round(s.vatRate * 100)} %)` : ''}`}</td>
            <td>{formatDM(s.validFrom)}{s.validTo ? ` – ${formatDM(s.validTo)}` : ' →'}</td><td>{s.minOrder ?? '—'}</td><td>{s.leadTimeDays === null ? '—' : `${s.leadTimeDays} dní`}</td><td>{s.verifiedSource ? `${s.verifiedSource}, ${s.verifiedAt ? formatDM(s.verifiedAt) : '?'}` : '—'}</td></tr>); })}
        {v.skus.length === 0 && <tr><td colSpan={8} className="empty-note">Zatiaľ žiadna ponuka. Čísla sa nedopĺňajú odhadom: zadaj len to, čo je overené.</td></tr>}
      </tbody></table></div>
      <form action={saveSkuAction} className="sk-form" style={{ marginTop: 8 }}>
        <select style={inp} name="item" required>{itemOpts}</select><input style={inp} name="supplier" placeholder="dodávateľ" required /><input style={inp} name="sku" placeholder="kód dodávateľa" />
        <select style={inp} name="purchase_unit"><option value="pack">kupuje sa balenie</option><option value="carton">kupuje sa kartón</option></select>
        <input style={{ ...inp, width: 110 }} name="pieces" type="number" min={1} placeholder="ks v balení" /><input style={{ ...inp, width: 110 }} name="carton" type="number" min={1} placeholder="bal. v kartóne" />
        <input style={{ ...inp, width: 100 }} name="price" placeholder="cena €" /><input style={{ ...inp, width: 90 }} name="vat" placeholder="DPH %" /><input style={{ ...inp, width: 100 }} name="min_order" type="number" min={1} placeholder="min. obj." /><input style={{ ...inp, width: 100 }} name="lead" type="number" min={0} placeholder="dodanie dní" />
        <label className="sk-sub">platí od<input style={inp} name="valid_from" type="date" defaultValue={v.today} required /></label>
        <input style={inp} name="source" placeholder="zdroj overenia (ponuka, e-shop…)" /><label className="sk-sub">overené dňa<input style={inp} name="verified_at" type="date" /></label>
        <button className="btn ghost" style={{ minHeight: 40 }}>Pridať verziu ponuky</button>
        <span className="sk-sub" style={{ flexBasis: '100%' }}>Nová verzia uzavrie predchádzajúcu verziu rovnakého dodávateľa dňom pred začiatkom. Bez kusov v balení, zdroja a dátumu overenia zostáva balenie „Neoverené“.</span>
      </form>

      <h3>Priradenie riadkov z balenia ku kartám</h3>
      <div className="tablewrap sk-wrap"><table><thead><tr><th>Druh</th><th>Kľúč z karty balenia</th><th>Karta</th><th className="num">Faktor</th></tr></thead><tbody>
        {v.aliases.map((a) => <tr key={`${a.kind}:${a.sourceKey}`}><td>{a.kind}</td><td>{a.sourceKey}</td><td>{item.get(a.itemId) ? itemLabel(item.get(a.itemId)!) : '—'}</td><td className="num">{a.factor}</td></tr>)}
      </tbody></table></div>
      <form action={saveAliasAction} className="sk-form" style={{ marginTop: 8 }}>
        <select style={inp} name="kind"><option value="consumable">spotrebný materiál (kľúč)</option><option value="capsule">kapsule (typeKey malými písmenami)</option><option value="linen">bielizeň (kľúč|veľkosť)</option></select>
        <input style={inp} name="source_key" placeholder={v.unmapped[0] ? `napr. ${v.unmapped[0].sourceKey || 'nespresso original'}` : 'kľúč'} required />
        <select style={inp} name="item" required>{itemOpts}</select><input style={{ ...inp, width: 80 }} name="factor" type="number" min={1} defaultValue={1} />
        <button className="btn ghost" style={{ minHeight: 40 }}>Uložiť priradenie</button>
      </form>
    </SkladShell>
  );
}
