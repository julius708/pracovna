import { isAdminAuthorized, unauthorized } from '@/app/api/_auth';
import { createSyncContext } from '@/sync/context';
import { syncListings } from '@/sync/listings';
import { reconcile } from '@/sync/reconcile';
import { recomputeWindow } from '@/sync/recompute';
import { processWebhookEvent } from '@/sync/webhook-handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** Buttons on the Stav page: { job: 'reconcile' | 'listings' | 'recompute' | 'webhook_retry', eventId? } */
export async function POST(req: Request) {
  const ctx = createSyncContext();
  if (!(await isAdminAuthorized(req, ctx.env))) return unauthorized();
  const body = (await req.json().catch(() => ({}))) as { job?: string; eventId?: number };
  const common = { repo: ctx.repo, client: ctx.client, laundryFieldId: ctx.env.GUESTY_LAUNDRY_FIELD_ID, cleanerFieldId: ctx.env.GUESTY_CLEANER_FIELD_ID, log: ctx.log };
  switch (body.job ?? 'reconcile') {
    case 'reconcile':
      return Response.json(await reconcile({ ...common, forceListings: false }, 'manual'));
    case 'listings':
      return Response.json(await syncListings(common));
    case 'recompute':
      return Response.json(await recomputeWindow({ repo: ctx.repo, log: ctx.log }, 'manual'));
    case 'webhook_retry': {
      if (!body.eventId) return Response.json({ ok: false, error: 'eventId required' }, { status: 400 });
      const ev = await ctx.repo.getWebhookEvent(body.eventId);
      if (!ev) return Response.json({ ok: false, error: 'not found' }, { status: 404 });
      return Response.json({ ok: true, result: await processWebhookEvent(common, ev) });
    }
    default:
      return Response.json({ ok: false, error: 'unknown job' }, { status: 400 });
  }
}
