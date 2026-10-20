'use client';

import { useState, type FormEvent } from 'react';
import type { EarlyArrival } from '@/app/_lib/board';
import type { Viewer } from '@/app/_lib/viewer';
import { flatAlias } from '@/core/packing';
import { noteTime, sk } from '@/core/i18n/sk';
import { isArrivalTime } from './board-model';

const DEFAULT_TIME = '12:00';

export interface EarlyArrivalsProps {
  /** Entries of the selected day only, earliest first. */
  arrivals: EarlyArrival[];
  /** In-scope flats for the picker. */
  listings: { id: string; name: string }[];
  /** "Dnes 11.10." / "Zajtra 12.10.": the day the box belongs to. */
  dayTitle: string;
  viewer: Viewer;
  /** The board's clock (seeded from the server so SSR and client agree). */
  now: Date;
  busy: boolean;
  /** Resolves true when the entry was saved; the form then clears and closes. */
  onAdd: (listingId: string, arrival: string, note: string) => Promise<boolean>;
  onRemove: (arrival: EarlyArrival) => void;
}

/**
 * "Skoré príchody": the red box under "Dôležité info", one per board day
 * (owner, 2026-10-11). The office writes a guest arriving before 16:00 here
 * (Martina, 2026-10-19: typed in, not taken from Guesty); everyone sees it,
 * the flat's card for that day shows it too, and the other people's phones get
 * a notification. The author or an admin removes an entry.
 */
export function EarlyArrivals({ arrivals, listings, dayTitle, viewer, now, busy, onAdd, onRemove }: EarlyArrivalsProps) {
  const [open, setOpen] = useState(false);
  const [listingId, setListingId] = useState('');
  const [time, setTime] = useState(DEFAULT_TIME);
  const [note, setNote] = useState('');
  const t = sk.earlyArrivals;

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!listingId || !isArrivalTime(time)) return;
    const ok = await onAdd(listingId, time, note.trim());
    if (!ok) return; // keep what was typed so it can be sent again
    setListingId('');
    setNote('');
    setTime(DEFAULT_TIME);
    setOpen(false);
  };

  return (
    <section className="arrivals" aria-labelledby="arrivals-title">
      <h2 id="arrivals-title" className="arrivals-title">
        <span aria-hidden="true">⏰</span> {t.title}
        <span className="notice-day">{dayTitle}</span>
      </h2>
      {arrivals.length === 0 ? (
        <p className="notice-empty">{t.empty}</p>
      ) : (
        <ul className="notice-list">
          {arrivals.map((a) => {
            const own = a.author === viewer.id;
            const alias = flatAlias(a.listing_id);
            return (
              <li key={a.id} className="notice-item arrival-item">
                <div className="arrival-head">
                  <b className="arrival-time">{t.line(a.arrival)}</b>
                  <span className="arrival-flat">
                    {a.listing_name}
                    {alias && <small> · {alias}</small>}
                  </span>
                </div>
                {a.note && <div className="notice-text arrival-note">{a.note}</div>}
                <div className="notice-meta">
                  <span>{t.by(a.author_name, noteTime(a.created_at, now))}</span>
                  {(own || viewer.role === 'admin') && (
                    <button type="button" className="notice-remove" disabled={busy} onClick={() => onRemove(a)}>
                      {t.remove}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {!open && (
        <button type="button" className="btn ghost arrival-open" onClick={() => setOpen(true)} disabled={busy}>
          {t.open}
        </button>
      )}
      {open && (
        <form className="arrival-form" onSubmit={(e) => void submit(e)}>
          <label className="arrival-field">
            <span>{t.flat}</span>
            <select value={listingId} onChange={(e) => setListingId(e.target.value)} disabled={busy} required autoFocus>
              <option value="">{t.pickFlat}</option>
              {listings.map((l) => {
                const alias = flatAlias(l.id);
                return (
                  <option key={l.id} value={l.id}>
                    {l.name}
                    {alias ? ` (${alias})` : ''}
                  </option>
                );
              })}
            </select>
          </label>
          <label className="arrival-field arrival-field-time">
            <span>{t.time}</span>
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} disabled={busy} required step={300} />
          </label>
          <label className="arrival-field arrival-field-note">
            <span>{t.note}</span>
            <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t.notePlaceholder} maxLength={300} disabled={busy} />
          </label>
          <div className="arrival-actions">
            <button type="button" className="btn ghost" onClick={() => setOpen(false)} disabled={busy}>
              {t.cancel}
            </button>
            <button className="btn primary" type="submit" disabled={busy || !listingId || !isArrivalTime(time)}>
              {t.add}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
