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
 *
 * Ordering rules, so a pack is never visually undone by older data:
 *  - a refresh requested while one is in flight is coalesced into one more
 *    refetch afterwards (never dropped), and the in-flight response is not
 *    applied because it may predate the change;
 *  - while a staff action (pack, undo, note, check) is in flight, responses are
 *    discarded and one refetch runs when the action has finished.
 * `connected` is the realtime channel state in live mode (or "last poll ok"
 * without realtime); a failed refetch clears it, the next successful one
 * restores it. When the server reports no viewer (signed out elsewhere,
 * account deactivated) the page reloads so the server can show the right screen;
 * a failed request (outage) only marks the board offline and keeps the data.
 */
export function useLiveBoard(initial: BoardData) {
  const [data, setData] = useState<BoardData>(initial);
  const [connected, setConnected] = useState<boolean>(!initial.live);
  const connectedRef = useRef(connected);
  /** Realtime channel state; always true without realtime, where polling is the transport. */
  const channelUp = useRef(!initial.live);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);
  const pending = useRef(false);
  const actions = useRef(0);
  const discarded = useRef(false);
  const reloading = useRef(false);

  useEffect(() => {
    connectedRef.current = connected;
  }, [connected]);

  const refresh = useCallback(async () => {
    if (inFlight.current) {
      pending.current = true;
      return;
    }
    inFlight.current = true;
    try {
      do {
        pending.current = false;
        const next = await refreshBoard();
        if (actions.current > 0) {
          // a staff action is still running: this response may predate it; refetch when the action ends
          discarded.current = true;
          return;
        }
        // a newer refresh was requested meanwhile: fetch again instead of applying possibly stale rows
        if (pending.current) continue;
        if (next === null) {
          if (!reloading.current) {
            reloading.current = true;
            window.location.reload();
          }
          return;
        }
        setData(next);
        setConnected(channelUp.current);
      } while (pending.current);
    } catch {
      setConnected(false);
    } finally {
      inFlight.current = false;
      pending.current = false;
    }
  }, []);

  /** Runs a staff action; board refetches are held back while it is in flight (see above). */
  const track = useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T> => {
      actions.current += 1;
      try {
        return await fn();
      } finally {
        actions.current -= 1;
        if (actions.current === 0 && discarded.current) {
          discarded.current = false;
          void refresh();
        }
      }
    },
    [refresh],
  );

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
        channelUp.current = ok;
        setConnected(ok);
        if (ok) debounced();
      });
    // safety net only while realtime is down or the last refetch failed (the ref holds the current state)
    const fallback = setInterval(() => {
      if (!connectedRef.current) void refresh();
    }, POLL_MS_LIVE_DOWN);
    return () => {
      clearInterval(fallback);
      void supabase.removeChannel(channel);
    };
  }, [initial.live, refresh, debounced]);

  return { data, setData, refresh, connected, track };
}
