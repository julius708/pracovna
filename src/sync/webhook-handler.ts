import { Webhook } from 'svix';
import type { SyncRepo } from '@/db/repo';
import type { ListingRow, WebhookEventRow } from '@/db/types';
import type { GuestyClient } from '@/guesty/client';
import type { Logger } from '@/guesty/log';
import { silentLogger } from '@/guesty/log';
import { bedsFromRooms, customFieldEntries, mapListing, mapReservation } from '@/guesty/mappers';
import { listingSchema } from '@/guesty/schemas';
import { reservationId } from '@/guesty/endpoints/reservations';
import { recomputeWindow } from './recompute';

export interface WebhookHeaders {
  'svix-id'?: string | null;
  'svix-timestamp'?: string | null;
  'svix-signature'?: string | null;
  [k: string]: string | null | undefined;
}

export interface ReceiveResult {
  status: 200 | 401 | 400;
  eventId: number | null;
  duplicate: boolean;
  reason?: string;
}

/** Svix headers may arrive under the white-label names. */
export function pickSvixHeaders(h: WebhookHeaders): { id: string | null; timestamp: string | null; signature: string | null } {
  const get = (a: string, b: string) => h[a] ?? h[b] ?? null;
  return {
    id: get('svix-id', 'webhook-id'),
    timestamp: get('svix-timestamp', 'webhook-timestamp'),
    signature: get('svix-signature', 'webhook-signature'),
  };
}

/** Verifies the Svix signature of the raw body; returns the parsed payload or null. */
export function verifyWebhook(rawBody: string, headers: WebhookHeaders, secret: string): unknown | null {
  const h = pickSvixHeaders(headers);
  if (!h.id || !h.timestamp || !h.signature) return null;
  try {
    const wh = new Webhook(secret);
    wh.verify(rawBody, { 'svix-id': h.id, 'svix-timestamp': h.timestamp, 'svix-signature': h.signature });
    return JSON.parse(rawBody) as unknown;
  } catch {
    return null;
  }
}

function pluck(o: unknown, path: string[]): unknown {
  let cur: unknown = o;
  for (const k of path) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

export function describePayload(payload: unknown): { event: string | null; eventId: string | null; objectId: string | null } {
  const event = typeof pluck(payload, ['event']) === 'string' ? (pluck(payload, ['event']) as string) : null;
  const eventId = typeof pluck(payload, ['meta', 'eventId']) === 'string' ? (pluck(payload, ['meta', 'eventId']) as string) : null;
  const candidates = [
    pluck(payload, ['data', 'reservationId']),
    pluck(payload, ['data', '_id']),
    pluck(payload, ['reservation', '_id']),
    pluck(payload, ['listing', '_id']),
    pluck(payload, ['data', 'listingId']),
  ];
  const objectId = (candidates.find((c) => typeof c === 'string' && c) as string | undefined) ?? null;
  return { event, eventId, objectId };
}

/**
 * Handles an incoming delivery: verify, store, acknowledge. Processing happens
 * afterwards (processWebhookEvent) so Guesty gets its 200 within seconds.
 */
export async function receiveWebhook(
  repo: SyncRepo,
  input: { rawBody: string; headers: WebhookHeaders; secret: string | null },
  log: Logger = silentLogger,
): Promise<ReceiveResult> {
  const h = pickSvixHeaders(input.headers);
  if (!input.secret) {
    await repo.insertWebhookEvent({ svix_id: null, event_id: null, event: null, object_id: null, status: 'rejected', payload: null, error: 'no secret configured' });
    return { status: 401, eventId: null, duplicate: false, reason: 'no_secret' };
  }
  const payload = verifyWebhook(input.rawBody, input.headers, input.secret);
  if (payload === null) {
    await repo.insertWebhookEvent({ svix_id: null, event_id: null, event: null, object_id: null, status: 'rejected', payload: null, error: 'invalid signature' });
    log.warn('webhook.rejected', { svix_id: h.id });
    return { status: 401, eventId: null, duplicate: false, reason: 'invalid_signature' };
  }
  const d = describePayload(payload);
  const ins = await repo.insertWebhookEvent({ svix_id: h.id, event_id: d.eventId, event: d.event, object_id: d.objectId, status: 'received', payload });
  await repo.setState('last_webhook_at', new Date().toISOString());
  log.info('webhook.received', { event: d.event, object_id: d.objectId, duplicate: ins.duplicate });
  return { status: 200, eventId: ins.id, duplicate: ins.duplicate };
}

export interface WebhookProcessDeps {
  repo: SyncRepo;
  client: GuestyClient;
  laundryFieldId: string;
  cleanerFieldId?: string | null;
  log?: Logger;
  now?: () => Date;
}

/**
 * Applies one stored delivery: reservation events re-fetch the reservation by
 * id (the payload is never trusted), listing events map the payload, and both
 * end with a recompute of the window.
 */
export async function processWebhookEvent(deps: WebhookProcessDeps, ev: WebhookEventRow): Promise<'processed' | 'ignored' | 'failed'> {
  const { repo, client } = deps;
  const log = (deps.log ?? silentLogger).child({ job: 'webhook', webhook_event_id: ev.id, event: ev.event });
  const now = deps.now ?? (() => new Date());
  const fetchedAt = now().toISOString();
  const finish = async (status: 'processed' | 'ignored' | 'failed', error?: string) => {
    await repo.updateWebhookEvent(ev.id, { status, error: error ?? null, processed_at: now().toISOString(), attempts: ev.attempts + 1 });
    return status;
  };
  try {
    const event = ev.event ?? '';
    if (event.startsWith('reservation.')) {
      const id = ev.object_id;
      if (!id) return finish('ignored', 'no reservation id');
      const fetched = await client.getReservationsByIds([id]);
      const raw = fetched.find((r) => reservationId(r) === id) ?? fetched[0];
      if (!raw) {
        log.warn('webhook.reservation_not_found', { id });
        return finish('ignored', 'reservation not returned by Guesty');
      }
      const row = mapReservation(raw, fetchedAt);
      if (!row) return finish('ignored', 'reservation without listing or dates');
      await repo.upsertReservations([row]);
      await recomputeWindow({ repo, log, now }, 'webhook');
      return finish('processed');
    }
    if (event.startsWith('listing.')) {
      const listingPayload = pluck(ev.payload, ['listing']);
      const id = ev.object_id ?? (typeof pluck(listingPayload, ['_id']) === 'string' ? (pluck(listingPayload, ['_id']) as string) : null);
      if (!id) return finish('ignored', 'no listing id');
      if (event === 'listing.removed') {
        const cur = await repo.getListing(id);
        if (cur) await repo.upsertListings([{ ...cur, active: false, in_scope: false, exclusion_reason: 'removed', fetched_at: fetchedAt }]);
        await recomputeWindow({ repo, log, now }, 'webhook');
        return finish('processed');
      }
      const parsed = listingSchema.safeParse(listingPayload);
      const raw = parsed.success ? parsed.data : await client.getListing(id);
      if (!raw) return finish('ignored', 'listing not available');
      const defs = await repo.getState<{ names: Record<string, string> }>('custom_field_defs');
      const spaces = Object.keys(bedsFromRooms(raw.listingRooms)).length ? null : await client.getSpaces(id);
      const customFieldValues = customFieldEntries(raw.customFields).length ? null : await client.getListingCustomFields(id);
      const row: ListingRow = mapListing(raw, {
        laundryFieldId: deps.laundryFieldId,
        cleanerFieldId: deps.cleanerFieldId,
        fieldNames: defs?.names ?? {},
        spaces,
        customFieldValues,
        fetchedAt,
      });
      await repo.upsertListings([row]);
      await recomputeWindow({ repo, log, now }, 'webhook');
      return finish('processed');
    }
    return finish('ignored', `unhandled event ${event}`);
  } catch (e) {
    log.error('webhook.process_failed', { error: String(e) });
    return finish('failed', e instanceof Error ? e.message : String(e));
  }
}
