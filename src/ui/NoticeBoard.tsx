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
  /** Resolves true when the reply was saved; the reply field then clears and closes. */
  onReply: (parent: BoardNote, text: string) => Promise<boolean>;
  onEdit: (note: BoardNote, text: string) => void;
  onRemove: (note: BoardNote) => void;
}

/**
 * "Dôležité info": the shared notice board above the
 * apartment list, one box per board day (a note written under "Po 5.10." shows
 * only there). Always visible, even when empty; every note shows its author
 * and time. The author edits their own note; the author or an admin removes it.
 * Anyone answers a note: the replies show under it, oldest first (Martina,
 * 2026-10-19); a reply is edited and removed like a note.
 */
export function NoticeBoard({ notes, dayTitle, viewer, now, busy, onAdd, onReply, onEdit, onRemove }: NoticeBoardProps) {
  const [text, setText] = useState('');
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [replying, setReplying] = useState<{ id: string; text: string } | null>(null);
  const top = notes.filter((n) => !n.parent_id);
  const repliesOf = (id: string) => notes.filter((n) => n.parent_id === id).sort((a, b) => a.created_at.localeCompare(b.created_at));

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

  const sendReply = async (parent: BoardNote) => {
    if (!replying) return;
    const clean = replying.text.trim();
    if (!clean) return;
    const ok = await onReply(parent, clean);
    if (ok) setReplying(null); // on failure keep what was typed so it can be sent again
  };

  const renderNote = (n: BoardNote, reply: boolean) => {
    const own = n.author === viewer.id;
    const isEditing = editing?.id === n.id;
    return (
      <>
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
          {!isEditing && (
            <span className="notice-actions">
              {!reply && !n.id.startsWith('temp-') && (
                <button type="button" className="notice-remove" disabled={busy} onClick={() => setReplying(replying?.id === n.id ? null : { id: n.id, text: '' })}>
                  {sk.noticeBoard.reply}
                </button>
              )}
              {own && (
                <button type="button" className="notice-remove" disabled={busy} onClick={() => setEditing({ id: n.id, text: n.text })}>
                  {sk.noticeBoard.edit}
                </button>
              )}
              {(own || viewer.role === 'admin') && (
                <button type="button" className="notice-remove" disabled={busy} onClick={() => onRemove(n)}>
                  {sk.noticeBoard.remove}
                </button>
              )}
            </span>
          )}
        </div>
      </>
    );
  };

  return (
    <section className="notice-board" aria-labelledby="notice-title">
      <h2 id="notice-title" className="notice-title">
        <span aria-hidden="true">📌</span> {sk.noticeBoard.title}
        <span className="notice-day">{dayTitle}</span>
      </h2>
      {top.length === 0 ? (
        <p className="notice-empty">{sk.noticeBoard.empty}</p>
      ) : (
        <ul className="notice-list">
          {top.map((n) => {
            const replies = repliesOf(n.id);
            return (
              <li key={n.id} className="notice-item">
                {renderNote(n, false)}
                {replies.length > 0 && (
                  <ul className="notice-replies">
                    {replies.map((r) => (
                      <li key={r.id} className="notice-reply">
                        {renderNote(r, true)}
                      </li>
                    ))}
                  </ul>
                )}
                {replying?.id === n.id && (
                  <div className="notice-edit notice-reply-form">
                    <textarea
                      aria-label={sk.noticeBoard.replyPlaceholder}
                      placeholder={sk.noticeBoard.replyPlaceholder}
                      value={replying.text}
                      onChange={(e) => setReplying({ id: n.id, text: e.target.value })}
                      maxLength={500}
                      rows={2}
                      autoFocus
                      disabled={busy}
                    />
                    <div className="notice-edit-actions">
                      <button type="button" className="btn ghost" onClick={() => setReplying(null)}>
                        {sk.noticeBoard.cancel}
                      </button>
                      <button type="button" className="btn primary" disabled={busy || !replying.text.trim()} onClick={() => void sendReply(n)}>
                        {sk.noticeBoard.send}
                      </button>
                    </div>
                  </div>
                )}
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
