'use client';

import { sk } from '@/core/i18n/sk';

/**
 * "📅 Na iný deň" under a note form (Martina, 2026-11-20): null writes the note
 * for the day shown on the board; a date writes it for that day instead.
 */
export function AheadDay({ value, onChange, min, max, disabled }: { value: string | null; onChange: (day: string | null) => void; min: string; max: string; disabled?: boolean }) {
  const t = sk.ahead;
  if (value === null) {
    return (
      <div className="ahead-row">
        <button type="button" className="notice-remove" disabled={disabled} onClick={() => onChange(min)}>
          {t.pick}
        </button>
      </div>
    );
  }
  return (
    <div className="ahead-row">
      <label className="ahead-pick">
        {t.label}
        <input type="date" value={value} min={min} max={max} disabled={disabled} onChange={(e) => onChange(e.target.value || min)} />
      </label>
      <button type="button" className="notice-remove" disabled={disabled} onClick={() => onChange(null)}>
        {t.back}
      </button>
    </div>
  );
}
