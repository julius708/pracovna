'use client';

import { useEffect, useRef, useState } from 'react';
import type { BoardPackage, EarlyArrival, EarlyDeparture } from '@/app/_lib/board';
import type { Viewer } from '@/app/_lib/viewer';
import { flatFacts, formatHM, NOTE_MAX_LENGTH, type PackingResult, type WarningCode } from '@/core/packing';
import { flatAddress } from '@/core/printer/addresses';
import { LabelButton } from './LabelButton';
import { bedSummary, capsuleLabel, cheerDone, childrenBannerParts, duvetText, nextArrivalParts, packedBy, peopleParts, sk, sofaText, warningLine, type TextPart } from '@/core/i18n/sk';

const AV = '/assets/angelika.jpg';
/** Warnings already shown inline (beds line, badge line), so they are not repeated in the red list. */
const INLINE: WarningCode[] = ['bunk', 'no_duvet_info', 'min_nights_unknown'];
/** Information for the packer, shown calmly instead of in red. */
const INFO: WarningCode[] = ['separate_beds'];

function Parts({ parts }: { parts: TextPart[] }) {
  return <>{parts.map((x, i) => (x.bold ? <b key={i}>{x.text}</b> : <span key={i}>{x.text}</span>))}</>;
}

export interface CardHandlers {
  onPack: (p: BoardPackage) => void;
  onUndo: (p: BoardPackage) => void;
  onNote: (p: BoardPackage, text: string) => void;
  onCheck: (p: BoardPackage, item: string, checked: boolean) => void;
}

export function PackageCard({
  p,
  cleaner,
  arrival = null,
  departure = null,
  noCapsules = false,
  viewer,
  busy,
  cheer,
  handlers,
}: {
  p: BoardPackage;
  cleaner: string | null;
  /** The early arrival recorded for this flat on this day (owner, 2026-10-11), shown first on the card. */
  arrival?: EarlyArrival | null;
  /** The early departure recorded for this flat on this (check-out) day (Martina, 2026-10-22). */
  departure?: EarlyDeparture | null;
  /** Guesty says "Kapsule: nedávať" for this flat: a red line on the card (Martina, 2026-10-19). */
  noCapsules?: boolean;
  viewer: Viewer;
  busy: boolean;
  cheer: string | null;
  handlers: CardHandlers;
}) {
  const r = p.computed_items as PackingResult;
  const [noteOpen, setNoteOpen] = useState(false);
  const noteRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (noteOpen) noteRef.current?.focus();
  }, [noteOpen]);

  const cancelled = p.status === 'cancelled';
  const cls = cancelled ? 'job cancelled-card' : `job is-${p.status}`;
  const next = r.next;
  const kid = childrenBannerParts(r);
  const sofa = sofaText(r);
  const duvet = duvetText(r);
  const changed = p.status === 'packed' && p.packed_hash && p.packed_hash !== p.computed_hash;
  const checklist = r.checklist ?? [];
  const checked = p.checklist?.checked ?? {};
  const done = checklist.filter((x) => checked[x]).length;
  const otherWarnings = (r.warnings as WarningCode[]).filter((w) => !INLINE.includes(w));
  const canAct = viewer.active && !cancelled;
  // Angelika's name for the flat and her facts about it (src/core/packing/flats.ts)
  const facts = flatFacts(p.listing_id);

  const pill = cancelled ? (
    <span className="pill handed">{sk.pill.cancelled}</span>
  ) : p.status === 'packed' ? (
    <span className="pill packed">{sk.pill.packed}</span>
  ) : (
    <span className="pill todo">{sk.pill.todo}</span>
  );

  return (
    <article className={cls} id={`job-${p.id}`}>
      <div className="jh">
        <div>
          <h3>{p.listing_name}</h3>
          {facts?.alias && <div className="alias">{facts.alias}</div>}
        </div>
        {pill}
      </div>
      {/* the flat's must-not-miss line comes first, right under the name (Martina, 2026-10-21) */}
      {facts?.alert && <div className="flat-alert">⛔ {facts.alert}</div>}
      {departure && (
        <div className="arrival-bar departure-bar">
          {sk.earlyDepartures.cardLine(departure.departure)}
          {departure.note ? ` · ${departure.note}` : ''}
        </div>
      )}
      {arrival && (
        <div className="arrival-bar">
          {sk.earlyArrivals.cardLine(arrival.arrival)}
          {arrival.note ? ` · ${arrival.note}` : ''}
        </div>
      )}
      {/* spec §5 order: badges, then banners (children, private linen) */}
      <div className="meta">
        {next ? (
          r.sameDay ? (
            <span className="tag rush">{sk.rushTag}</span>
          ) : (
            <span>
              <Parts parts={nextArrivalParts(next.date)} />
            </span>
          )
        ) : (
          <span className="tag none">{sk.noNextTag}</span>
        )}
        <span>
          <Parts parts={peopleParts(r)} />
        </span>
        {r.gap?.blocked === null && <span className="warnTxt">{sk.minNightsUnknown}</span>}
        {cleaner && <span className="tag svc">{cleaner}</span>}
      </div>
      {kid && (
        <div className="kids">
          <Parts parts={kid} />
        </div>
      )}
      {r.private && <div className="privbar">{sk.privateBanner}</div>}
      {changed && <div className="changed">{sk.changedAfterPacking}</div>}
      {otherWarnings.length > 0 && (
        <div className="warn-list">
          {otherWarnings.map((w) => (
            <span key={w} className={INFO.includes(w) ? 'info' : undefined}>
              {warningLine(w, r)}
            </span>
          ))}
        </div>
      )}
      {facts?.note && (
        <div className="lnote">
          <b>{sk.flatNoteLabel}</b> {facts.note}
        </div>
      )}
      {r.guestyNote && (
        <div className="lnote">
          <b>{sk.guestyNoteLabel}</b> {r.guestyNote}
        </div>
      )}
      {r.linen.length > 0 && (
        <ul className="items">
          {r.linen.map((l) => (
            <li key={l.key} className={l.source === 'guesty' ? 'cust' : undefined}>
              <b>{l.n}</b>
              <span>{l.label}</span>
              <small>{l.size}</small>
            </li>
          ))}
        </ul>
      )}
      {(r.consumables.length > 0 || r.capsules.length > 0 || noCapsules) && (
        <div className="cons">
          <div className="cons-h">{sk.consumablesTitle}</div>
          {noCapsules && <div className="caps-refused">⛔ {sk.capsulesRefused}</div>}
          <ul>
            {r.consumables.map((l) => (
              <li key={l.key} className={l.source === 'guesty' ? 'cust' : undefined}>
                <span>
                  {l.label}
                  {l.size ? <small> {l.size}</small> : null}
                </span>
                <b>{l.n}</b>
              </li>
            ))}
            {r.capsules.map((c, i) => {
              const t = capsuleLabel(c);
              return (
                <li key={`${c.typeKey || c.state}-${i}`} className={`${c.fixed ? 'cust' : ''}${t.note ? ' miss' : ''}`}>
                  <span>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {c.photo && <img className="capico" src={`/assets/${c.photo}`} alt="" />}
                    {t.label}
                    {t.note && <small> {t.note}</small>}
                  </span>
                  <b>{c.n}</b>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <div className="beds">
        {sk.bedsLabel} {bedSummary(r)}
        {sofa && (
          <>
            {bedSummary(r) ? ' · ' : ' '}
            {r.beds.sofasUsed ? <b>{sofa}</b> : sofa}
          </>
        )}
        {r.warnings.includes('bunk') && (
          <>
            {' · '}
            <span className="warnTxt">{warningLine('bunk', r)}</span>
          </>
        )}
        {' · '}
        {duvet ? (
          <>
            {sk.duvetsLabel} <b>{duvet}</b>
          </>
        ) : (
          <span className="warnTxt">{warningLine('no_duvet_info', r)}</span>
        )}
        {r.coffee && (
          <>
            {' · '}
            {sk.coffeeLabel} <b>{r.coffee}</b>
          </>
        )}
      </div>
      {checklist.length > 0 && (
        <div className="check">
          <div className="check-h">
            <span>{sk.checklistTitle}</span>
            <span>
              {done}/{checklist.length}
            </span>
          </div>
          {checklist.map((item) => (
            <button
              key={item}
              type="button"
              className="ck"
              aria-pressed={!!checked[item]}
              disabled={!canAct || p.status !== 'todo' || busy}
              onClick={() => handlers.onCheck(p, item, !checked[item])}
            >
              <i aria-hidden="true" />
              {item}
            </button>
          ))}
        </div>
      )}
      {p.note && (
        <div className="note">
          {p.note}
          {p.note_by_name && p.note_at && (
            <small style={{ display: 'block', color: 'var(--muted)', marginTop: 4 }}>
              {sk.buttons.note} · {p.note_by_name} · {formatHM(new Date(p.note_at))}
            </small>
          )}
        </div>
      )}
      {p.packed_at && <div className="who">{packedBy(p.packed_by_name, formatHM(new Date(p.packed_at)))}</div>}
      {noteOpen && (
        <form
          className="noteform"
          onSubmit={(e) => {
            e.preventDefault();
            handlers.onNote(p, noteRef.current?.value ?? '');
            setNoteOpen(false);
          }}
        >
          <input ref={noteRef} maxLength={NOTE_MAX_LENGTH} placeholder={sk.notePlaceholder} defaultValue={p.note} aria-label={sk.buttons.note} />
          <button className="btn primary" style={{ flex: '0 0 auto', minHeight: 44 }} type="submit">
            {sk.buttons.save}
          </button>
        </form>
      )}
      {cheer && (
        <div className="cheer-in" role="status">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={AV} alt="Angelika sa usmieva" />
          <div>
            <b>{cheer}</b>
            <span>{cheerDone(p.listing_name)}</span>
          </div>
        </div>
      )}
      {canAct && (
        <div className="actions">
          {p.status === 'todo' ? (
            <button className="btn primary" type="button" disabled={busy} onClick={() => handlers.onPack(p)}>
              {sk.buttons.pack}
            </button>
          ) : (
            <>
              <button className="btn done" type="button" disabled>
                {sk.buttons.packed}
              </button>
              <button className="btn ghost" type="button" disabled={busy} onClick={() => handlers.onUndo(p)}>
                {sk.buttons.undo}
              </button>
            </>
          )}
          <button className="btn ghost" type="button" onClick={() => setNoteOpen((o) => !o)}>
            {p.note ? sk.buttons.editNote : sk.buttons.note}
          </button>
          <LabelButton name={p.listing_name} alias={facts?.alias ?? null} address={flatAddress(p.listing_id)} />
        </div>
      )}
      {!canAct && (
        <div className="actions">
          <LabelButton name={p.listing_name} alias={facts?.alias ?? null} address={flatAddress(p.listing_id)} />
        </div>
      )}
    </article>
  );
}
