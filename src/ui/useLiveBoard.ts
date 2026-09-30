'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { refreshBoard } from '@/app/_lib/actions';
import type { BoardData } from '@/app/_lib/board';
import { todayInTz } from '@/core/packing';
import { getBrowserSupabase } from '@/db/browser';

const POLL_MS_LIVE_DOWN = 60_000;
const POLL_MS_NO_REALTIME = 5_000;

/**
 * Keeps the board fresh: Supabase Realtime broadcast on the private "board"
 * topic triggers a debounced refetch; without realtime the board polls. Also
 * refetches on reconnect, on tab focus and at local midnight.
 */
export function useLiveBoard(initial: BoardData) {
  const [data, setData] = useState<BoardData>(initial);
  const [connected, setConnected] = useState<boolean>(!initial.live);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const next = await refreshBoard();
      if (next) {
        setData(next);
        if (!initial.live) setConnected(true);
      }
    } catch {
      setConnected(false);
    } finally {
      inFlight.current = false;
    }
  }, [initial.live]);

  const debounced = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void refresh(), 250);
  }, [refresh]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') debounced();
    };
    window.addEventListener('focus', debounced);
    window.addEventListener('online', debounced);
    document.addEventListener('visibilitychange', onVisible);
    const midnight = setInterval(() => {
      if (todayInTz(new Date()) !== data.today) debounced();
    }, 60_000);
    return () => {
      window.removeEventListener('focus', debounced);
      window.removeEventListener('online', debounced);
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(midnight);
    };
  }, [debounced, data.today]);

  useEffect(() => {
    const supabase = initial.live ? getBrowserSupabase() : null;
    if (!supabase) {
      const poll = setInterval(() => void refresh(), POLL_MS_NO_REALTIME);
      return () => clearInterval(poll);
    }
    const channel = supabase
      .channel('board', { config: { private: true } })
      .on('broadcast', { event: 'change' }, () => debounced())
      .subscribe((status: string) => {
        const ok = status === 'SUBSCRIBED';
        setConnected(ok);
        if (ok) debounced();
      });
    const fallback = setInterval(() => {
      if (!connected) void refresh();
    }, POLL_MS_LIVE_DOWN);
    return () => {
      clearInterval(fallback);
      void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial.live]);

  return { data, setData, refresh, connected };
}
