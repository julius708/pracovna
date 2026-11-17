import Link from 'next/link';
import type { ReactNode } from 'react';
import type { StockView } from '@/app/_lib/sklad';
import { messageOf } from '@/app/_lib/sklad-ui';
import type { Viewer } from '@/app/_lib/viewer';
import { AdminShell } from '@/ui/AdminShell';

const TABS: { key: string; href: string; label: string; admin?: boolean }[] = [
  { key: 'stav', href: '/sklad', label: 'Stav', admin: true },
  { key: 'inventura', href: '/sklad/inventura', label: 'Inventúra', admin: true },
  { key: 'pohyby', href: '/sklad/pohyby', label: 'Pohyby' },
  { key: 'spotreba', href: '/sklad/spotreba', label: 'Spotreba', admin: true },
  { key: 'objednavky', href: '/sklad/objednavky', label: 'Objednávky', admin: true },
  { key: 'katalog', href: '/sklad/katalog', label: 'Katalóg a nastavenie', admin: true },
];

/** Header, tabs, state banners (ukážka / bez migrácie / odpočty vypnuté) and the result message of the last form. */
export function SkladShell({ viewer, view, current, m, title, children }: { viewer: Viewer; view: StockView; current: string; m?: string; title: string; children: ReactNode }) {
  const msg = messageOf(m);
  const bad = m?.startsWith('err:');
  return (
    <AdminShell viewer={viewer}>
      <section className="sheet">
        <h2>Sklad</h2>
        <nav className="subnav" aria-label="Sklad">
          {TABS.filter((t) => !t.admin || view.isAdmin).map((t) => (
            <Link key={t.key} className="btn ghost" href={t.href} aria-current={current === t.key ? 'page' : undefined}>
              {t.label}
            </Link>
          ))}
        </nav>
        {view.mode === 'demo' && (
          <div className="sk-banner warn" role="status">
            <b>Ukážka.</b> Toto sú vymyslené dáta na predstavu obrazoviek (nie skutočné zásoby, ceny ani dodávatelia). Nič sa neukladá.
          </div>
        )}
        {view.mode === 'not_migrated' && (
          <div className="sk-banner warn" role="status">
            <b>Sklad ešte nie je zapnutý v databáze.</b> Migrácia 0021 čaká na schválenie; zatiaľ vidíš ukážku s vymyslenými dátami. Nič sa neukladá.
          </div>
        )}
        {view.mode === 'live' && !view.config.deductionEnabled && (
          <div className="sk-banner" role="status">
            <b>Odpočty zo skladu sú vypnuté.</b> Zabalenie zatiaľ nič nevydáva. Zapnú sa až po schválenej začiatočnej inventúre
            {view.config.baselineAt ? ' (začiatočný stav je schválený, zapnutie je v „Katalóg a nastavenie“).' : '.'}
          </div>
        )}
        {msg && (
          <div className={`sk-banner ${bad ? 'bad' : 'ok'}`} role={bad ? 'alert' : 'status'}>
            {msg}
          </div>
        )}
        <h3 style={{ marginTop: 14 }}>{title}</h3>
        {children}
      </section>
      <style>{SK_CSS}</style>
    </AdminShell>
  );
}

const SK_CSS = `
.sk-banner{margin:0 0 12px;padding:10px 12px;border-radius:10px;border:1px solid var(--line);background:var(--surface-2);font-size:14px}
.sk-banner.warn{border-color:#d9a400;background:rgba(255,196,0,.14)}
.sk-banner.bad{border-color:#c0392b;background:rgba(192,57,43,.12)}
.sk-banner.ok{border-color:var(--ok);background:rgba(46,160,67,.1)}
.sk-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:0 0 14px}
.sk-card{border:1px solid var(--line);border-radius:12px;padding:10px 12px;background:var(--surface)}
.sk-card b{display:block;font-size:22px;font-variant-numeric:tabular-nums}
.sk-card span{font-size:12px;color:var(--muted)}
.sk-tag{display:inline-block;font-size:11px;font-weight:700;padding:3px 8px;border-radius:999px;background:var(--surface-2);margin-right:4px}
.sk-tag.bad{background:rgba(192,57,43,.16)}
.sk-tag.warn{background:rgba(255,196,0,.22)}
.sk-form{display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin:0 0 12px}
.sk-form .form-row{flex:0 1 auto}
.sk-form input[type=number]{width:96px}
.sk-wrap td,.sk-wrap th{white-space:normal;text-align:left}
.sk-wrap td.num,.sk-wrap th.num{text-align:right;font-variant-numeric:tabular-nums}
.sk-wrap td:first-child,.sk-wrap th:first-child{position:static}
.sk-wrap td input{width:76px}
.sk-wrap td input.wide{width:150px;text-align:left}
.sk-wrap td select{max-width:190px}
.sk-sub{color:var(--muted);font-size:12px}
`;
