import { redirect } from 'next/navigation';
import { loadDelivered } from '@/app/_lib/admin';
import { deliveredInOrder, deliveryLine, isYearMonth } from '@/app/_lib/delivery';
import { getViewer } from '@/app/_lib/viewer';
import { formatDM, formatHM, todayInTz } from '@/core/packing';
import { sk } from '@/core/i18n/sk';
import { AdminShell } from '@/ui/AdminShell';
import { HistoryNav } from '@/ui/HistoryNav';

export const dynamic = 'force-dynamic';

/** "Vyúčtovanie" (Martina, 2026-11-09): what was ticked "Dodané" in a month, in the order it was delivered; the flat is in the text. */
export default async function BillingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await getViewer();
  if (!viewer) redirect('/login');
  if (viewer.role !== 'admin') redirect('/');
  const sp = await searchParams;
  const asked = typeof sp.mesiac === 'string' ? sp.mesiac : null;
  const ym = isYearMonth(asked) ? asked : todayInTz(new Date()).slice(0, 7);
  const rows = deliveredInOrder(await loadDelivered(ym));
  const total = rows.length;

  return (
    <AdminShell viewer={viewer}>
      <section className="sheet">
        <h2>História</h2>
        <HistoryNav current="billing" />
        <p style={{ color: 'var(--muted)', marginTop: 0 }}>Všetko, čo sa z „{sk.delivery.title}“ odkliklo ako Dodané v zvolenom mesiaci, podľa dátumu dodania. Byt je uvedený v texte zápisu.</p>
        <form method="get" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12 }}>
          <div className="form-row">
            <label htmlFor="mesiac">Mesiac</label>
            <input id="mesiac" name="mesiac" type="month" defaultValue={ym} />
          </div>
          <div className="form-row">
            <button className="btn primary" type="submit" style={{ minHeight: 44 }}>
              Zobraziť
            </button>
          </div>
          <div className="form-row">
            <a className="btn ghost" style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center' }} href={`/historia/vyuctovanie/export.csv?mesiac=${ym}`}>
              {sk.buttons.exportCsv}
            </a>
          </div>
        </form>
        {total === 0 ? (
          <div className="empty-note">V tomto mesiaci sa nič neodkliklo ako Dodané.</div>
        ) : (
          <>
            <p style={{ margin: '0 0 10px', fontWeight: 700 }}>
              Spolu {total} {total === 1 ? 'dodaný zápis' : total < 5 ? 'dodané zápisy' : 'dodaných zápisov'}
            </p>
            <div className="tablewrap">
              <table>
                <thead>
                  <tr>
                    <th>Dodané kedy</th>
                    <th>Deň balenia</th>
                    <th>Zápis (byt a položky)</th>
                    <th>Dodal(a)</th>
                    <th>Zapísal(a)</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td style={{ whiteSpace: 'nowrap' }}>{r.delivered_at ? `${formatDM(todayInTz(new Date(r.delivered_at)))} ${formatHM(new Date(r.delivered_at))}` : ''}</td>
                      <td>{formatDM(r.date)}</td>
                      <td style={{ textAlign: 'left', whiteSpace: 'pre-wrap', minWidth: 220 }}>{deliveryLine(r)}</td>
                      <td>{r.delivered_by_name ?? '—'}</td>
                      <td>{r.author_name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </AdminShell>
  );
}
