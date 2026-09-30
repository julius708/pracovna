import { after } from 'next/server';
import { createSyncContext } from '@/sync/context';
import { processWebhookEvent, receiveWebhook } from '@/sync/webhook-handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Guesty delivery (Svix-signed). Verify, store, answer 200 within a second,
 * then process after the response is sent.
 */
export async function POST(req: Request) {
  const ctx = createSyncContext();
  const rawBody = await req.text();
  const headers: Record<string, string | null> = {};
  for (const name of ['svix-id', 'svix-timestamp', 'svix-signature', 'webhook-id', 'webhook-timestamp', 'webhook-signature']) {
    headers[name] = req.headers.get(name);
  }
  const result = await receiveWebhook(ctx.repo, { rawBody, headers, secret: ctx.env.GUESTY_WEBHOOK_SECRET ?? null }, ctx.log);
  if (result.status !== 200) return Response.json({ ok: false, reason: result.reason }, { status: result.status });
  if (!result.duplicate && result.eventId !== null) {
    const eventId = result.eventId;
    after(async () => {
      const ev = await ctx.repo.getWebhookEvent(eventId);
      if (ev) {
        await processWebhookEvent(
          { repo: ctx.repo, client: ctx.client, laundryFieldId: ctx.env.GUESTY_LAUNDRY_FIELD_ID, cleanerFieldId: ctx.env.GUESTY_CLEANER_FIELD_ID, log: ctx.log },
          ev,
        );
      }
    });
  }
  return Response.json({ ok: true, duplicate: result.duplicate });
}
