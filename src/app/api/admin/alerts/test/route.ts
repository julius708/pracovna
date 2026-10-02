import { isAdminAuthorized, unauthorized } from '@/app/api/_auth';
import { env } from '@/env';
import { createLogger } from '@/guesty/log';
import { alertSinksFromEnv, sendAlert } from '@/sync/alerts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Sends a test message to every configured alert sink, so the wiring can be checked after setting it up. */
export async function POST(req: Request) {
  const e = env();
  if (!(await isAdminAuthorized(req, e))) return unauthorized();
  const sinks = alertSinksFromEnv(e);
  const delivered = await sendAlert({ ...sinks, log: createLogger({ level: e.LOG_LEVEL, bindings: { job: 'alerts' } }) }, '🔔 Práčovňa: testovacia správa – upozornenia fungujú.');
  return Response.json({ ok: true, configured: { webhook: !!sinks.webhookUrl, telegram: !!sinks.telegram }, delivered });
}
