'use client';

import { useState, type FormEvent } from 'react';
import type { CleaningRequest, CleaningRights } from '@/app/_lib/cleaning';
import type { Viewer } from '@/app/_lib/viewer';
import { flatAlias } from '@/core/packing';
import { noteTime, sk } from '@/core/i18n/sk';

export interface CleaningInfoProps {
  /** "Dnes 30.10." / "Zajtra 31.10.": the day the box belongs to. */
  dayTitle: string;
  /** The day's check-out flats that carry the Guesty "INFO PRE UPRATOVAČOV" note, by name. */
  flats: { listing_id: string; listing_name: string; info: string }[];
  /** The day's messages and replies, oldest first. */
  requests: CleaningRequest[];
  rights: CleaningRights;
  viewer: Viewer;
  /** The board's clock (seeded from the server so SSR and client agree). */
  now: Date;
  busy: boolean;
  /** Resolve true when saved; the field then clears. */
  onAdd: (text: string) => Promise<boolean>;
  onReply: (parent: CleaningRequest, text: string) => Promise<boolean>;
  onTick: (request: CleaningRequest, done: boolean) => void;
  onRemove: (request: CleaningRequest) => void;
}

/**
 * "🧹 Info pre upratovačov" (Martina, 2026-10-30): a grey box on the board above
 * the packing section, for the selected day. First the standing Guesty note of
 * the day's check-out flats that have one, then the day's messages (plain
 * text, no flat picker; Martina, 2026-10-30): admin and customer service write them, everyone who sees the box replies, cleaning /
 * admin / customer service tick them as done (who and when is kept).
 */
export function CleaningInfo({ dayTitle, flats, requests, rights, viewer, now, busy, onAdd, onReply, onTick, onRemove }: CleaningInfoProps) {
  const [text, setText] = useState('');
  const [replying, setReplying] = useState<{ id: string; text: string } | null>(null);
  const t = sk.cleaning;
  const top = requests.filter((r) => !r.parent_id);
  const repliesOf = (id: string) => requests.filter((r) => r.parent_id === id);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const clean = text.trim();
    if (!clean) return;
    const ok = await onAdd(clean);
    if (!ok) return; // keep what was typed so it can be sent again
    setText('');
  };

  const sendReply = async (parent: CleaningRequest) => {
    const clean = replying?.text.trim();
    if (!clean) return;
    if (await onReply(parent, clean)) setReplying(null);
  };

  const meta = (r: CleaningRequest) => {
    const own = r.author === viewer.id;
    return (
      <div className="notice-meta">
        <span>{t.by(r.author_name, noteTime(r.created_at, now))}</span>
        {(own || rights.admin) && !r.id.startsWith('temp-') && (
          <button type="button" className="notice-remove" disabled={busy} onClick={() => onRemove(r)}>
            {t.remove}
          </button>
        )}
      </div>
    );
  };

  return (
    <section className="contact cleaning-box" aria-labelledby="cleaning-title">
      <h2 id="cleaning-title" className="contact-title cleaning-title">
        <span aria-hidden="true">🧹</span> {t.title}
        <span className="notice-day">{dayTitle}</span>
      </h2>
      <p className="cleaning-intro">{t.intro}</p>

      {flats.length > 0 && (
        <div className="cleaning-part">
          <div className="cleaning-label">{t.guestyLabel}</div>
          <ul className="cleaning-list">
            {flats.map((f) => {
              const alias = flatAlias(f.listing_id);
              return (
                <li key={f.listing_id} className="cleaning-item">
                  <b className="cleaning-flat">
                    {f.listing_name}
                    {alias && <small> · {alias}</small>}
                  </b>
                  <div className="cleaning-text">{f.info}</div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="cleaning-part">
        <div className="cleaning-label">{t.requestsLabel}</div>
        {top.length === 0 ? (
          <p className="notice-empty">{t.noRequests}</p>
        ) : (
          <ul className="cleaning-list">
            {top.map((r) => {
              const replies = repliesOf(r.id);
              const temp = r.id.startsWith('temp-');
              return (
                <li key={r.id} className={`cleaning-item${r.done_at ? ' is-done' : ''}`}>
                  {r.listing_name && <b className="cleaning-flat">{r.listing_name}</b>}
                  <div className="cleaning-text">{r.text}</div>
                  {r.done_at && <div className="cleaning-done">{t.doneBy(r.done_by_name ?? '—', noteTime(r.done_at, now))}</div>}
                  {meta(r)}
                  {!temp && (
                    <div className="cleaning-actions">
                      {rights.tick && (
                        <button type="button" className={`btn ${r.done_at ? 'ghost' : 'primary'}`} disabled={busy} onClick={() => onTick(r, !r.done_at)}>
                          {r.done_at ? t.undo : t.done}
                        </button>
                      )}
                      <button type="button" className="btn ghost" disabled={busy} onClick={() => setReplying(replying?.id === r.id ? null : { id: r.id, text: '' })}>
                        {t.reply}
                      </button>
                    </div>
                  )}
                  {replies.length > 0 && (
                    <ul className="notice-replies">
                      {replies.map((x) => (
                        <li key={x.id} className="notice-reply">
                          <div className="notice-text">{x.text}</div>
                          {meta(x)}
                        </li>
                      ))}
                    </ul>
                  )}
                  {replying?.id === r.id && (
                    <div className="notice-edit notice-reply-form">
                      <textarea
                        aria-label={t.replyPlaceholder}
                        placeholder={t.replyPlaceholder}
                        value={replying.text}
                        onChange={(e) => setReplying({ id: r.id, text: e.target.value })}
                        maxLength={500}
                        rows={2}
                        autoFocus
                        disabled={busy}
                      />
                      <div className="notice-edit-actions">
                        <button type="button" className="btn ghost" onClick={() => setReplying(null)}>
                          {t.cancel}
                        </button>
                        <button type="button" className="btn primary" disabled={busy || !replying.text.trim()} onClick={() => void sendReply(r)}>
                          {t.send}
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {rights.write && (
        <form className="cleaning-form" onSubmit={(e) => void submit(e)}>
          <textarea aria-label={`${t.placeholder} (${dayTitle})`} value={text} onChange={(e) => setText(e.target.value)} placeholder={t.placeholder} maxLength={500} rows={2} disabled={busy} />
          <button className="btn primary" type="submit" disabled={busy || !text.trim()}>
            {t.add}
          </button>
        </form>
      )}
    </section>
  );
}
