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
  onEdit: (note: BoardNote, text: string) => void;
  onRemove: (note: BoardNote) => void;
}

/**
 * "Dôležité info": the shared notice board above the
 * apartment list, one box per board day (a note written under "Po 5.10." shows
 * only there). Always visible, even when empty; every note shows its author
 * and time. The author edits their own note; the author or an admin removes it.
 */
export function NoticeBoard({ notes, dayTitle, viewer, now, busy, onAdd, onEdit, onRemove }: NoticeBoardProps) {
  const [text, setText] = useState('');
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const clean = text.trim();
    if (!clean) return;
    setText('');
    onAdd(clean);
  };

  const saveEdit = (n: BoardNote) => {
    if (!editing) return;
    const clean = editing.text.trim();
    setEditing(null);
    if (!clean || clean === n.text) return;
    onEdit(n, clean);
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
          {notes.map((n) => {
            const own = n.author === viewer.id;
            const isEditing = editing?.id === n.id;
            return (
              <li key={n.id} className="notice-item">
                {isEditing ? (
                  <div className="notice-edit">
                    <textarea
                      aria-label={sk.noticeBoard.edit}
                      value={editing.text}
                      onChange={(e) => setEditing({ id: n.id, text: e.target.value })}
                      maxLength={500}
                      rows={3}
                      autoFocus
                    />
                    <div className="notice-edit-actions">
                      <button type="button" className="btn ghost" onClick={() => setEditing(null)}>
                        {sk.noticeBoard.cancel}
                      </button>
                      <button type="button" className="btn primary" disabled={busy || !editing.text.trim()} onClick={() => saveEdit(n)}>
                        {sk.noticeBoard.save}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="notice-text">{n.text}</div>
                )}
                <div className="notice-meta">
                  <span>
                    {sk.noticeBoard.by(n.author_name, noteTime(n.created_at, now))}
                    {n.edited_at && <> · {sk.noticeBoard.edited}</>}
                  </span>
                  {!isEditing && (own || viewer.role === 'admin') && (
                    <span className="notice-actions">
                      {own && (
                        <button type="button" className="notice-remove" disabled={busy} onClick={() => setEditing({ id: n.id, text: n.text })}>
                          {sk.noticeBoard.edit}
                        </button>
                      )}
                      <button type="button" className="notice-remove" disabled={busy} onClick={() => onRemove(n)}>
                        {sk.noticeBoard.remove}
                      </button>
                    </span>
                  )}
                </div>
              </li>
            );
          })}
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
