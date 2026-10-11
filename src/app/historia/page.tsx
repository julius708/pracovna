import Link from 'next/link';
import { redirect } from 'next/navigation';
import { loadHistory } from '@/app/_lib/admin';
import { HISTORY_PAGE, historyFilterFrom } from '@/app/_lib/history-filter';
import { getViewer } from '@/app/_lib/viewer';
import { formatDM, formatHM, todayInTz } from '@/core/packing';
import { sk } from '@/core/i18n/sk';
import { AdminShell } from '@/ui/AdminShell';
import { HistoryNav } from '@/ui/HistoryNav';

export const dynamic = 'force-dynamic';

const EVENTS: Record<string, string> = {
  created: 'vytvorené',
  recomputed: 'prepočítané',
  moved: 'presunuté',
  cancelled: 'zrušené',
  restored: 'obnovené',
  packed: 'zabalené',
  unpacked: 'vrátené',
  note: 'poznámka',
  checklist: 'checklist',
  settings_recompute: 'prepočet po nastavení',
};

function detail(e: { event: string; data: Record<string, unknown> }): string {
  const d = e.data ?? {};
  switch (e.event) {
    case 'note':
      return String(d.note ?? '');
    case 'checklist':
      return `${d.item}: ${d.checked ? 'áno' : 'nie'}`;
    case 'recomputed':
    case 'settings_recompute':
      return Array.isArray(d.changed) ? d.changed.join(', ') : '';
    case 'cancelled':
      return String(d.reason ?? '');
    case 'moved':
      return `${(d.from as { date?: string })?.date ?? ''} → ${(d.to as { date?: string })?.date ?? ''}`;
    case 'created':
      return `osoby: ${d.people ?? ''}`;
    case 'unpacked':
      return d.previously_packed_by ? `predtým: ${d.previously_packed_by}` : '';
    default:
      return '';
  }
}

export default async function HistoryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await getViewer();
  if (!viewer) redirect('/login');
  if (viewer.role !== 'admin') redirect('/');
  const sp = await searchParams;
  const f = historyFilterFrom((k) => (typeof sp[k] === 'string' ? (sp[k] as string) : undefined), todayInTz(new Date()));
  const view = await loadHistory(f);
  const qs = new URLSearchParams({ od: f.from, do: f.to, ...(f.listingId ? { byt: f.listingId } : {}), ...(f.actor ? { osoba: f.actor } : {}), ...(f.event ? { udalost: f.event } : {}) });

  return (
    <AdminShell viewer={viewer}>
      <section className="sheet">
        <h2>História</h2>
        <HistoryNav current="events" />
        <form method="get" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12 }}>
          <div className="form-row">
            <label htmlFor="od">Od</label>
            <input id="od" name="od" type="date" defaultValue={f.from} />
          </div>
          <div className="form-row">
            <label htmlFor="do">Do</label>
            <input id="do" name="do" type="date" defaultValue={f.to} />
          </div>
          <div className="form-row">
            <label htmlFor="byt">Byt</label>
            <select id="byt" name="byt" defaultValue={f.listingId ?? ''}>
              <option value="">všetky</option>
              {view.listings.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <label htmlFor="osoba">Osoba</label>
            <select id="osoba" name="osoba" defaultValue={f.actor ?? ''}>
              <option value="">všetky</option>
              {view.actors.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <label htmlFor="udalost">Udalosť</label>
            <select id="udalost" name="udalost" defaultValue={f.event ?? ''}>
              <option value="">všetky</option>
              {Object.entries(EVENTS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <button className="btn primary" type="submit" style={{ minHeight: 44 }}>
              Filtrovať
            </button>
          </div>
          <div className="form-row">
            <a className="btn ghost" style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center' }} href={`/historia/export.csv?${qs.toString()}`}>
              {sk.buttons.exportCsv}
            </a>
          </div>
        </form>
        {view.rows.length === 0 ? (
          <div className="empty-note">Žiadne udalosti pre tento filter.</div>
        ) : (
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Čas</th>
                  <th>Deň balenia</th>
                  <th>Byt</th>
                  <th>Udalosť</th>
                  <th>Kto</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {view.rows.map((e) => (
                  <tr key={e.id}>
                    <td style={{ textAlign: 'left' }}>
                      {formatDM(todayInTz(new Date(e.created_at)))} {formatHM(new Date(e.created_at))}
                    </td>
                    <td>{formatDM(e.package_date)}</td>
                    <td style={{ textAlign: 'left' }}>{e.listing_name}</td>
                    <td>{EVENTS[e.event] ?? e.event}</td>
                    <td>{e.actor_name}</td>
                    <td style={{ textAlign: 'left', whiteSpace: 'normal' }}>{detail(e)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="actions">
          {f.page > 1 && (
            <Link className="btn ghost" href={`/historia?${qs.toString()}&strana=${f.page - 1}`}>
              ← Predchádzajúca
            </Link>
          )}
          {view.hasMore && (
            <Link className="btn ghost" href={`/historia?${qs.toString()}&strana=${f.page + 1}`}>
              Ďalšia ({HISTORY_PAGE}) →
            </Link>
          )}
        </div>
      </section>
    </AdminShell>
  );
}
