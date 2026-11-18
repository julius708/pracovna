/**
 * Odfajkávanie "čo treba zbaliť" (feedback #18, krok 1): značky ostávajú len v prehliadači (localStorage),
 * nič sa neposiela do databázy a nikoho iného sa netýkajú. Značka patrí položke a počtu, pri ktorom sa
 * odfajkla: ak sa karta prepočíta a počet sa zmení, položka je znova neodfajknutá (treba ju skontrolovať).
 */
export const TICKS_PREFIX = 'pracovna:zbalit:';
/** Staré značky sa zahodia (balíček sa baľuje najviac pár dní). */
export const TICKS_MAX_AGE_MS = 14 * 24 * 3600 * 1000;

export interface TickStore {
  /** čas posledného zápisu (ms) */
  at: number;
  /** id položky -> počet v čase odfajknutia */
  t: Record<string, number>;
}

export const emptyTicks = (): TickStore => ({ at: 0, t: {} });

/** Bezpečné čítanie: poškodený alebo cudzí zápis = prázdno; so zadaným `now` aj príliš starý (bez neho sa vek nekontroluje, to robí čistenie pri zápise). */
export function parseTicks(raw: string | null | undefined, now?: number): TickStore {
  if (!raw) return emptyTicks();
  try {
    const v = JSON.parse(raw) as Partial<TickStore>;
    if (!v || typeof v !== 'object' || typeof v.at !== 'number' || !v.t || typeof v.t !== 'object') return emptyTicks();
    if (now !== undefined && now - v.at > TICKS_MAX_AGE_MS) return emptyTicks();
    const t: Record<string, number> = {};
    for (const [k, n] of Object.entries(v.t)) if (typeof n === 'number' && Number.isFinite(n)) t[k] = n;
    return { at: v.at, t };
  } catch {
    return emptyTicks();
  }
}

export const isTicked = (s: TickStore, id: string, n: number): boolean => s.t[id] === n;

/** Prepne značku položky pri danom počte (nový objekt, pôvodný sa nemení). */
export function toggleTick(s: TickStore, id: string, n: number, now: number): TickStore {
  const t = { ...s.t };
  if (t[id] === n) delete t[id];
  else t[id] = n;
  return { at: now, t };
}

export const serializeTicks = (s: TickStore): string => JSON.stringify(s);

/** Koľko z daných položiek je odfajknutých pri aktuálnom počte. */
export function countTicked(s: TickStore, items: readonly { id: string; n: number }[]): number {
  return items.filter((i) => isTicked(s, i.id, i.n)).length;
}
