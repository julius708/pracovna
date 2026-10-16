import { flatAlias, formatDM, weekdayShort, type Ymd } from '@/core/packing';
import type { SyncRepo } from '@/db/repo';
import type { EarlyArrivalInsert, PushSubscriptionRow } from '@/db/types';
import { loadEnv, pushConfigured, type Env } from '@/env';
import type { Logger } from '@/guesty/log';
import { silentLogger } from '@/guesty/log';

/** What one notification says; the service worker (public/sw.js) shows it. */
export interface PushMessage {
  title: string;
  body: string;
  /** Same tag = the newer notification replaces the older one on the device. */
  tag: string;
  url: string;
}

/** Sends one message to one subscription; resolves with the push service's status (201 = accepted). */
export type PushSender = (sub: PushSubscriptionRow, message: PushMessage) => Promise<number>;

/** The day word for a notification: "dnes 11.10.", "zajtra 12.10.", "ut 13.10.". */
function dayText(date: Ymd, today: Ymd): string {
  if (date === today) return `dnes ${formatDM(date)}`;
  const t = new Date(`${today}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + 1);
  if (date === t.toISOString().slice(0, 10)) return `zajtra ${formatDM(date)}`;
  return `${weekdayShort(date)} ${formatDM(date)}`;
}

/** The notification for each early arrival Guesty just reported (owner, 2026-10-11). */
export function earlyArrivalMessages(rows: EarlyArrivalInsert[], today: Ymd): PushMessage[] {
  return rows.map((r) => {
    const alias = flatAlias(r.listing_id);
    return {
      title: `⏰ Skorý príchod o ${r.arrival}`,
      body: `${r.listing_name}${alias ? ` (${alias})` : ''} · ${dayText(r.date, today)} – hosť môže byť v byte skôr`,
      tag: `early-arrival|${r.listing_id}|${r.date}`,
      url: '/',
    };
  });
}

/** The web-push sender with the VAPID keys of the environment; null when push is not configured. */
export function webPushSender(env: Env): PushSender | null {
  if (!pushConfigured(env)) return null;
  // loaded lazily: the package is server-only and not needed when push is off
  let lib: typeof import('web-push') | null = null;
  return async (sub, message) => {
    lib ??= await import('web-push');
    lib.setVapidDetails(env.WEB_PUSH_SUBJECT!, env.NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY!, env.WEB_PUSH_PRIVATE_KEY!);
    try {
      const res = await lib.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(message), { TTL: 24 * 3600, urgency: 'high' });
      return res.statusCode;
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (typeof status === 'number') return status;
      throw e;
    }
  };
}

export interface PushResult {
  sent: number;
  failed: number;
  /** Subscriptions the push service reported gone (404/410), deleted. */
  pruned: number;
}

/**
 * Sends every message to every subscription of an active user. A subscription
 * the push service no longer knows is deleted; other failures are logged and
 * the subscription kept (the service may be down).
 */
export async function sendPushes(repo: SyncRepo, messages: PushMessage[], send: PushSender, log: Logger = silentLogger): Promise<PushResult> {
  const res: PushResult = { sent: 0, failed: 0, pruned: 0 };
  if (!messages.length) return res;
  const subs = await repo.getPushSubscriptions();
  const gone = new Set<string>();
  for (const sub of subs) {
    for (const m of messages) {
      if (gone.has(sub.endpoint)) break;
      try {
        const status = await send(sub, m);
        if (status === 404 || status === 410) {
          gone.add(sub.endpoint);
        } else if (status >= 200 && status < 300) {
          res.sent++;
        } else {
          res.failed++;
          log.warn('push.rejected', { status, user: sub.user_name });
        }
      } catch (e) {
        res.failed++;
        log.warn('push.failed', { error: String(e), user: sub.user_name });
      }
    }
  }
  if (gone.size) {
    await repo.deletePushSubscriptions([...gone]);
    res.pruned = gone.size;
  }
  if (res.sent || res.failed || res.pruned) log.info('push.done', { ...res, subscriptions: subs.length, messages: messages.length });
  return res;
}

/**
 * Pushes the early arrivals the sync just added, when push is configured in the
 * environment. Called by the recompute; `sender` is injected by tests.
 */
export async function pushEarlyArrivals(repo: SyncRepo, added: EarlyArrivalInsert[], today: Ymd, log: Logger = silentLogger, sender?: PushSender | null): Promise<PushResult | null> {
  if (!added.length) return null;
  let send = sender;
  if (send === undefined) {
    try {
      send = webPushSender(loadEnv());
    } catch {
      send = null;
    }
  }
  if (!send) return null;
  return sendPushes(repo, earlyArrivalMessages(added, today), send, log);
}
