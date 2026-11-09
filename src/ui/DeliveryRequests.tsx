'use client';

import { useState, type FormEvent } from 'react';
import type { DeliveryRequest } from '@/app/_lib/delivery';
import type { Viewer } from '@/app/_lib/viewer';
import { noteTime, sk } from '@/core/i18n/sk';

export interface DeliveryRequestsProps {
  /** "Dnes 9.11." / "Zajtra 10.11.": the day the box belongs to. */
  dayTitle: string;
  /** The day's requests, oldest first. */
  requests: DeliveryRequest[];
  /** The day's check-out flats for the flat of a new request, by name. */
  dayFlats: { id: string; name: string }[];
  viewer: Viewer;
  /** The board's clock (seeded from the server so SSR and client agree). */
  now: Date;
  busy: boolean;
  /** Resolves true when saved; the field then clears. */
  onAdd: (listingId: string, text: string) => Promise<boolean>;
  onTick: (request: DeliveryRequest, done: boolean) => void;
  onRemove: (request: DeliveryRequest) => void;
}

/**
 * "🛍️ Pre Angeliku – prosím dobaliť do tašiek a odkliknúť" (Martina, 2026-11-09):
 * above the packing section, for the selected day. Anyone writes what to bring
 * to a flat; once packed into its bags it is ticked "Dodané" (who and when),
 * which feeds the admin "Vyúčtovanie" page.
 */
export function DeliveryRequests({ dayTitle, requests, dayFlats, viewer, now, busy, onAdd, onTick, onRemove }: DeliveryRequestsProps) {
  const [flat, setFlat] = useState('');
  const [text, setText] = useState('');
  const t = sk.delivery;

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const clean = text.trim();
    if (!flat || !clean) return;
    if (!(await onAdd(flat, clean))) return; // keep what was typed so it can be sent again
    setText('');
    setFlat('');
  };

  return (
    <section className="contact delivery-box" aria-labelledby="delivery-title">
      <h2 id="delivery-title" className="contact-title cleaning-title">
        <span aria-hidden="true">🛍️</span> {t.title}
        <span className="notice-day">{dayTitle}</span>
      </h2>
      {requests.length === 0 ? (
        <p className="notice-empty">{t.empty}</p>
      ) : (
        <ul className="cleaning-list">
          {requests.map((r) => {
            const temp = r.id.startsWith('temp-');
            return (
              <li key={r.id} className={`cleaning-item delivery-item${r.delivered_at ? ' is-delivered' : ''}`}>
                <b className="cleaning-flat">{r.listing_name}</b>
                <div className="cleaning-text">{r.text}</div>
                {r.delivered_at && <div className="cleaning-done">{t.doneBy(r.delivered_by_name ?? '—', noteTime(r.delivered_at, now))}</div>}
                <div className="notice-meta">
                  <span>{t.by(r.author_name, noteTime(r.created_at, now))}</span>
                  {(r.author === viewer.id || viewer.role === 'admin') && !temp && (
                    <button type="button" className="notice-remove" disabled={busy} onClick={() => onRemove(r)}>
                      {t.remove}
                    </button>
                  )}
                </div>
                {!temp && (
                  <div className="cleaning-actions">
                    <button type="button" className={`btn ${r.delivered_at ? 'ghost' : 'primary'}`} disabled={busy} onClick={() => onTick(r, !r.delivered_at)}>
                      {r.delivered_at ? t.undo : t.done}
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <form className="cleaning-form" onSubmit={(e) => void submit(e)}>
        <label className="arrival-field">
          <span>{t.flat}</span>
          <select value={flat} onChange={(e) => setFlat(e.target.value)} disabled={busy} required>
            <option value="">{t.pickFlat}</option>
            {dayFlats.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <textarea aria-label={`${t.placeholder} (${dayTitle})`} value={text} onChange={(e) => setText(e.target.value)} placeholder={t.placeholder} maxLength={500} rows={2} disabled={busy} />
        <button className="btn primary" type="submit" disabled={busy || !flat || !text.trim()}>
          {t.add}
        </button>
      </form>
    </section>
  );
}
