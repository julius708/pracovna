import { isCronAuthorized, unauthorized } from '@/app/api/_auth';
import { evaluateAlerts } from '@/sync/alerts';
import { createSyncContext } from '@/sync/context';
import { nightly } from '@/sync/nightly';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** 02:00 UTC daily (vercel.json): retention, listing refresh, webhook health, recompute. */
export async function GET(req: Request) {
  const ctx = createSyncContext();
  if (!isCronAuthorized(req, ctx.env)) return unauthorized();
  const result = await nightly({
    repo: ctx.repo,
    client: ctx.client,
    laundryFieldId: ctx.env.GUESTY_LAUNDRY_FIELD_ID,
    cleanerFieldId: ctx.env.GUESTY_CLEANER_FIELD_ID,
    webhookUrl: ctx.webhookUrl,
    log: ctx.log,
  });
  const webhook = result.webhook as { registered: boolean | null; silent: boolean } | undefined;
  const failures = (await ctx.repo.getState<number>('consecutive_failures')) ?? 0;
  await evaluateAlerts(
    { repo: ctx.repo, webhookUrl: ctx.env.ALERT_WEBHOOK_URL ?? null, log: ctx.log },
    {
      sync_failed_twice: failures >= 2,
      listing_drop: !!(await ctx.repo.getState('listing_drop')),
      token_quota: false,
      webhook_missing: webhook?.registered === false,
      webhook_silent: webhook?.silent === true,
    },
  );
  return Response.json(result);
}
