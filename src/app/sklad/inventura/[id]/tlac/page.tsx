import { notFound } from 'next/navigation';
import { sklad } from '@/app/_lib/sklad-guard';
import { loadStock } from '@/app/_lib/sklad';
import { itemLabel } from '@/app/_lib/sklad-ui';
import { formatDM } from '@/core/packing';
import { packInfo } from '@/core/stock';
import { PrintButton } from '@/ui/sklad/PrintButton';

export const dynamic = 'force-dynamic';

/** Inventory sheet for A4: print it or "Save as PDF". Fields stay empty on purpose (empty is not zero). */
export default async function InventuraTlac({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await sklad();
  const { id } = await params;
  const v = await loadStock(viewer);
  const inv = v.inventories.find((i) => i.id === id);
  if (!inv) notFound();
  const wh = v.warehouses.find((w) => w.id === inv.warehouseId);
  const items = v.items.filter((i) => v.homeWarehouse[i.id] === inv.warehouseId);
  return (
    <div className="skp">
      <style>{`
        .skp{max-width:210mm;margin:0 auto;padding:12mm;background:#fff;color:#000;font:13px/1.35 system-ui,sans-serif}
        .skp h1{font-size:20px;margin:0 0 4px}
        .skp table{width:100%;border-collapse:collapse;margin-top:10px}
        .skp th,.skp td{border:1px solid #444;padding:6px 7px;text-align:left;white-space:normal;position:static}
        .skp th{background:#eee;font-size:11px}
        .skp td.box{height:26px;min-width:70px}
        .skp .meta{display:grid;grid-template-columns:1fr 1fr;gap:6px 18px;margin:8px 0}
        .skp .line{border-bottom:1px solid #000;min-height:22px}
        @media print{@page{size:A4;margin:10mm}.no-print{display:none!important}.skp{padding:0}}
      `}</style>
      <div className="no-print" style={{ marginBottom: 10 }}><PrintButton /></div>
      <h1>Inventúra · {wh?.name}{v.mode !== 'live' ? ' (ukážka)' : ''}</h1>
      <div>Dátum inventúry: <b>{formatDM(inv.inventoryDate)}</b>{inv.title ? ` · ${inv.title}` : ''}</div>
      <div className="meta">
        <div>Spočítal(a): <div className="line" /></div><div>Čas spočítania: <div className="line" /></div>
        <div>Zdroj (polica / miestnosť): <div className="line" /></div><div>Poznámka: <div className="line" /></div>
      </div>
      <table>
        <thead><tr><th>Karta</th><th>Jednotka</th><th>Kusov v balení</th><th>Celé balenia</th><th>Voľné kusy</th><th>Polica</th><th>Spolu</th></tr></thead>
        <tbody>
          {items.map((i) => {
            const skus = v.skus.filter((s) => s.itemId === i.id && s.validFrom <= v.today && (s.validTo === null || s.validTo >= v.today));
            const ppp = [...new Set(skus.map((s) => { const p = packInfo(s); return p.verified ? String(p.piecesPerPack) : null; }).filter(Boolean))];
            return (
              <tr key={i.id}><td>{itemLabel(i)}</td><td>{i.baseUnit}</td><td>{ppp.length === 0 ? 'Neoverené' : ppp.join(' / ')}</td><td className="box" /><td className="box" /><td className="box" /><td className="box" /></tr>
            );
          })}
        </tbody>
      </table>
      <p style={{ marginTop: 10 }}>Spolu = celé balenia × kusov v balení + voľné kusy. Prázdne pole znamená „nespočítané“; ak je tovaru naozaj nula, napíš 0 a podčiarkni.</p>
    </div>
  );
}
