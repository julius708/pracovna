import { isAdminAuthorized, unauthorized } from '@/app/api/_auth';
import { WEBHOOK_EVENTS } from '@/guesty/types';
import { createSyncContext } from '@/sync/context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Registers the webhook once per environment: lists existing subscriptions,
 * creates ours if the URL is missing, then fetches the signing secret. The
 * secret is returned once so the admin can paste it into the Vercel env.
 */
export async function POST(req: Request) {
  const ctx = createSyncContext();
  if (!(await isAdminAuthorized(req, ctx.env))) return unauthorized();
  const body = (await req.json().catch(() => ({}))) as { url?: string };
  const url = body.url ?? ctx.webhookUrl;
  if (!url) return Response.json({ ok: false, error: 'webhook url unknown: set APP_URL or pass { url }' }, { status: 400 });

  const existing = await ctx.client.listWebhooks();
  let hook = existing.find((h) => h.url === url) ?? null;
  let created = false;
  if (!hook) {
    hook = await ctx.client.createWebhook(url, WEBHOOK_EVENTS);
    created = true;
  }
  const secret = await ctx.client.getWebhookSecret(url);
  await ctx.repo.setState('webhook_registration', { url, webhookId: hook._id, events: hook.events, at: new Date().toISOString(), secretKeys: secret.responseKeys });
  ctx.log.info('webhook.registered', { url, created, id: hook._id });
  return Response.json({
    ok: true,
    created,
    webhook: { id: hook._id, url: hook.url, events: hook.events },
    secret: secret.secret,
    secretResponseKeys: secret.responseKeys,
    hint: 'Ulož secret do Vercel ako GUESTY_WEBHOOK_SECRET a znovu nasaď.',
  });
}
