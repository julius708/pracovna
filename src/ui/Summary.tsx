'use client';

import { angelikaSentence, sk, type TextPart } from '@/core/i18n/sk';
import type { SummaryLine } from './board-model';

const AV = '/assets/angelika.jpg';

export function AngelikaBlock({ parts }: { parts: TextPart[] }) {
  return (
    <div className="boss">
      <div className="av">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={AV} alt={sk.angelikaAlt} width={64} height={64} />
        <i aria-hidden="true">
          <svg viewBox="0 0 12 12">
            <path d="M2 6.5l2.5 2.5L10 3.5" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </i>
      </div>
      <div className="bubble">
        <small>{sk.angelikaRole}</small>
        {parts.map((p, i) => (p.bold ? <b key={i}>{p.text}</b> : <span key={i}>{p.text}</span>))}
      </div>
    </div>
  );
}

export function Summary({
  dayWord,
  hasData,
  numbers,
  lines,
  hasJobs,
}: {
  dayWord: string;
  hasData: boolean;
  numbers: { total: number; todo: number; rush: number; kids: number };
  lines: SummaryLine[];
  hasJobs: boolean;
}) {
  const parts = angelikaSentence({ dayWord, hasData, ...numbers });
  const linen = lines.filter((l) => !l.consumable);
  const cons = lines.filter((l) => l.consumable);
  const bytov = numbers.todo === 1 ? 'byt' : numbers.todo >= 2 && numbers.todo <= 4 ? 'byty' : 'bytov';
  return (
    <section className="sum" id="sum" aria-live="polite">
      <AngelikaBlock parts={parts} />
      {!hasJobs ? (
        <>
          <h2>
            <span>{sk.summaryToPrepare}</span>
          </h2>
          <div className="empty-note">{hasData ? sk.empty.noCheckouts : sk.empty.noData}</div>
        </>
      ) : (
        <>
          <h2>
            <span>
              {sk.summaryRemaining} · {numbers.todo} {bytov}
            </span>
            <span>{sk.summaryWholeDay}</span>
          </h2>
          <div className="sumgrid">
            {linen.map((l) => (
              <div className="tot" key={l.id}>
                <b>{l.rem}</b>
                <span>
                  {l.label}{' '}
                  <small>
                    {l.size ? `${l.size} · ` : ''}
                    {sk.ofTotal} {l.all}
                  </small>
                </span>
              </div>
            ))}
          </div>
          {cons.length > 0 && (
            <div className="cons sumcons">
              <div className="cons-h">
                <span>{sk.consumablesTitle}</span>
                <span>{sk.remainingOf}</span>
              </div>
              <ul>
                {cons.map((l) => (
                  <li key={l.id} className={`${l.source === 'guesty' ? 'cust' : ''}${l.note ? ' miss' : ''}`}>
                    <span>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {l.photo && <img className="capico" src={`/assets/${l.photo}`} alt="" />}
                      {l.label}
                      {l.note && <small> {l.note}</small>}
                      {!l.note && l.size && <small> {l.size}</small>}
                    </span>
                    <b>
                      {l.rem}
                      <small> / {l.all}</small>
                    </b>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}
