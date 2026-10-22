'use client';

import { useState, type FormEvent } from 'react';
import type { EarlyDeparture } from '@/app/_lib/board';
import type { Viewer } from '@/app/_lib/viewer';
import { flatAlias } from '@/core/packing';
import { noteTime, sk } from '@/core/i18n/sk';
import { isArrivalTime } from './board-model';

const DEFAULT_TIME = '09:00';

export interface EarlyDeparturesProps {
  /** Entries of the selected day only, earliest first. */
  departures: EarlyDeparture[];
  /** In-scope flats for the picker. */
  listings: { id: string; name: string }[];
  /** "Dnes 22.10." / "Zajtra 23.10.": the day the box belongs to. */
  dayTitle: string;
  viewer: Viewer;
  /** The board's clock (seeded from the server so SSR and client agree). */
  now: Date;
  busy: boolean;
  /** Resolves true when the entry was saved; the form then clears and closes. */
  onAdd: (listingId: string, departure: string, note: string) => Promise<boolean>;
  onRemove: (departure: EarlyDeparture) => void;
}

/**
 * "Skoré odchody": the green box next to "Skoré príchody", one per board day
 * (Martina, 2026-10-22). The office writes guests leaving early here (they
 * said so, or the camera shows it); everyone sees it, and the flat's card for
 * that day shows it, so the laundry team can go earlier. No push notification.
 * The author or an admin removes an entry.
 */
export function EarlyDepartures({ departures, listings, dayTitle, viewer, now, busy, onAdd, onRemove }: EarlyDeparturesProps) {
  const [open, setOpen] = useState(false);
  const [listingId, setListingId] = useState('');
  const [time, setTime] = useState(DEFAULT_TIME);
  const [note, setNote] = useState('');
  const t = sk.earlyDepartures;

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
    <section className="arrivals departures" aria-labelledby="departures-title">
      <h2 id="departures-title" className="arrivals-title">
        <span aria-hidden="true">🚪</span> {t.title}
        <span className="notice-day">{dayTitle}</span>
      </h2>
      {departures.length === 0 ? (
        <p className="notice-empty">{t.empty}</p>
      ) : (
        <ul className="notice-list">
          {departures.map((d) => {
            const own = d.author === viewer.id;
            const alias = flatAlias(d.listing_id);
            return (
              <li key={d.id} className="notice-item arrival-item">
                <div className="arrival-head">
                  <b className="arrival-time">{t.line(d.departure)}</b>
                  <span className="arrival-flat">
                    {d.listing_name}
                    {alias && <small> · {alias}</small>}
                  </span>
                </div>
                {d.note && <div className="notice-text arrival-note">{d.note}</div>}
                <div className="notice-meta">
                  <span>{t.by(d.author_name, noteTime(d.created_at, now))}</span>
                  {(own || viewer.role === 'admin') && (
                    <button type="button" className="notice-remove" disabled={busy} onClick={() => onRemove(d)}>
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
