import type { SyncRepo } from '@/db/repo';
import type { Env } from '@/env';
import type { Logger } from '@/guesty/log';
import { silentLogger } from '@/guesty/log';

export type AlertKind = 'sync_failed_twice' | 'token_quota' | 'webhook_missing' | 'webhook_silent' | 'listing_drop';

export interface AlertState {
  open: Partial<Record<AlertKind, { since: string; lastSent: string | null }>>;
}

/** A Telegram bot that writes into one chat (the laundry group or Julius). */
export interface TelegramSink {
  botToken: string;
  chatId: string;
}

export interface AlertSinks {
  /** Generic JSON webhook: POST {text}. */
  webhookUrl?: string | null;
  telegram?: TelegramSink | null;
  fetch?: typeof fetch;
  log?: Logger;
}

export interface AlertDeps extends AlertSinks {
  repo: SyncRepo;
  now?: () => Date;
}

const RESEND_MS = 6 * 3_600_000;

/** The sinks configured in the environment; Telegram needs both the token and the chat id. */
export function alertSinksFromEnv(env: Env): Pick<AlertSinks, 'webhookUrl' | 'telegram'> {
  return {
    webhookUrl: env.ALERT_WEBHOOK_URL ?? null,
    telegram: env.ALERT_TELEGRAM_BOT_TOKEN && env.ALERT_TELEGRAM_CHAT_ID ? { botToken: env.ALERT_TELEGRAM_BOT_TOKEN, chatId: env.ALERT_TELEGRAM_CHAT_ID } : null,
  };
}

export interface Delivery {
  /** null = sink not configured */
  webhook: boolean | null;
  telegram: boolean | null;
}

/** Sends one text to every configured sink. Failures are logged (without the bot token) and never thrown. */
export async function sendAlert(sinks: AlertSinks, text: string): Promise<Delivery> {
  const f = sinks.fetch ?? fetch;
  const log = sinks.log ?? silentLogger;
  const out: Delivery = { webhook: null, telegram: null };
  if (sinks.webhookUrl) {
    try {
      const r = await f(sinks.webhookUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) });
      out.webhook = r.ok;
      if (!r.ok) log.warn('alert.webhook_failed', { status: r.status });
    } catch (e) {
      out.webhook = false;
      log.warn('alert.webhook_failed', { error: String(e) });
    }
  }
  if (sinks.telegram) {
    const { botToken, chatId } = sinks.telegram;
    try {
      const r = await f(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      });
      out.telegram = r.ok;
      if (!r.ok) log.warn('alert.telegram_failed', { status: r.status });
    } catch (e) {
      out.telegram = false;
      log.warn('alert.telegram_failed', { error: String(e).split(botToken).join('[token]') });
    }
  }
  return out;
}

export const ALERT_TEXT: Record<AlertKind, string> = {
  sync_failed_twice: 'Synchronizácia s Guesty zlyhala dvakrát po sebe.',
  token_quota: 'Guesty token: denný limit takmer vyčerpaný.',
  webhook_missing: 'Guesty webhook už nie je zaregistrovaný.',
  webhook_silent: 'Guesty webhook mlčí viac ako 24 hodín.',
  listing_drop: 'Načítanie bytov z Guesty by vyradilo priveľa bytov – zmena nebola použitá.',
};

async function post(deps: AlertDeps, text: string): Promise<void> {
  await sendAlert(deps, text);
}

/**
 * Opens/closes the alerts named in `conditions` (kinds not mentioned are left
 * as they are, so the 3-minute job cannot resolve what only the nightly job
 * checks). Sends once on open, every 6 h while open, once on resolve.
 */
export async function evaluateAlerts(deps: AlertDeps, conditions: Partial<Record<AlertKind, boolean>>): Promise<AlertState> {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? silentLogger;
  const state = (await deps.repo.getState<AlertState>('alert_state')) ?? { open: {} };
  const t = now();
  for (const kind of Object.keys(conditions) as AlertKind[]) {
    const active = conditions[kind];
    if (active === undefined) continue;
    const cur = state.open[kind];
    if (active && !cur) {
      state.open[kind] = { since: t.toISOString(), lastSent: t.toISOString() };
      log.error('alert.open', { kind });
      await post(deps, `⚠️ Práčovňa: ${ALERT_TEXT[kind]}`);
    } else if (active && cur && (!cur.lastSent || t.getTime() - Date.parse(cur.lastSent) > RESEND_MS)) {
      cur.lastSent = t.toISOString();
      await post(deps, `⚠️ Práčovňa (stále): ${ALERT_TEXT[kind]}`);
    } else if (!active && cur) {
      delete state.open[kind];
      log.info('alert.resolved', { kind });
      await post(deps, `✅ Práčovňa: vyriešené – ${ALERT_TEXT[kind]}`);
    }
  }
  await deps.repo.setState('alert_state', state);
  return state;
}

/** Shared alert inputs the cron routes compute from repo state. */
export async function commonAlertConditions(repo: SyncRepo, maxMints: number, now: Date = new Date()): Promise<Partial<Record<AlertKind, boolean>>> {
  const [failures, drop, token] = await Promise.all([repo.getState<number>('consecutive_failures'), repo.getState<unknown>('listing_drop'), repo.tokenStore.read()]);
  const mints = token.mints.filter((m) => Date.parse(m) > now.getTime() - 24 * 3_600_000).length;
  return { sync_failed_twice: (failures ?? 0) >= 2, listing_drop: !!drop, token_quota: mints >= maxMints };
}
