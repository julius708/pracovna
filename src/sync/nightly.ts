import { todayInTz } from '@/core/packing';
import type { SyncRepo } from '@/db/repo';
import type { GuestyClient } from '@/guesty/client';
import type { Logger } from '@/guesty/log';
import { silentLogger } from '@/guesty/log';
import { syncListings } from './listings';
import { recomputeWindow } from './recompute';

export interface NightlyDeps {
  repo: SyncRepo;
  client: GuestyClient;
  laundryFieldId: string;
  cleanerFieldId?: string | null;
  webhookUrl: string | null;
  log?: Logger;
  now?: () => Date;
}

export interface WebhookHealth {
  registered: boolean | null;
  lastWebhookAt: string | null;
  silent: boolean;
}

/** Is our webhook still registered, and has Guesty delivered anything in the last 24 h? */
export async function checkWebhookHealth(deps: Pick<NightlyDeps, 'repo' | 'client' | 'webhookUrl' | 'now'>): Promise<WebhookHealth> {
  const now = deps.now ?? (() => new Date());
  let registered: boolean | null = null;
  if (deps.webhookUrl) {
    try {
      const hooks = await deps.client.listWebhooks();
      registered = hooks.some((h) => h.url === deps.webhookUrl);
    } catch {
      registered = null;
    }
  }
  const lastWebhookAt = await deps.repo.getState<string>('last_webhook_at');
  const changesObserved = (await deps.repo.getState<string>('last_ok_sync_at')) !== null;
  const silent = !!lastWebhookAt && changesObserved && now().getTime() - Date.parse(lastWebhookAt) > 24 * 3_600_000;
  return { registered, lastWebhookAt, silent };
}

/** Nightly: retention, full listing refresh, webhook health, recompute for the new day. */
export async function nightly(deps: NightlyDeps): Promise<Record<string, unknown>> {
  const { repo } = deps;
  const now = deps.now ?? (() => new Date());
  const log = (deps.log ?? silentLogger).child({ job: 'nightly' });
  const runId = await repo.startRun('nightly', 'cron');
  const stats: Record<string, unknown> = {};
  let error: string | null = null;
  const callsBefore = deps.client.calls();
  try {
    stats.retention = await repo.runRetention(now());
    try {
      stats.listings = await syncListings({ repo, client: deps.client, laundryFieldId: deps.laundryFieldId, cleanerFieldId: deps.cleanerFieldId, log, now });
    } catch (e) {
      stats.listings_error = String(e);
    }
    stats.webhook = await checkWebhookHealth(deps);
    stats.recompute = await recomputeWindow({ repo, log, now }, 'nightly', todayInTz(now()));
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    log.error('nightly.failed', { error });
  }
  await repo.finishRun(runId, { ok: error === null, error, guesty_calls: deps.client.calls() - callsBefore, stats });
  return { ok: error === null, error, ...stats };
}
