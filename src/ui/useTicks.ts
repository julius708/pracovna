'use client';

import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { emptyTicks, parseTicks, serializeTicks, toggleTick, TICKS_MAX_AGE_MS, TICKS_PREFIX, type TickStore } from './ticks';

const listeners = new Set<() => void>();
/** Ak je localStorage zablokovaný (súkromné okno), značky žijú aspoň do obnovenia stránky. */
const memory = new Map<string, string>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener('storage', cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener('storage', cb);
  };
}

function read(key: string): string {
  try {
    const v = window.localStorage.getItem(key);
    if (v !== null) return v;
  } catch {
    /* nedostupné: pamäť */
  }
  return memory.get(key) ?? '';
}

function write(key: string, value: string) {
  memory.set(key, value);
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* ostáva v pamäti */
  }
}

/** Raz za čas odstráni staré značky iných balíčkov. */
function pruneOld(now: number) {
  try {
    for (let i = window.localStorage.length - 1; i >= 0; i--) {
      const k = window.localStorage.key(i);
      if (!k || !k.startsWith(TICKS_PREFIX)) continue;
      const s = parseTicks(window.localStorage.getItem(k), now);
      if (s.at === 0 || now - s.at > TICKS_MAX_AGE_MS) window.localStorage.removeItem(k);
    }
  } catch {
    /* nevadí */
  }
}

/** Značky odfajknutých položiek jedného balíčka; server ich nevidí. */
export function useTicks(packageId: string): { ticks: TickStore; toggle: (id: string, n: number) => void } {
  const key = `${TICKS_PREFIX}${packageId}`;
  // na serveri a pri hydratácii prázdno, potom hodnota z prehliadača (bez nesúladu)
  const raw = useSyncExternalStore(subscribe, () => read(key), () => '');
  const ticks = useMemo(() => (raw ? parseTicks(raw) : emptyTicks()), [raw]);
  const toggle = useCallback(
    (id: string, n: number) => {
      const now = Date.now();
      const next = toggleTick(parseTicks(read(key), now), id, n, now);
      write(key, serializeTicks(next));
      pruneOld(now);
      listeners.forEach((l) => l());
    },
    [key],
  );
  return { ticks, toggle };
}
