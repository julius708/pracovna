'use client';

import { useState, type FormEvent } from 'react';
import type { BoardNote } from '@/app/_lib/board';
import type { Viewer } from '@/app/_lib/viewer';
import { noteTime, sk } from '@/core/i18n/sk';

export interface NoticeBoardProps {
  /** Notes of the selected day only. */
  notes: BoardNote[];
  /** "Dnes 3.10." / "Zajtra 4.10." / "Po 5.10.": the day the box belongs to. */
  dayTitle: string;
  viewer: Viewer;
  /** The board's clock (seeded from the server so SSR and client agree). */
  now: Date;
  busy: boolean;
  onAdd: (text: string) => void;
  onRemove: (note: BoardNote) => void;
}

/**
 * "Dôležité info pre Angeliku a Maxa": the shared notice board above the
 * apartment list, one box per board day (a note written under "Po 5.10." shows
 * only there). Always visible, even when empty; every note shows its author
 * and time. A note is removed by its author or an admin.
 */
export function NoticeBoard({ notes, dayTitle, viewer, now, busy, onAdd, onRemove }: NoticeBoardProps) {
  const [text, setText] = useState('');

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const clean = text.trim();
    if (!clean) return;
    setText('');
    onAdd(clean);
  };

  return (
    <section className="notice-board" aria-labelledby="notice-title">
      <h2 id="notice-title" className="notice-title">
        <span aria-hidden="true">📌</span> {sk.noticeBoard.title}
        <span className="notice-day">{dayTitle}</span>
      </h2>
      {notes.length === 0 ? (
        <p className="notice-empty">{sk.noticeBoard.empty}</p>
      ) : (
        <ul className="notice-list">
          {notes.map((n) => (
            <li key={n.id} className="notice-item">
              <div className="notice-text">{n.text}</div>
              <div className="notice-meta">
                <span>{sk.noticeBoard.by(n.author_name, noteTime(n.created_at, now))}</span>
                {(viewer.role === 'admin' || n.author === viewer.id) && (
                  <button type="button" className="notice-remove" disabled={busy} onClick={() => onRemove(n)}>
                    {sk.noticeBoard.remove}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <form className="notice-form" onSubmit={submit}>
        <textarea
          aria-label={`${sk.noticeBoard.placeholder} (${dayTitle})`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={sk.noticeBoard.placeholder}
          maxLength={500}
          rows={2}
          disabled={busy}
        />
        <button className="btn primary" type="submit" disabled={busy || !text.trim()}>
          {sk.noticeBoard.add}
        </button>
      </form>
    </section>
  );
}
