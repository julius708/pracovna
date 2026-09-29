import { TZ } from './constants';
import type { Ymd } from './types';

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parses "YYYY-MM-DD" into a UTC-noon Date (safe from DST arithmetic). */
export function ymdToDate(ymd: Ymd): Date {
  const m = YMD.exec(ymd);
  if (!m) throw new Error(`Invalid date: ${ymd}`);
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12, 0, 0));
}

/** Formats a Date's UTC calendar day as "YYYY-MM-DD". */
function dateToYmd(d: Date): Ymd {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** Calendar-day arithmetic, DST-proof. */
export function addDays(ymd: Ymd, n: number): Ymd {
  const d = ymdToDate(ymd);
  d.setUTCDate(d.getUTCDate() + n);
  return dateToYmd(d);
}

/** Whole days from a to b (b - a). */
export function diffDays(a: Ymd, b: Ymd): number {
  return Math.round((ymdToDate(b).getTime() - ymdToDate(a).getTime()) / 86_400_000);
}

/** The calendar date "now" in Europe/Bratislava. */
export function todayInTz(now: Date = new Date(), tz: string = TZ): Ymd {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** The three board days: today, tomorrow, the day after. */
export function windowDates(today: Ymd): [Ymd, Ymd, Ymd] {
  return [today, addDays(today, 1), addDays(today, 2)];
}

/** Every date from `from` (inclusive) to `to` (exclusive). */
export function datesBetween(from: Ymd, to: Ymd): Ymd[] {
  const n = diffDays(from, to);
  const out: Ymd[] = [];
  for (let i = 0; i < n; i++) out.push(addDays(from, i));
  return out;
}

const WEEKDAYS_SK = ['ne', 'po', 'ut', 'st', 'št', 'pi', 'so'] as const;

/** Slovak weekday abbreviation: "št". */
export function weekdayShort(ymd: Ymd): string {
  return WEEKDAYS_SK[ymdToDate(ymd).getUTCDay()];
}

/** "1.10." */
export function formatDM(ymd: Ymd): string {
  const d = ymdToDate(ymd);
  return `${d.getUTCDate()}.${d.getUTCMonth() + 1}.`;
}

/** "HH:MM" of an instant in Europe/Bratislava (for "Zabalil(a) … · 09:41"). */
export function formatHM(instant: Date, tz: string = TZ): string {
  return new Intl.DateTimeFormat('sk-SK', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(instant);
}
