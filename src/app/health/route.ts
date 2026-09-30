import { loadEnv, missingSupabaseEnv } from '@/env';
import { createSyncContext } from '@/sync/context';
import type { AlertState } from '@/sync/alerts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STALE_SECONDS = 30 * 60;

/** Public health JSON: 503 when the database is down, the sync is stale or failing. */
export async function GET() {
  const startedAt = Date.now();
  let env;
  try {
    env = loadEnv();
  } catch (e) {
    return Response.json({ ok: false, error: String(e) }, { status: 503, headers: { 'cache-control': 'no-store' } });
  }
  const body: Record<string, unknown> = {
    ok: true,
    version: env.APP_VERSION ?? process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'dev',
    env: env.APP_ENV,
    seed_mode: env.SEED_MODE,
    db: missingSupabaseEnv(env).length ? 'not_configured' : 'unknown',
  };
  let status = 200;
  try {
    const ctx = createSyncContext({ env });
    const [lastOk, failures, lastWebhook, alerts] = await Promise.all([
      ctx.repo.getState<string>('last_ok_sync_at'),
      ctx.repo.getState<number>('consecutive_failures'),
      ctx.repo.getState<string>('last_webhook_at'),
      ctx.repo.getState<AlertState>('alert_state'),
    ]);
    body.db = ctx.ephemeral ? 'memory' : 'ok';
    body.last_ok_sync_at = lastOk;
    body.sync_age_s = lastOk ? Math.round((Date.now() - Date.parse(lastOk)) / 1000) : null;
    body.consecutive_failures = failures ?? 0;
    body.last_webhook_at = lastWebhook;
    body.open_alerts = Object.keys(alerts?.open ?? {});
    const token = await ctx.repo.tokenStore.read();
    body.token_expires_in_s = token.expiresAt ? Math.round((Date.parse(token.expiresAt) - Date.now()) / 1000) : null;
    body.token_mints_24h = token.mints.filter((m) => Date.parse(m) > Date.now() - 24 * 3_600_000).length;
    const stale = lastOk !== null && (body.sync_age_s as number) > STALE_SECONDS;
    if ((failures ?? 0) >= 2 || stale) {
      body.ok = false;
      status = 503;
    }
  } catch (e) {
    body.ok = false;
    body.db = 'down';
    body.error = e instanceof Error ? e.message : String(e);
    status = 503;
  }
  body.checked_in_ms = Date.now() - startedAt;
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
}
