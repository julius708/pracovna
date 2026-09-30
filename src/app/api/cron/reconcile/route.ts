import { isCronAuthorized, unauthorized } from '@/app/api/_auth';
import { evaluateAlerts } from '@/sync/alerts';
import { createSyncContext } from '@/sync/context';
import { reconcile } from '@/sync/reconcile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** Every 3 minutes (vercel.json). Also callable by an operator with the cron secret. */
export async function GET(req: Request) {
  const ctx = createSyncContext();
  if (!isCronAuthorized(req, ctx.env)) return unauthorized();
  const result = await reconcile(
    { repo: ctx.repo, client: ctx.client, laundryFieldId: ctx.env.GUESTY_LAUNDRY_FIELD_ID, cleanerFieldId: ctx.env.GUESTY_CLEANER_FIELD_ID, log: ctx.log },
    'cron',
  );
  const failures = (await ctx.repo.getState<number>('consecutive_failures')) ?? 0;
  const drop = await ctx.repo.getState<unknown>('listing_drop');
  await evaluateAlerts(
    { repo: ctx.repo, webhookUrl: ctx.env.ALERT_WEBHOOK_URL ?? null, log: ctx.log },
    { sync_failed_twice: failures >= 2, listing_drop: !!drop, token_quota: false, webhook_missing: false, webhook_silent: false },
  );
  return Response.json({ ok: result.ok, skipped: result.skipped, partial: result.partial, error: result.error, stats: result.stats });
}
