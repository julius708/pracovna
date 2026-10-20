import Link from 'next/link';
import { Fragment } from 'react';
import { redirect } from 'next/navigation';
import { loadPackingLog } from '@/app/_lib/admin';
import { HISTORY_PAGE, historyFilterFrom } from '@/app/_lib/history-filter';
import { BILLING_NOTE, NOT_EXACT_NOTE, snapshotText, statusNote, threadDayNotes } from '@/app/_lib/packing-log';
import { getViewer } from '@/app/_lib/viewer';
import { addDays, formatDM, formatHM, todayInTz, weekdayShort, WINDOW_DAYS } from '@/core/packing';
import { sk } from '@/core/i18n/sk';
import { AdminShell } from '@/ui/AdminShell';
import { HistoryNav } from '@/ui/HistoryNav';

export const dynamic = 'force-dynamic';

/** "Zabalené balíčky": one row per packed card - who, when, for how many people and the exact counts. */
export default async function PackingLogPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await getViewer();
  if (!viewer) redirect('/login');
  if (viewer.role !== 'admin') redirect('/');
  const sp = await searchParams;
  // cards are packed up to a week ahead, so the default range runs from last week to the end of the board window
  const today = todayInTz(new Date());
  const f = historyFilterFrom((k) => (typeof sp[k] === 'string' ? (sp[k] as string) : undefined), today, { to: addDays(today, WINDOW_DAYS - 1) });
  const view = await loadPackingLog(f);
  const qs = new URLSearchParams({ od: f.from, do: f.to, ...(f.listingId ? { byt: f.listingId } : {}), ...(f.actor ? { osoba: f.actor } : {}) });

  return (
    <AdminShell viewer={viewer}>
      <section className="sheet">
        <h2>História</h2>
        <HistoryNav current="packed" />
        <p style={{ color: 'var(--muted)', marginTop: 0 }}>
          Čo presne sa zabalilo: kto, kedy, na koľko osôb a koľko čoho – tak, ako to bolo na karte vo chvíli zabalenia. Pri každom dni je aj Dôležité info toho dňa; karta s poznámkou (niečo treba doniesť) je označená {BILLING_NOTE}.
        </p>
        <form method="get" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12 }}>
          <div className="form-row">
            <label htmlFor="od">Deň balenia od</label>
            <input id="od" name="od" type="date" defaultValue={f.from} />
          </div>
          <div className="form-row">
            <label htmlFor="do">do</label>
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
            <label htmlFor="osoba">Zabalil(a)</label>
            <select id="osoba" name="osoba" defaultValue={f.actor ?? ''}>
              <option value="">všetci</option>
              {view.actors.map((a) => (
                <option key={a} value={a}>
                  {a}
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
            <a className="btn ghost" style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center' }} href={`/historia/balenie/export.csv?${qs.toString()}`}>
              {sk.buttons.exportCsv}
            </a>
          </div>
        </form>
        {view.rows.length === 0 ? (
          <div className="empty-note">Žiadne zabalené balíčky pre tento filter.</div>
        ) : (
          <div className="tablewrap">
            <table className="packlog">
              <thead>
                <tr>
                  <th>Deň balenia</th>
                  <th>Byt</th>
                  <th>Zabalil(a)</th>
                  <th>Osoby</th>
                  <th>Prádlo</th>
                  <th>{sk.consumablesTitle}</th>
                  <th>Kapsule</th>
                </tr>
              </thead>
              <tbody>
                {view.rows.map((e, i) => {
                  const t = snapshotText(e.snapshot);
                  const note = statusNote(e.status, e.superseded);
                  const firstOfDay = i === 0 || view.rows[i - 1].package_date !== e.package_date;
                  const dayNotes = threadDayNotes(view.dayNotes[e.package_date] ?? []);
                  return (
                    <Fragment key={e.id}>
                    {firstOfDay && (
                      <tr className="packlog-day">
                        <td colSpan={7} style={{ textAlign: 'left', whiteSpace: 'normal' }}>
                          {/* stays in view and wraps while the wide table scrolls sideways on a phone */}
                          <div style={{ position: 'sticky', left: 0, maxWidth: 'min(640px, calc(100vw - 80px))' }}>
                          <b>
                            {weekdayShort(e.package_date)} {formatDM(e.package_date)}
                          </b>
                          {dayNotes.length === 0 ? (
                            <small style={{ display: 'block', color: 'var(--muted)' }}>{sk.noticeBoard.title}: –</small>
                          ) : (
                            <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                              {dayNotes.map(({ note: n, reply }) => (
                                <li key={n.id} style={reply ? { listStyle: 'none', marginLeft: 12 } : undefined}>
                                  {reply ? '↳ ' : '📌 '}
                                  {n.text}{' '}
                                  <small style={{ color: 'var(--muted)' }}>
                                    · {n.author_name} · {formatDM(todayInTz(new Date(n.created_at)))} {formatHM(new Date(n.created_at))}
                                  </small>
                                </li>
                              ))}
                            </ul>
                          )}
                          </div>
                        </td>
                      </tr>
                    )}
                    <tr>
                      <td style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>
                        {weekdayShort(e.package_date)} {formatDM(e.package_date)}
                      </td>
                      <td style={{ textAlign: 'left' }}>
                        {e.listing_name}
                        {e.snapshot?.private && <small style={{ display: 'block', color: 'var(--priv)' }}>súkromné prádlo</small>}
                        {note && <small style={{ display: 'block', color: 'var(--muted)' }}>{note}</small>}
                        {!e.exact && e.snapshot && <small style={{ display: 'block', color: 'var(--muted)' }}>{NOT_EXACT_NOTE}</small>}
                        {e.note && (
                          <small style={{ display: 'block', whiteSpace: 'normal' }}>
                            <b style={{ color: 'var(--warn)' }}>{BILLING_NOTE}</b> · {e.note}
                            {e.note_by_name && <span style={{ color: 'var(--muted)' }}> ({e.note_by_name})</span>}
                          </small>
                        )}
                      </td>
                      <td style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>
                        {e.actor_name}
                        <small style={{ display: 'block', color: 'var(--muted)' }}>
                          {formatDM(todayInTz(new Date(e.created_at)))} {formatHM(new Date(e.created_at))}
                        </small>
                      </td>
                      <td>{e.snapshot ? e.snapshot.people : '—'}</td>
                      <td style={{ textAlign: 'left', whiteSpace: 'normal', minWidth: 220 }}>{t.linen || '—'}</td>
                      <td style={{ textAlign: 'left', whiteSpace: 'normal', minWidth: 200 }}>{t.consumables || '—'}</td>
                      <td style={{ textAlign: 'left', whiteSpace: 'normal' }}>{t.capsules || '—'}</td>
                    </tr>
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="actions">
          {f.page > 1 && (
            <Link className="btn ghost" href={`/historia/balenie?${qs.toString()}&strana=${f.page - 1}`}>
              ← Predchádzajúca
            </Link>
          )}
          {view.hasMore && (
            <Link className="btn ghost" href={`/historia/balenie?${qs.toString()}&strana=${f.page + 1}`}>
              Ďalšia ({HISTORY_PAGE}) →
            </Link>
          )}
        </div>
      </section>
    </AdminShell>
  );
}
