import { describe, expect, it } from 'vitest';
import { MemoryRepo } from '@/db/memory-repo';
import type { EarlyArrivalInsert, PushSubscriptionRow } from '@/db/types';
import { loadEnv, pushConfigured } from '@/env';
import { earlyArrivalMessages, pushEarlyArrivals, sendPushes, webPushSender, type PushMessage } from '@/sync/push';

const row = (over: Partial<EarlyArrivalInsert> = {}): EarlyArrivalInsert => ({
  listing_id: over.listing_id ?? '69e7584bd6397b001423638a',
  listing_name: over.listing_name ?? 'Poštová, Heart',
  date: over.date ?? '2026-10-12',
  arrival: over.arrival ?? '13:00',
  note: '',
  author_name: 'Guesty',
  source: 'guesty',
  reservation_id: over.reservation_id ?? 'R1',
});

function sub(endpoint: string, user = 'Angelika'): PushSubscriptionRow {
  return { id: endpoint, user_id: `u-${user}`, user_name: user, endpoint, p256dh: 'p'.repeat(20), auth: 'a'.repeat(10), user_agent: 'test', created_at: '2026-10-11T06:00:00Z', last_ok_at: null, failed_at: null };
}

describe('push notifications for early arrivals (owner, 2026-10-11)', () => {
  it('one message per arrival: the time in the title, the flat with its alias and the day in the body, one tag per flat and day', () => {
    const msgs = earlyArrivalMessages([row(), row({ listing_id: 'L9', listing_name: 'Mestská, Modern', date: '2026-10-11', arrival: '12:00' }), row({ listing_id: 'L8', listing_name: 'Vysoká, President', date: '2026-10-14' })], '2026-10-11');
    expect(msgs[0]).toEqual({ title: '⏰ Skorý príchod o 13:00', body: 'Poštová, Heart (č. bytu 606) · zajtra 12.10. – hosť môže byť v byte skôr', tag: 'early-arrival|69e7584bd6397b001423638a|2026-10-12', url: '/' });
    expect(msgs[1].body).toBe('Mestská, Modern · dnes 11.10. – hosť môže byť v byte skôr');
    expect(msgs[2].body).toBe('Vysoká, President · st 14.10. – hosť môže byť v byte skôr');
  });

  it('sends every message to every subscription, prunes the ones the push service reports gone, keeps the rest on other failures', async () => {
    const repo = new MemoryRepo();
    repo.pushSubscriptions = [sub('https://push.example/a'), sub('https://push.example/gone', 'Max'), sub('https://push.example/down', 'Július')];
    const calls: string[] = [];
    const send = async (s: PushSubscriptionRow, m: PushMessage) => {
      calls.push(`${s.user_name}:${m.tag}`);
      if (s.endpoint.endsWith('gone')) return 410;
      if (s.endpoint.endsWith('down')) throw new Error('ECONNRESET');
      return 201;
    };
    const res = await sendPushes(repo, earlyArrivalMessages([row(), row({ listing_id: 'L2', date: '2026-10-13' })], '2026-10-11'), send);
    expect(res).toEqual({ sent: 2, failed: 2, pruned: 1 });
    expect(calls.filter((c) => c.startsWith('Max'))).toHaveLength(1); // stopped after the first 410
    expect((await repo.getPushSubscriptions()).map((s) => s.user_name)).toEqual(['Angelika', 'Július']);
  });

  it('nothing is sent without arrivals or without a sender; an injected sender is used as is', async () => {
    const repo = new MemoryRepo();
    repo.pushSubscriptions = [sub('https://push.example/a')];
    expect(await pushEarlyArrivals(repo, [], '2026-10-11')).toBeNull();
    expect(await pushEarlyArrivals(repo, [row()], '2026-10-11', undefined, null)).toBeNull();
    let n = 0;
    const res = await pushEarlyArrivals(repo, [row()], '2026-10-11', undefined, async () => {
      n++;
      return 201;
    });
    expect(res).toEqual({ sent: 1, failed: 0, pruned: 0 });
    expect(n).toBe(1);
  });

  it('a typed-in arrival goes to everyone but the writer (Martina, 2026-10-19)', async () => {
    const repo = new MemoryRepo();
    repo.pushSubscriptions = [sub('https://push.example/a'), sub('https://push.example/b', 'Max'), sub('https://push.example/c', 'Max')];
    const to: string[] = [];
    const res = await pushEarlyArrivals(repo, [row()], '2026-10-11', undefined, async (s) => {
      to.push(s.user_name);
      return 201;
    }, 'u-Max');
    expect(res).toEqual({ sent: 1, failed: 0, pruned: 0 });
    expect(to).toEqual(['Angelika']);
  });

  it('push is configured only with all three VAPID settings; the sender is null otherwise', () => {
    const base = { SEED_MODE: 'true' };
    expect(pushConfigured(loadEnv(base))).toBe(false);
    expect(webPushSender(loadEnv(base))).toBeNull();
    const env = loadEnv({ ...base, NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY: 'B'.repeat(87), WEB_PUSH_PRIVATE_KEY: 'k'.repeat(43), WEB_PUSH_SUBJECT: 'https://pracovna-cyan.vercel.app' });
    expect(pushConfigured(env)).toBe(true);
    expect(webPushSender(env)).toBeTypeOf('function');
    expect(() => loadEnv({ ...base, WEB_PUSH_SUBJECT: 'julius' })).toThrow(/WEB_PUSH_SUBJECT/);
  });
});
