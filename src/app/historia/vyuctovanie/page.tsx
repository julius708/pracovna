import { redirect } from 'next/navigation';
import { loadDelivered } from '@/app/_lib/admin';
import { billingByFlat, isYearMonth } from '@/app/_lib/delivery';
import { getViewer } from '@/app/_lib/viewer';
import { formatDM, formatHM, todayInTz } from '@/core/packing';
import { sk } from '@/core/i18n/sk';
import { AdminShell } from '@/ui/AdminShell';
import { HistoryNav } from '@/ui/HistoryNav';

export const dynamic = 'force-dynamic';

/** "Vyúčtovanie" (Martina, 2026-11-09): what was ticked "Dodané" for which flat in a month. */
export default async function BillingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await getViewer();
  if (!viewer) redirect('/login');
  if (viewer.role !== 'admin') redirect('/');
  const sp = await searchParams;
  const asked = typeof sp.mesiac === 'string' ? sp.mesiac : null;
  const ym = isYearMonth(asked) ? asked : todayInTz(new Date()).slice(0, 7);
  const groups = billingByFlat(await loadDelivered(ym));
  const total = groups.reduce((n, g) => n + g.items.length, 0);

  return (
    <AdminShell viewer={viewer}>
      <section className="sheet">
        <h2>História</h2>
        <HistoryNav current="billing" />
        <p style={{ color: 'var(--muted)', marginTop: 0 }}>Všetko, čo sa z „{sk.delivery.title}“ odkliklo ako Dodané v zvolenom mesiaci, podľa bytov.</p>
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
        {groups.length === 0 ? (
          <div className="empty-note">V tomto mesiaci sa nič neodkliklo ako Dodané.</div>
        ) : (
          <>
            <p style={{ margin: '0 0 10px', fontWeight: 700 }}>
              Spolu {total} {total === 1 ? 'položka' : total < 5 ? 'položky' : 'položiek'} na {groups.length} {groups.length === 1 ? 'byt' : groups.length < 5 ? 'byty' : 'bytov'}
            </p>
            <div className="tablewrap">
              <table>
                <thead>
                  <tr>
                    <th>Byt</th>
                    <th>Deň balenia</th>
                    <th>Čo sa dodalo</th>
                    <th>Dodal(a)</th>
                    <th>Kedy</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.flatMap((g) =>
                    g.items.map((r, i) => (
                      <tr key={r.id}>
                        <td style={{ textAlign: 'left', fontWeight: i === 0 ? 800 : 400 }}>{i === 0 ? `${g.listing_name} (${g.items.length})` : ''}</td>
                        <td>{formatDM(r.date)}</td>
                        <td style={{ textAlign: 'left', whiteSpace: 'pre-wrap' }}>{r.text}</td>
                        <td>{r.delivered_by_name ?? '—'}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>{r.delivered_at ? `${formatDM(todayInTz(new Date(r.delivered_at)))} ${formatHM(new Date(r.delivered_at))}` : ''}</td>
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </AdminShell>
  );
}
