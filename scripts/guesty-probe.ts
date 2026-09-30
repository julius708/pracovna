/**
 * Day-1 probe: records what the Guesty Open API really returns, so the client
 * can be adjusted with evidence. Uses ONE token (cached in .probe-token.json,
 * git-ignored) and about 10 requests. Never prints secrets or guest data.
 *
 *   pnpm probe                      # shapes only
 *   pnpm probe -- --webhook-url URL # also lists webhooks and reads the secret keys
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnv, missingGuestyEnv } from '../src/env';
import { clientFromHttp } from '../src/guesty/client';
import { LISTING_FIELDS } from '../src/guesty/endpoints/listings';
import { GuestyHttp } from '../src/guesty/http';
import { createLogger } from '../src/guesty/log';
import { extractResults } from '../src/guesty/schemas';
import { createMinter, createTokenProvider, type TokenRecord, type TokenStore } from '../src/guesty/token';
import { todayInTz, addDays } from '../src/core/packing';

const TOKEN_FILE = resolve('.probe-token.json');
const NOTES = resolve('docs/guesty-notes.md');
const FIXTURES = resolve('src/guesty/fixtures/recorded');

function fileTokenStore(): TokenStore {
  const read = (): TokenRecord =>
    existsSync(TOKEN_FILE) ? (JSON.parse(readFileSync(TOKEN_FILE, 'utf8')) as TokenRecord) : { accessToken: null, expiresAt: null, mints: [], leaseUntil: null };
  const write = (r: TokenRecord) => writeFileSync(TOKEN_FILE, JSON.stringify(r, null, 2));
  return {
    async read() {
      return read();
    },
    async tryLease() {
      return true;
    },
    async releaseLease() {},
    async save(rec) {
      const r = read();
      write({ ...r, accessToken: rec.accessToken, expiresAt: rec.expiresAt, mints: [...r.mints, rec.mintedAt] });
    },
  };
}

/** Keys and value types of an object, values truncated; ids kept, free text shortened. */
function shape(v: unknown, depth = 0): unknown {
  if (Array.isArray(v)) return v.length ? [shape(v[0], depth + 1), `…${v.length} items`] : [];
  if (v && typeof v === 'object') {
    if (depth > 4) return '{…}';
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, shape(x, depth + 1)]));
  }
  if (typeof v === 'string') return v.length > 40 ? `${v.slice(0, 40)}…` : v;
  return v;
}

const SENSITIVE = new Set(['guestId', 'bookerId', 'guest', 'money', 'notes', 'conversationId', 'customFields']);
function redact(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(redact);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, SENSITIVE.has(k) ? '[redacted]' : redact(x)]));
  }
  return v;
}

async function main() {
  const env = loadEnv();
  const missing = missingGuestyEnv(env);
  if (missing.length) throw new Error(`Missing ${missing.join(', ')} in .env.local`);
  const args = process.argv.slice(2);
  const webhookUrl = args.includes('--webhook-url') ? args[args.indexOf('--webhook-url') + 1] : null;
  const log = createLogger({ level: 'info' });
  const token = createTokenProvider({
    store: fileTokenStore(),
    minter: createMinter({ clientId: env.GUESTY_CLIENT_ID!, clientSecret: env.GUESTY_CLIENT_SECRET! }),
    log,
    maxMintsPer24h: 1,
  });
  const http = new GuestyHttp(token, { log });
  const client = clientFromHttp(http, env.GUESTY_ACCOUNT_ID);
  mkdirSync(FIXTURES, { recursive: true });
  const notes: string[] = [`# Guesty Open API – recorded shapes`, ``, `Probe run: ${new Date().toISOString()}`, ``];
  const record = (name: string, json: unknown) => {
    writeFileSync(resolve(FIXTURES, `${name}.json`), JSON.stringify(redact(json), null, 2));
    notes.push(`## ${name}`, '', '```json', JSON.stringify(shape(json), null, 2), '```', '');
  };

  // listings, both with and without the active/listed filters
  const page = await http.get('/listings', { fields: LISTING_FIELDS, limit: 5, skip: 0, sort: '_id' });
  record('listings-page', page);
  const first = extractResults(page)[0] as { _id?: string } | undefined;
  const countAll = await http.get<Record<string, unknown>>('/listings', { fields: '_id', limit: 1 });
  const countActive = await http.get<Record<string, unknown>>('/listings', { fields: '_id', limit: 1, active: true, listed: true });
  notes.push(`## listing counts`, '', `- no filter: count=${String(countAll?.count)}`, `- active=true&listed=true: count=${String(countActive?.count)}`, '');
  if (first?._id) {
    record('listing-detail', await http.get(`/listings/${first._id}`, { fields: LISTING_FIELDS }));
    record('spaces', await http.get(`/properties/spaces/unit-type/${first._id}`).catch((e) => ({ error: String(e) })));
    record('property-custom-fields', await http.get(`/properties-api/custom-fields/${first._id}`).catch((e) => ({ error: String(e) })));
  }
  record('custom-field-defs', await http.get(`/accounts/${env.GUESTY_ACCOUNT_ID}/custom-fields`).catch((e) => ({ error: String(e) })));

  // reservations v3 search and by ids
  const today = todayInTz(new Date());
  const search = await http.get('/reservations-v3/search', {
    'filter[checkOut][gte]': today,
    'filter[checkOut][lte]': addDays(today, 2),
    'filter[status]': 'confirmed',
    sort: 'checkOut',
    limit: 5,
  });
  record('reservations-search', search);
  const r0 = extractResults(search)[0] as { _id?: string; reservationId?: string } | undefined;
  const rid = r0?._id ?? r0?.reservationId;
  if (rid) record('reservations-by-ids', await http.get('/reservations-v3', { reservationIds: [rid] }));
  const byListing = first?._id
    ? await http.get('/reservations-v3/search', { 'filter[listingId]': [first._id], 'filter[checkIn][gte]': today, 'filter[status]': 'confirmed', sort: 'checkIn', limit: 3 }).catch((e) => ({ error: String(e) }))
    : null;
  record('reservations-by-listing', byListing);

  // calendar batch
  const ids = (extractResults(page) as { _id: string }[]).slice(0, 2).map((l) => l._id);
  record('calendar-batch', await http.get('/availability-pricing/api/calendar/listings', { listingIds: ids, startDate: today, endDate: addDays(today, 3) }).catch((e) => ({ error: String(e) })));

  if (webhookUrl) {
    record('webhooks', await client.listWebhooks());
    const secret = await client.getWebhookSecret(webhookUrl).catch((e) => ({ secret: null, responseKeys: [String(e)] }));
    notes.push(`## webhook secret`, '', `- found: ${secret.secret ? 'yes' : 'no'}`, `- response keys: ${secret.responseKeys.join(', ')}`, '');
  }

  notes.push(`Requests sent: ${http.calls}`);
  writeFileSync(NOTES, notes.join('\n'));
  console.log(`Wrote ${NOTES} and fixtures to ${FIXTURES} (${http.calls} requests).`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
