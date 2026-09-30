import { Webhook } from 'svix';
import { describe, expect, it } from 'vitest';
import { LAUNDRY_FIELD_ID, windowDates } from '@/core/packing';
import { MemoryRepo } from '@/db/memory-repo';
import { silentLogger } from '@/guesty/log';
import { reconcile } from '@/sync/reconcile';
import { createSeedClient } from '@/sync/seed';
import { describePayload, processWebhookEvent, receiveWebhook, verifyWebhook } from '@/sync/webhook-handler';

const TODAY = '2026-10-05';
const SECRET = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw';
const at = (iso: string) => () => new Date(iso);

function sign(payload: unknown, secret = SECRET, id = 'msg_1') {
  const body = JSON.stringify(payload);
  const wh = new Webhook(secret);
  const timestamp = new Date();
  const signature = wh.sign(id, timestamp, body);
  return { rawBody: body, headers: { 'svix-id': id, 'svix-timestamp': String(Math.floor(timestamp.getTime() / 1000)), 'svix-signature': signature } };
}

describe('webhook receive', () => {
  it('accepts a correctly signed delivery and stores it once', async () => {
    const repo = new MemoryRepo();
    const payload = { event: 'reservation.updated.v2', data: { reservationId: 'r1', status: 'canceled' }, meta: { eventId: 'evt_1' } };
    const s = sign(payload);
    const r1 = await receiveWebhook(repo, { ...s, secret: SECRET });
    expect(r1).toMatchObject({ status: 200, duplicate: false });
    const r2 = await receiveWebhook(repo, { ...s, secret: SECRET });
    expect(r2).toMatchObject({ status: 200, duplicate: true, eventId: r1.eventId });
    expect(repo.webhookEvents).toHaveLength(1);
    expect(repo.webhookEvents[0]).toMatchObject({ event: 'reservation.updated.v2', object_id: 'r1', event_id: 'evt_1', status: 'received' });
    expect(await repo.getState('last_webhook_at')).toBeTruthy();
  });

  it('rejects a tampered body, a wrong secret, a stale timestamp and a missing secret', async () => {
    const repo = new MemoryRepo();
    const s = sign({ event: 'listing.updated', listing: { _id: 'l1' } });
    expect((await receiveWebhook(repo, { rawBody: s.rawBody.replace('l1', 'l2'), headers: s.headers, secret: SECRET })).status).toBe(401);
    expect((await receiveWebhook(repo, { ...s, secret: 'whsec_d3Jvbmctc2VjcmV0LXdyb25nLXNlY3JldA==' })).status).toBe(401);
    const stale = { ...s, headers: { ...s.headers, 'svix-timestamp': String(Math.floor(Date.now() / 1000) - 3600) } };
    expect((await receiveWebhook(repo, { ...stale, secret: SECRET })).status).toBe(401);
    expect((await receiveWebhook(repo, { ...s, secret: null })).status).toBe(401);
    expect(repo.webhookEvents.every((e) => e.status === 'rejected')).toBe(true);
    expect(verifyWebhook(s.rawBody, {}, SECRET)).toBeNull();
  });

  it('white-labeled webhook-* headers are accepted too', async () => {
    const repo = new MemoryRepo();
    const s = sign({ event: 'listing.new', listing: { _id: 'l1' } });
    const headers = { 'webhook-id': s.headers['svix-id'], 'webhook-timestamp': s.headers['svix-timestamp'], 'webhook-signature': s.headers['svix-signature'] };
    expect((await receiveWebhook(repo, { rawBody: s.rawBody, headers, secret: SECRET })).status).toBe(200);
  });

  it('describePayload finds the event, event id and object id in v2 and legacy shapes', () => {
    expect(describePayload({ event: 'reservation.created.v2', data: { reservationId: 'r9' }, meta: { eventId: 'e9' } })).toEqual({ event: 'reservation.created.v2', eventId: 'e9', objectId: 'r9' });
    expect(describePayload({ event: 'reservation.updated', reservation: { _id: 'r8' }, meta: { eventId: 'e8' } })).toEqual({ event: 'reservation.updated', eventId: 'e8', objectId: 'r8' });
    expect(describePayload({ event: 'listing.updated', listing: { _id: 'l1' }, meta: {} })).toEqual({ event: 'listing.updated', eventId: null, objectId: 'l1' });
    expect(describePayload('garbage')).toEqual({ event: null, eventId: null, objectId: null });
  });
});

describe('webhook processing', () => {
  async function seeded() {
    const repo = new MemoryRepo();
    repo.now = at(`${TODAY}T06:00:00+02:00`);
    const { client } = createSeedClient(TODAY);
    await reconcile({ repo, client, laundryFieldId: LAUNDRY_FIELD_ID, log: silentLogger, now: repo.now }, 'cron');
    return { repo, client };
  }

  it('a cancellation event re-fetches the reservation and cancels the package within the same call', async () => {
    const { repo, client } = await seeded();
    const p = (await repo.getPackagesInWindow(windowDates(TODAY)))[0];
    client.data.reservations.find((x) => x._id === p.outgoing_reservation_id)!.status = 'canceled';
    // the payload claims 'confirmed' – it must not be trusted
    const s = sign({ event: 'reservation.updated.v2', data: { reservationId: p.outgoing_reservation_id, status: 'confirmed' }, meta: { eventId: 'evt_c' } });
    const rec = await receiveWebhook(repo, { ...s, secret: SECRET });
    const ev = await repo.getWebhookEvent(rec.eventId!);
    const result = await processWebhookEvent({ repo, client, laundryFieldId: LAUNDRY_FIELD_ID, log: silentLogger, now: repo.now }, ev!);
    expect(result).toBe('processed');
    expect(repo.packages.get(p.id)!.status).toBe('cancelled');
    expect((await repo.getWebhookEvent(rec.eventId!))!.status).toBe('processed');
  });

  it('a new reservation event creates the package', async () => {
    const { repo, client } = await seeded();
    const before = (await repo.getPackagesInWindow(windowDates(TODAY))).length;
    const listing = (await repo.getListings()).find((l) => l.in_scope && !client.data.reservations.some((r) => r.listingId === l.guesty_id))!;
    client.data.reservations.push({
      _id: 'newres000000000000000001',
      status: 'confirmed',
      listingId: listing.guesty_id,
      checkInDateLocalized: '2026-10-03',
      checkOutDateLocalized: TODAY,
      guestsCount: 2,
      stay: [{ listingId: listing.guesty_id, checkInDateLocalized: '2026-10-03', checkOutDateLocalized: TODAY, guestsCount: 2 }],
    });
    const s = sign({ event: 'reservation.created.v2', data: { reservationId: 'newres000000000000000001' }, meta: { eventId: 'evt_n' } });
    const rec = await receiveWebhook(repo, { ...s, secret: SECRET });
    await processWebhookEvent({ repo, client, laundryFieldId: LAUNDRY_FIELD_ID, log: silentLogger, now: repo.now }, (await repo.getWebhookEvent(rec.eventId!))!);
    expect((await repo.getPackagesInWindow(windowDates(TODAY))).length).toBe(before + 1);
  });

  it('a listing.updated event with a changed laundry field recomputes the package', async () => {
    const { repo, client } = await seeded();
    const p = (await repo.getPackagesInWindow(windowDates(TODAY))).find((x) => !x.computed_items.private)!;
    const raw = client.data.listings.find((l) => l._id === p.listing_id)!;
    raw.customFields = [{ fieldId: LAUNDRY_FIELD_ID, value: 'Prádlo: súkromné\nKapsule: nedávať' }];
    const s = sign({ event: 'listing.updated', listing: raw, meta: { eventId: 'evt_l' } });
    const rec = await receiveWebhook(repo, { ...s, secret: SECRET });
    const result = await processWebhookEvent({ repo, client, laundryFieldId: LAUNDRY_FIELD_ID, log: silentLogger, now: repo.now }, (await repo.getWebhookEvent(rec.eventId!))!);
    expect(result).toBe('processed');
    const updated = repo.packages.get(p.id)!;
    expect(updated.computed_items.private).toBe(true);
    expect(updated.computed_items.capsules).toEqual([]);
    expect(repo.events.some((e) => e.event === 'recomputed' && e.package_id === p.id)).toBe(true);
  });

  it('listing.removed takes the listing out of scope and cancels its open package', async () => {
    const { repo, client } = await seeded();
    const p = (await repo.getPackagesInWindow(windowDates(TODAY)))[0];
    const s = sign({ event: 'listing.removed', listing: { _id: p.listing_id }, meta: { eventId: 'evt_r' } });
    const rec = await receiveWebhook(repo, { ...s, secret: SECRET });
    await processWebhookEvent({ repo, client, laundryFieldId: LAUNDRY_FIELD_ID, log: silentLogger, now: repo.now }, (await repo.getWebhookEvent(rec.eventId!))!);
    expect((await repo.getListing(p.listing_id))!.in_scope).toBe(false);
    expect(repo.packages.get(p.id)!.status).toBe('cancelled');
    expect(repo.packages.get(p.id)!.cancel_reason).toBe('listing_out_of_scope');
  });

  it('an event whose reservation Guesty no longer returns is marked ignored, an unknown event too', async () => {
    const { repo, client } = await seeded();
    const s = sign({ event: 'reservation.updated.v2', data: { reservationId: 'ghost' }, meta: { eventId: 'evt_g' } });
    const rec = await receiveWebhook(repo, { ...s, secret: SECRET });
    expect(await processWebhookEvent({ repo, client, laundryFieldId: LAUNDRY_FIELD_ID, log: silentLogger, now: repo.now }, (await repo.getWebhookEvent(rec.eventId!))!)).toBe('ignored');
    const s2 = sign({ event: 'guest.updated', data: {}, meta: { eventId: 'evt_x' } }, SECRET, 'msg_2');
    const rec2 = await receiveWebhook(repo, { ...s2, secret: SECRET });
    expect(await processWebhookEvent({ repo, client, laundryFieldId: LAUNDRY_FIELD_ID, log: silentLogger, now: repo.now }, (await repo.getWebhookEvent(rec2.eventId!))!)).toBe('ignored');
  });
});
