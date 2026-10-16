import { NextResponse } from 'next/server';
import { removePushSubscriptionAction, savePushSubscriptionAction, type PushSubscriptionJson } from '@/app/_lib/push-actions';

export const dynamic = 'force-dynamic';

/**
 * The service worker's way to store a rotated subscription (pushsubscriptionchange):
 * it cannot call server actions, so it posts the new subscription here with the
 * session cookie. Body: { endpoint, keys: { p256dh, auth }, oldEndpoint? }.
 */
export async function POST(req: Request) {
  let body: Partial<PushSubscriptionJson> & { oldEndpoint?: string | null };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid' }, { status: 400 });
  }
  const res = await savePushSubscriptionAction({ endpoint: String(body.endpoint ?? ''), keys: { p256dh: String(body.keys?.p256dh ?? ''), auth: String(body.keys?.auth ?? '') } }, req.headers.get('user-agent') ?? '');
  if (!res.ok) return NextResponse.json(res, { status: res.error === 'unauthorized' ? 401 : 400 });
  if (body.oldEndpoint && body.oldEndpoint !== body.endpoint) await removePushSubscriptionAction(String(body.oldEndpoint));
  return NextResponse.json({ ok: true });
}
