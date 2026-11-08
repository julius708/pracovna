'use client';

import { useState } from 'react';
import { KEYS, keyRow } from '@/core/keys';
import { sk } from '@/core/i18n/sk';

/**
 * "USPORIADANIE KLUCOV" (Martina, 2026-11-08): a button in a frame above
 * "Dôležité info"; it unfolds the whole key list (name – hook code, in the
 * office's order) and folds it again. Folded by default. The code's letter is
 * the row of hooks: A green, B blue, C yellow, D pink.
 */
export function KeyList() {
  const [open, setOpen] = useState(false);
  const t = sk.keys;
  return (
    <section className="keys-box" aria-label={t.title}>
      <button type="button" className="keys-toggle" aria-expanded={open} aria-controls="keys-list" onClick={() => setOpen((o) => !o)}>
        <span className="keys-title">
          <span aria-hidden="true">🔑</span> {t.title}
        </span>
        <span className="keys-hint">
          {open ? t.close : t.open} <span aria-hidden="true">{open ? '▲' : '▼'}</span>
        </span>
      </button>
      {open && (
        <ol id="keys-list" className="keys-list">
          {KEYS.map((k) => (
            <li key={`${k.code}-${k.name}`} className="keys-row">
              <span className="keys-name">{k.name}</span>
              <span className="keys-dash" aria-hidden="true">
                –
              </span>
              <b className={`keys-code row-${(keyRow(k.code) ?? 'x').toLowerCase()}`}>{k.code}</b>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
