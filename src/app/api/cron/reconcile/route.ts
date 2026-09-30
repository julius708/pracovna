import { isCronAuthorized, unauthorized } from '@/app/api/_auth';
import { MAX_SERVER_MINTS_PER_24H } from '@/guesty/token';
import { commonAlertConditions, evaluateAlerts } from '@/sync/alerts';
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
  // only the alerts this job can judge; the webhook alerts belong to the nightly job
  await evaluateAlerts(
    { repo: ctx.repo, webhookUrl: ctx.env.ALERT_WEBHOOK_URL ?? null, log: ctx.log },
    await commonAlertConditions(ctx.repo, MAX_SERVER_MINTS_PER_24H),
  );
  return Response.json({ ok: result.ok, skipped: result.skipped, partial: result.partial, error: result.error, stats: result.stats });
}
