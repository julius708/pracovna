'use client';

import type { EarlyArrival } from '@/app/_lib/board';
import { flatAlias } from '@/core/packing';
import { sk } from '@/core/i18n/sk';

export interface EarlyArrivalsProps {
  /** Entries of the selected day only, earliest first. */
  arrivals: EarlyArrival[];
  /** "Dnes 11.10." / "Zajtra 12.10.": the day the box belongs to. */
  dayTitle: string;
}

/**
 * "Skoré príchody": the red box under "Dôležité info", one per board day
 * (owner, 2026-10-11). The entries come from Guesty: every confirmed
 * reservation whose planned arrival is before the standard check-in time.
 * Nothing is typed in here; the sync keeps the list current.
 */
export function EarlyArrivals({ arrivals, dayTitle }: EarlyArrivalsProps) {
  const t = sk.earlyArrivals;
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
                  <span>{t.source}</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
