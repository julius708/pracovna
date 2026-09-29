import { bedCapacity } from './beds';
import { GAP_MAX_NIGHTS } from './constants';
import { datesBetween, diffDays } from './dates';
import type { CalendarDay, GapInfo, ListingInput, PeopleSource, ReservationInput, WarningCode, Ymd } from './types';

export interface PeopleResult {
  people: number;
  source: PeopleSource;
  sameDay: boolean;
  gap: GapInfo | null;
  warnings: WarningCode[];
}

/**
 * Can any new reservation be sold in the gap between check-out `date` and the
 * next check-in? A gap is blocked when EVERY possible arrival day is impossible:
 * minNights(day) > nights left until the next check-in, or the day is blocked /
 * closed to arrival in the calendar. Unknown days make the answer unknown,
 * unless some day is known to be sellable.
 */
export function evaluateGap(date: Ymd, nextCheckIn: Ymd, calendar: Record<Ymd, CalendarDay>): GapInfo {
  const nights = diffDays(date, nextCheckIn);
  if (nights <= 0) return { nights: 0, minNightsMax: null, blocked: null, reason: null };
  if (nights > GAP_MAX_NIGHTS) return { nights, minNightsMax: null, blocked: false, reason: null };

  let minNightsMax: number | null = null;
  let anySellable = false;
  let anyUnknown = false;
  let anyCalendarOnly = false;

  for (const day of datesBetween(date, nextCheckIn)) {
    const nightsLeft = diffDays(day, nextCheckIn);
    const c = calendar[day];
    const minNights = c && typeof c.minNights === 'number' ? c.minNights : null;
    if (minNights !== null) minNightsMax = Math.max(minNightsMax ?? 0, minNights);
    const calendarBlocked = !!c && (c.available === false || c.cta === true);
    const minNightsBlocked = minNights !== null && minNights > nightsLeft;
    if (calendarBlocked || minNightsBlocked) {
      if (calendarBlocked && !minNightsBlocked) anyCalendarOnly = true;
      continue;
    }
    if (minNights === null) anyUnknown = true;
    else anySellable = true;
  }

  if (anySellable) return { nights, minNightsMax, blocked: false, reason: null };
  if (anyUnknown) return { nights, minNightsMax, blocked: null, reason: null };
  return { nights, minNightsMax, blocked: true, reason: anyCalendarOnly ? 'calendar_blocked' : 'min_nights' };
}

/** Number of people to pack for (spec §4). */
export function computePeople(args: {
  date: Ymd;
  listing: ListingInput;
  next: ReservationInput | null;
  calendar: Record<Ymd, CalendarDay>;
}): PeopleResult {
  const { date, listing, next, calendar } = args;
  const warnings: WarningCode[] = [];
  const nextGuests = next && next.guests && next.guests > 0 ? next.guests : null;

  const capacity = (): { people: number; source: PeopleSource } => {
    const acc = listing.accommodates && listing.accommodates > 0 ? listing.accommodates : null;
    if (acc !== null) return { people: acc, source: 'capacity' };
    warnings.push('capacity_missing');
    return { people: Math.max(1, bedCapacity(listing.beds)), source: 'capacity_from_beds' };
  };

  // 1. same-day check-in
  if (next && next.checkInDate === date) {
    if (nextGuests !== null) return { people: nextGuests, source: 'same_day', sameDay: true, gap: null, warnings };
    warnings.push('guests_missing');
    return { ...capacity(), sameDay: true, gap: null, warnings };
  }

  // 2. later check-in whose gap cannot be sold
  if (next && next.checkInDate > date) {
    const gap = evaluateGap(date, next.checkInDate, calendar);
    if (gap.blocked === null) warnings.push('min_nights_unknown');
    if (gap.blocked === true) {
      if (nextGuests !== null) return { people: nextGuests, source: 'gap', sameDay: false, gap, warnings };
      warnings.push('guests_missing');
    }
    return { ...capacity(), sameDay: false, gap, warnings };
  }

  // 3. no next reservation -> maximum capacity
  return { ...capacity(), sameDay: false, gap: null, warnings };
}
