'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { StatusView } from '@/app/_lib/admin';
import { syncNowAction, type SyncJob } from '@/app/_lib/admin-actions';
import { formatDM, formatHM, todayInTz } from '@/core/packing';
import { sk } from '@/core/i18n/sk';

function when(iso: unknown): string {
  if (typeof iso !== 'string' || !iso) return '—';
  const d = new Date(iso);
  return `${formatDM(todayInTz(d))} ${formatHM(d)}`;
}

function age(iso: unknown, now: number): string {
  if (typeof iso !== 'string' || !iso) return '—';
  const min = Math.round((now - Date.parse(iso)) / 60_000);
  return min < 60 ? `pred ${min} min` : `pred ${Math.round(min / 60)} h`;
}

export function StatusPanel({ view }: { view: StatusView }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [now] = useState(() => Date.now());
  const [pending, start] = useTransition();
  const router = useRouter();
  const run = (job: SyncJob) =>
    start(async () => {
      setMsg('Spúšťam…');
      const r = await syncNowAction(job);
      setMsg(r.summary);
      router.refresh();
    });
  const s = view.state;
  const alerts = ((s.alert_state as { open?: Record<string, unknown> } | null)?.open ?? {}) as Record<string, unknown>;
  const reg = s.webhook_registration as { url?: string; at?: string } | null;
  const lists: [string, string[]][] = [
    ['Chýba kalendár (min. pobyt)', view.issues.minNightsUnknown],
    ['Postele nestačia', view.issues.bedsInsufficient],
    ['Bez poľa práčovne', view.issues.noLaundryField],
    ['Kúpeľne nezadané', view.issues.bathroomsMissing],
    ['Rezervácie s viacerými bytmi', view.issues.multiStay],
  ];

  return (
    <section className="sheet">
      <h2>Stav synchronizácie</h2>
      <div className="stats">
        <div className="stat">
          <small>Posledná úspešná synchronizácia</small>
          <b>{age(s.last_ok_sync_at, now)}</b>
          <small>{when(s.last_ok_sync_at)}</small>
        </div>
        <div className="stat">
          <small>Zlyhania za sebou</small>
          <b>{String(s.consecutive_failures ?? 0)}</b>
          <small>čiastočné behy: {String(s.partial_runs ?? 0)}</small>
        </div>
        <div className="stat">
          <small>Posledný webhook</small>
          <b>{age(s.last_webhook_at, now)}</b>
          <small>{reg?.url ? 'zaregistrovaný' : 'nezaregistrovaný'}</small>
        </div>
        <div className="stat">
          <small>Guesty token</small>
          <b>{view.token.expiresAt ? `${Math.max(0, Math.round((Date.parse(view.token.expiresAt) - now) / 3_600_000))} h` : '—'}</b>
          <small>vytvorené za 24 h: {view.token.mints24h} / 3</small>
        </div>
        <div className="stat">
          <small>Balíčky v okne</small>
          <b>{view.packagesInWindow}</b>
          <small>byty načítané {age(s.listings_synced_at, now)}</small>
        </div>
        <div className="stat">
          <small>Otvorené upozornenia</small>
          <b>{Object.keys(alerts).length}</b>
          <small>{Object.keys(alerts).join(', ') || 'žiadne'}</small>
        </div>
      </div>
      {s.listing_drop ? <div className="note">Posledné načítanie bytov by vyradilo priveľa bytov a nebolo použité.</div> : null}

      <div className="actions">
        <button className="btn primary" type="button" disabled={pending} onClick={() => run('reconcile')}>
          {sk.buttons.syncNow}
        </button>
        <button className="btn ghost" type="button" disabled={pending} onClick={() => run('listings')}>
          Znovu načítať byty
        </button>
        <button className="btn ghost" type="button" disabled={pending} onClick={() => run('recompute')}>
          Prepočítať balíčky
        </button>
      </div>
      {msg && (
        <div className="note" role="status">
          {msg}
        </div>
      )}

      {lists.some(([, items]) => items.length > 0) && (
        <>
          <h3>Na kontrolu</h3>
          {lists
            .filter(([, items]) => items.length)
            .map(([title, items]) => (
              <p key={title}>
                <b>{title}:</b> {items.join(', ')}
              </p>
            ))}
        </>
      )}

      <h3>Posledné behy</h3>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Čas</th>
              <th>Úloha</th>
              <th>Spustil</th>
              <th>Výsledok</th>
              <th>Guesty volania</th>
              <th>Trvanie</th>
            </tr>
          </thead>
          <tbody>
            {view.runs.map((r) => (
              <tr key={r.id}>
                <td>{when(r.started_at)}</td>
                <td>{r.job}</td>
                <td>{r.trigger}</td>
                <td style={{ color: r.ok === false ? 'var(--warn)' : undefined }}>{r.ok === null ? 'beží' : r.ok ? (r.partial?.length ? `čiastočne (${r.partial.join(', ')})` : 'ok') : `zlyhalo: ${r.error ?? ''}`}</td>
                <td>{r.guesty_calls}</td>
                <td>{typeof (r.stats as { duration_ms?: number })?.duration_ms === 'number' ? `${(r.stats as { duration_ms: number }).duration_ms} ms` : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3>Posledné webhooky</h3>
      {view.webhookEvents.length === 0 ? (
        <div className="empty-note">Zatiaľ žiadne.</div>
      ) : (
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Prijaté</th>
                <th>Udalosť</th>
                <th>Objekt</th>
                <th>Stav</th>
                <th>Chyba</th>
              </tr>
            </thead>
            <tbody>
              {view.webhookEvents.map((e) => (
                <tr key={e.id}>
                  <td>{when(e.received_at)}</td>
                  <td>{e.event ?? '—'}</td>
                  <td>{e.object_id ?? '—'}</td>
                  <td>{e.status}</td>
                  <td style={{ whiteSpace: 'normal' }}>{e.error ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
