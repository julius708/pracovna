import { describe, expect, it } from 'vitest';
import { MemoryRepo } from '@/db/memory-repo';
import { loadEnv } from '@/env';
import { createLogger } from '@/guesty/log';
import { alertSinksFromEnv, evaluateAlerts, sendAlert } from '@/sync/alerts';

type Call = { url: string; body: Record<string, unknown> };

describe('alert sinks', () => {
  it('posts to the webhook and to Telegram, reports each delivery, never throws', async () => {
    const calls: Call[] = [];
    const fetchMock = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return new Response('{}', { status: String(url).includes('telegram') ? 200 : 500 });
    }) as typeof fetch;
    const r = await sendAlert({ webhookUrl: 'https://alerts.example/hook', telegram: { botToken: '123:ABC', chatId: '42' }, fetch: fetchMock }, 'hello');
    expect(r).toEqual({ webhook: false, telegram: true });
    expect(calls[0]).toEqual({ url: 'https://alerts.example/hook', body: { text: 'hello' } });
    expect(calls[1].url).toBe('https://api.telegram.org/bot123:ABC/sendMessage');
    expect(calls[1].body).toMatchObject({ chat_id: '42', text: 'hello' });
  });

  it('a network error is swallowed and logged without the bot token', async () => {
    const lines: string[] = [];
    const log = createLogger({ level: 'warn', sink: (l) => lines.push(l) });
    const fetchMock = (async (url: string | URL | Request) => {
      throw new Error(`fetch failed for ${String(url)}`);
    }) as typeof fetch;
    const r = await sendAlert({ telegram: { botToken: 'SECRET123', chatId: '42' }, fetch: fetchMock, log }, 'x');
    expect(r).toEqual({ webhook: null, telegram: false });
    expect(lines.join('\n')).toContain('alert.telegram_failed');
    expect(lines.join('\n')).not.toContain('SECRET123');
  });

  it('nothing configured means nothing sent and nothing reported', async () => {
    let calls = 0;
    const fetchMock = (async () => {
      calls++;
      return new Response('{}');
    }) as typeof fetch;
    expect(await sendAlert({ fetch: fetchMock }, 'x')).toEqual({ webhook: null, telegram: null });
    expect(calls).toBe(0);
  });

  it('alertSinksFromEnv needs both Telegram values', () => {
    const base = { SEED_MODE: 'true' };
    expect(alertSinksFromEnv(loadEnv({ ...base, ALERT_TELEGRAM_BOT_TOKEN: 't' })).telegram).toBeNull();
    expect(alertSinksFromEnv(loadEnv({ ...base, ALERT_TELEGRAM_CHAT_ID: 'c' })).telegram).toBeNull();
    expect(alertSinksFromEnv(loadEnv({ ...base, ALERT_TELEGRAM_BOT_TOKEN: 't', ALERT_TELEGRAM_CHAT_ID: 'c', ALERT_WEBHOOK_URL: 'https://h.example/x' }))).toEqual({
      webhookUrl: 'https://h.example/x',
      telegram: { botToken: 't', chatId: 'c' },
    });
  });

  it('evaluateAlerts delivers through the Telegram sink', async () => {
    const repo = new MemoryRepo();
    const bodies: Record<string, unknown>[] = [];
    const fetchMock = (async (_url: string | URL | Request, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    await evaluateAlerts({ repo, telegram: { botToken: 't', chatId: 'c' }, fetch: fetchMock }, { sync_failed_twice: true });
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({ chat_id: 'c', text: '⚠️ Práčovňa: Synchronizácia s Guesty zlyhala dvakrát po sebe.' });
  });
});
