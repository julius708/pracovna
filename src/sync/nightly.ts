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
  sleep?: (ms: number) => Promise<void>;
}

export interface WebhookHealth {
  registered: boolean | null;
  lastWebhookAt: string | null;
  /** Reconcile saw reservation changes in the last 24 h but no webhook arrived in that time. */
  silent: boolean;
}

const NIGHTLY_LOCK_SECONDS = 600;
const LOCK_RETRIES = 6;
const LOCK_RETRY_MS = 10_000;

/** Is our webhook still registered, and has Guesty delivered anything while changes were happening? */
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
  const [lastWebhookAt, lastChangeAt] = await Promise.all([deps.repo.getState<string>('last_webhook_at'), deps.repo.getState<string>('reconcile_change_at')]);
  const dayAgo = now().getTime() - 24 * 3_600_000;
  const changesRecently = !!lastChangeAt && Date.parse(lastChangeAt) > dayAgo;
  const webhookRecently = !!lastWebhookAt && Date.parse(lastWebhookAt) > dayAgo;
  return { registered, lastWebhookAt, silent: changesRecently && !webhookRecently };
}

/** Nightly: retention, full listing refresh, webhook health, recompute for the new day. Holds the reconcile lock. */
export async function nightly(deps: NightlyDeps): Promise<Record<string, unknown>> {
  const { repo } = deps;
  const now = deps.now ?? (() => new Date());
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const runId = await repo.startRun('nightly', 'cron');
  const log = (deps.log ?? silentLogger).child({ job: 'nightly', run_id: runId });
  const lockId = `nightly-${runId}`;
  const stats: Record<string, unknown> = {};
  let error: string | null = null;
  const callsBefore = deps.client.calls();

  let locked = false;
  for (let i = 0; i < LOCK_RETRIES && !locked; i++) {
    locked = await repo.acquireLock('reconcile', NIGHTLY_LOCK_SECONDS, lockId);
    if (!locked) await sleep(LOCK_RETRY_MS);
  }
  if (!locked) log.warn('nightly.lock_not_acquired');

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
  } finally {
    if (locked) await repo.releaseLock('reconcile', lockId);
  }
  await repo.finishRun(runId, { ok: error === null, error, guesty_calls: deps.client.calls() - callsBefore, stats });
  return { ok: error === null, error, ...stats };
}
