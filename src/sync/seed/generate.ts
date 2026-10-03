import { addDays, windowDates, type Ymd } from '@/core/packing';
import type { FakeGuestyData } from '@/guesty/fake-client';
import type { ParsedCalendarDay, ParsedListing, ParsedReservation } from '@/guesty/schemas';

/** Deterministic pseudo-random generator so seed data is stable for a given date. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hexId(prefix: string, n: number): string {
  return (prefix + n.toString(16).padStart(24, '0')).slice(-24);
}

export interface SeedOptions {
  today: Ymd;
  /** Check-outs per day. */
  perDay?: number;
  seed?: number;
}

export interface SeedScenarioCounts {
  sameDay: number;
  gapBlocked: number;
  gapSellable: number;
  noNext: number;
  farNext: number;
  children: number;
  doubleCheckout: number;
  multiStay: number;
}

/**
 * Generates reservations and calendar days for the seed listings so every
 * packing rule is exercised: same-day check-ins (with and without children),
 * 1–2-night gaps with min-nights 1/2, blocked calendar days, no next
 * reservation, far next reservation, two check-outs of one flat on one day,
 * a multi-listing stay, a cancelled reservation.
 */
export function generateSeedData(listings: ParsedListing[], opts: SeedOptions): { data: FakeGuestyData; counts: SeedScenarioCounts } {
  const rand = rng(opts.seed ?? Number(opts.today.replace(/-/g, '')));
  const perDay = opts.perDay ?? 20;
  const inScope = listings.filter((l) => l.active !== false && (l.address?.city ?? '').includes('Bratislava') && !/^(KE|TT)\s*:/i.test(l.nickname ?? ''));
  const reservations: ParsedReservation[] = [];
  const calendar: Record<string, ParsedCalendarDay[]> = {};
  const counts: SeedScenarioCounts = { sameDay: 0, gapBlocked: 0, gapSellable: 0, noNext: 0, farNext: 0, children: 0, doubleCheckout: 0, multiStay: 0 };
  let n = 0;
  const minNightsFor = new Map<string, Record<Ymd, number>>();
  const blockedDays = new Map<string, Set<Ymd>>();

  const mk = (listingId: string, checkIn: Ymd, checkOut: Ymd, guests: number, extra: Partial<ParsedReservation> & { children?: number; infants?: number } = {}): ParsedReservation => {
    n++;
    const adults = Math.max(1, guests - (extra.children ?? 0));
    return {
      _id: hexId('5eed', n),
      status: extra.status ?? 'confirmed',
      confirmationCode: `SEED-${n}`,
      source: n % 3 === 0 ? 'airbnb2' : 'Booking.com',
      listingId,
      checkInDateLocalized: checkIn,
      checkOutDateLocalized: checkOut,
      guestsCount: guests,
      numberOfGuests: { numberOfAdults: adults, numberOfChildren: extra.children ?? 0, numberOfInfants: extra.infants ?? 0, numberOfPets: 0 },
      stay: [
        {
          listingId,
          checkInDateLocalized: checkIn,
          checkOutDateLocalized: checkOut,
          guestsCount: guests,
          numberOfGuests: { numberOfAdults: adults, numberOfChildren: extra.children ?? 0, numberOfInfants: extra.infants ?? 0, numberOfPets: 0 },
        },
      ],
    };
  };

  const setMin = (listingId: string, date: Ymd, min: number) => {
    const m = minNightsFor.get(listingId) ?? {};
    m[date] = min;
    minNightsFor.set(listingId, m);
  };

  const days = windowDates(opts.today);
  const used = new Set<string>();
  /** One check-out for listing `l` on `day` plus a next-reservation scenario chosen by `roll` (0..1). */
  const scenario = (l: ParsedListing, day: Ymd, i: number, roll: number) => {
      used.add(`${l._id}|${day}`);
      const cap = Math.max(1, l.accommodates ?? 2);
      const nights = 2 + Math.floor(rand() * 3);
      reservations.push(mk(l._id, addDays(day, -nights), day, 1 + Math.floor(rand() * cap)));
      const nextGuests = 1 + Math.floor(rand() * cap);
      if (roll < 0.4) {
        const kids = rand() < 0.3 ? 1 + Math.floor(rand() * 2) : 0;
        const infants = kids && rand() < 0.4 ? 1 : 0;
        reservations.push(mk(l._id, day, addDays(day, 2 + Math.floor(rand() * 3)), Math.max(nextGuests, kids + 1), { children: kids, infants }));
        counts.sameDay++;
        if (kids) counts.children++;
      } else if (roll < 0.65) {
        // 1-night gap, min. stay 2 -> blocked
        reservations.push(mk(l._id, addDays(day, 1), addDays(day, 4), nextGuests));
        setMin(l._id, day, 2);
        counts.gapBlocked++;
      } else if (roll < 0.75) {
        // 1-night gap, min. stay 1 -> sellable
        reservations.push(mk(l._id, addDays(day, 1), addDays(day, 3), nextGuests));
        setMin(l._id, day, 1);
        counts.gapSellable++;
      } else if (roll < 0.82) {
        // 2-night gap, min. stay 3 on both days -> blocked
        reservations.push(mk(l._id, addDays(day, 2), addDays(day, 5), nextGuests));
        setMin(l._id, day, 3);
        setMin(l._id, addDays(day, 1), 3);
        counts.gapBlocked++;
      } else if (roll < 0.9) {
        // far next reservation
        reservations.push(mk(l._id, addDays(day, 20), addDays(day, 23), nextGuests));
        counts.farNext++;
      } else {
        counts.noNext++;
      }
      // forced listing 3 (1-night gap with min. stay 1) has its gap day blocked in the calendar
      if (i === 103) {
        const b = blockedDays.get(l._id) ?? new Set<Ymd>();
        b.add(day);
        blockedDays.set(l._id, b);
      }
  };

  // the first listings carry the special laundry lines (capsules, overrides, small duvets):
  // give each of them a check-out in the window so every rule is visible on the board
  const FORCED_ROLLS = [0.1, 0.5, 0.95, 0.7, 0.1, 0.5, 0.85, 0.3];
  for (let i = 0; i < Math.min(8, inScope.length); i++) {
    scenario(inScope[i], days[i % days.length], 100 + i, FORCED_ROLLS[i]);
  }
  for (const day of days) {
    const pool = inScope.filter((l) => !used.has(`${l._id}|${day}`));
    const already = [...used].filter((k) => k.endsWith(`|${day}`)).length;
    for (let i = 0; i < perDay - already && pool.length; i++) {
      const l = pool.splice(Math.floor(rand() * pool.length), 1)[0];
      scenario(l, day, i, rand());
    }
  }

  // two check-outs of one flat on the same day (a duplicate booking in Guesty)
  const dbl = inScope[0];
  if (dbl) {
    reservations.push(mk(dbl._id, addDays(opts.today, -3), opts.today, 2));
    reservations.push(mk(dbl._id, addDays(opts.today, -1), opts.today, 2));
    counts.doubleCheckout++;
  }
  // a multi-listing stay checking out tomorrow from the second listing
  const [a, b] = inScope.slice(1, 3);
  if (a && b) {
    n++;
    const r = mk(b._id, addDays(opts.today, -4), addDays(opts.today, 1), 2);
    r.stay = [
      { listingId: a._id, checkInDateLocalized: addDays(opts.today, -4), checkOutDateLocalized: addDays(opts.today, -2), guestsCount: 2, numberOfGuests: { numberOfAdults: 2, numberOfChildren: 0, numberOfInfants: 0 } },
      { listingId: b._id, checkInDateLocalized: addDays(opts.today, -2), checkOutDateLocalized: addDays(opts.today, 1), guestsCount: 2, numberOfGuests: { numberOfAdults: 2, numberOfChildren: 0, numberOfInfants: 0 } },
    ];
    reservations.push(r);
    counts.multiStay++;
  }
  // a cancelled reservation that would have checked out today
  const c = inScope[3];
  if (c) reservations.push(mk(c._id, addDays(opts.today, -2), opts.today, 3, { status: 'canceled' }));

  for (const l of inScope) {
    const mins = minNightsFor.get(l._id) ?? {};
    const blocked = blockedDays.get(l._id) ?? new Set<Ymd>();
    const list: ParsedCalendarDay[] = [];
    for (let i = 0; i < 25; i++) {
      const date = addDays(opts.today, i);
      list.push({ date, listingId: l._id, minNights: mins[date] ?? 2, status: blocked.has(date) ? 'unavailable' : 'available', cta: false, ctd: false });
    }
    calendar[l._id] = list;
  }

  return {
    data: {
      listings,
      reservations,
      calendar,
      customFieldDefs: [{ fieldId: '6ab385c5bcf98e0011a9419d', displayName: 'Informácie do práčovne', key: 'informacie_do_pracovne', object: 'listing', type: 'longtext' }],
      webhooks: [],
    },
    counts,
  };
}
