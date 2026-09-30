/**
 * Black-box tests of the Guesty client layer (step 3).
 *
 * Binding rules (PROPOSAL §5 "Token" / "Rate limits", research_auth.txt,
 * research_resv.txt, research_listings.txt, research_hooks.txt):
 *  - token: form-encoded client-credentials grant, 24 h lifetime, reuse until
 *    30 min before expiry, single-flight lease shared by all instances, at most
 *    3 server mints per 24 h with a warning at the 3rd, one reactive refresh on
 *    401 at most once per 10 min
 *  - http: one request at a time, Authorization: Bearer + accept json,
 *    429 -> sleep Retry-After (cap 30 s, else give up), 5xx -> retry after 1 s
 *    and 3 s, 401 -> one token refresh then retry
 *  - endpoints: listings envelope {results,count,limit,skip} OR bare array,
 *    v3 search {results, pagination:{hasMore}}, reservationIds <= 10 per call,
 *    calendar batch -> per-listing fallback, webhook secret field undocumented
 *
 * Nothing here waits for real: fetch, now() and sleep() are injected.
 */
import { describe, expect, it } from 'vitest';
import { silentLogger } from '@/guesty/log';
import { GUESTY_BASE_URL, GuestyApiError, GuestyHttp } from '@/guesty/http';
import {
  MAX_SERVER_MINTS_PER_24H,
  REFRESH_BEFORE_MS,
  TOKEN_URL,
  TokenQuotaError,
  createMemoryTokenStore,
  createMinter,
  createTokenProvider,
  type TokenMinter,
} from '@/guesty/token';
import { extractHasMore, extractResults, listingSchema, parseMany, tokenResponseSchema } from '@/guesty/schemas';
import {
  LISTING_FIELDS,
  getAccountCustomFieldDefs,
  getListing,
  getListingCustomFields,
  getUnitTypeSpaces,
  listAllListings,
} from '@/guesty/endpoints/listings';
import { getReservationsByIds, reservationId, searchReservations } from '@/guesty/endpoints/reservations';
import { extractCalendarDays, getCalendarDays } from '@/guesty/endpoints/calendar';
import { createWebhook, deleteWebhook, getWebhookSecret, listWebhooks } from '@/guesty/endpoints/webhooks';

// ---------------------------------------------------------------- helpers

const T0 = Date.parse('2026-10-05T10:00:00.000Z');
const MIN = 60_000;
const H = 60 * MIN;

function makeClock(start = T0) {
  const c = {
    t: start,
    now: () => new Date(c.t),
    iso: (offsetMs = 0) => new Date(c.t + offsetMs).toISOString(),
  };
  return c;
}

/** Yields to the macrotask queue so pending promises settle. */
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

/** Injected sleep: records the requested ms, advances the fake clock, yields once. */
function makeSleep(clock?: ReturnType<typeof makeClock>) {
  const sleeps: number[] = [];
  const sleep = async (ms: number) => {
    sleeps.push(ms);
    if (clock) clock.t += ms;
    await tick();
  };
  return { sleeps, sleep };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

type Handler = (url: URL, init: RequestInit, n: number) => Response | Promise<Response>;

function fakeFetch(handler: Handler) {
  const calls: { url: URL; init: RequestInit; headers: Headers; body: string | null }[] = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href);
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    let body: string | null = null;
    if (init?.body != null) body = typeof init.body === 'string' ? init.body : String(init.body);
    else if (input instanceof Request && input.body) body = await input.clone().text();
    calls.push({ url, init: init ?? {}, headers, body });
    return handler(url, init ?? {}, calls.length);
  }) as typeof fetch;
  return { fn, calls };
}

/** Returns the n-th response factory, repeating the last one. */
const sequence =
  (...factories: (() => Response)[]): Handler =>
  (_u, _i, n) =>
    factories[Math.min(n - 1, factories.length - 1)]();

function fakeMinter(tokens = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6'], expiresInSeconds = 86_400) {
  const calls: number[] = [];
  const minter: TokenMinter = {
    async mint() {
      calls.push(calls.length + 1);
      return { accessToken: tokens[Math.min(calls.length - 1, tokens.length - 1)], expiresInSeconds };
    },
  };
  return { minter, calls };
}

function staticToken(tok = 'tok') {
  const calls: { forceRefresh?: boolean }[] = [];
  const provider = async (o?: { forceRefresh?: boolean }) => {
    calls.push(o ?? {});
    return tok;
  };
  return { provider, calls };
}

function httpWith(handler: Handler, tokenProvider?: (o?: { forceRefresh?: boolean }) => Promise<string>) {
  const ff = fakeFetch(handler);
  const { sleeps, sleep } = makeSleep();
  const http = new GuestyHttp(tokenProvider ?? staticToken().provider, { fetch: ff.fn, sleep, log: silentLogger });
  return { http, calls: ff.calls, sleeps };
}

const param = (u: URL, key: string) => u.searchParams.get(key);

// ---------------------------------------------------------------- token provider

describe('token provider: reuse and expiry threshold', () => {
  it('reuses a cached token that still has 31 minutes left (no mint)', async () => {
    const clock = makeClock();
    const store = createMemoryTokenStore({ accessToken: 'CACHED', expiresAt: clock.iso(31 * MIN), mints: [clock.iso(-20 * H)] });
    const { minter, calls } = fakeMinter();
    const token = createTokenProvider({ store, minter, now: clock.now, sleep: makeSleep(clock).sleep, log: silentLogger });
    expect(await token()).toBe('CACHED');
    expect(calls).toHaveLength(0);
    expect(REFRESH_BEFORE_MS).toBe(30 * MIN);
  });

  it('mints when the cached token has only 29 minutes left, saves expiry = now + expires_in and releases the lease', async () => {
    const clock = makeClock();
    const store = createMemoryTokenStore({ accessToken: 'CACHED', expiresAt: clock.iso(29 * MIN), mints: [] });
    const { minter, calls } = fakeMinter(['FRESH'], 86_400);
    const token = createTokenProvider({ store, minter, now: clock.now, sleep: makeSleep(clock).sleep, log: silentLogger });
    expect(await token()).toBe('FRESH');
    expect(calls).toHaveLength(1);
    expect(store.record.accessToken).toBe('FRESH');
    expect(Date.parse(store.record.expiresAt!)).toBe(clock.t + 86_400_000);
    expect(store.record.mints).toHaveLength(1);
    expect(Date.parse(store.record.mints[0])).toBe(clock.t);
    // lease must not stay held after the mint finished
    expect(store.record.leaseUntil == null || Date.parse(store.record.leaseUntil) <= clock.t).toBe(true);
  });

  it('mints on an empty store and on an expired token', async () => {
    const clock = makeClock();
    const empty = createMemoryTokenStore();
    const m1 = fakeMinter(['A']);
    const t1 = createTokenProvider({ store: empty, minter: m1.minter, now: clock.now, sleep: makeSleep(clock).sleep, log: silentLogger });
    expect(await t1()).toBe('A');
    expect(m1.calls).toHaveLength(1);

    const expired = createMemoryTokenStore({ accessToken: 'OLD', expiresAt: clock.iso(-1), mints: [] });
    const m2 = fakeMinter(['B']);
    const t2 = createTokenProvider({ store: expired, minter: m2.minter, now: clock.now, sleep: makeSleep(clock).sleep, log: silentLogger });
    expect(await t2()).toBe('B');
    expect(m2.calls).toHaveLength(1);
  });
});

describe('token provider: single-flight lease', () => {
  it('two concurrent callers of one provider produce exactly one mint and share the token', async () => {
    const clock = makeClock();
    const store = createMemoryTokenStore();
    const gate = deferred<void>();
    let mints = 0;
    const minter: TokenMinter = {
      async mint() {
        mints += 1;
        await gate.promise;
        return { accessToken: 'ONE', expiresInSeconds: 86_400 };
      },
    };
    const token = createTokenProvider({ store, minter, now: clock.now, sleep: makeSleep(clock).sleep, log: silentLogger });
    const p1 = token();
    const p2 = token();
    await tick();
    await tick();
    expect(mints).toBe(1);
    gate.resolve();
    expect(await Promise.all([p1, p2])).toEqual(['ONE', 'ONE']);
    expect(mints).toBe(1);
  });

  it('two server instances sharing one store: the second waits for the lease holder and reuses its token', async () => {
    const clock = makeClock();
    const store = createMemoryTokenStore();
    const gate = deferred<void>();
    let mintsA = 0;
    const minterA: TokenMinter = {
      async mint() {
        mintsA += 1;
        await gate.promise;
        return { accessToken: 'FROM_A', expiresInSeconds: 86_400 };
      },
    };
    const mB = fakeMinter(['FROM_B']);
    const sA = makeSleep(clock);
    const sB = makeSleep(clock);
    const A = createTokenProvider({ store, minter: minterA, now: clock.now, sleep: sA.sleep, log: silentLogger });
    const B = createTokenProvider({ store, minter: mB.minter, now: clock.now, sleep: sB.sleep, log: silentLogger });
    const pa = A();
    await tick(); // A takes the lease and is now inside mint()
    const pb = B();
    await tick();
    await tick();
    expect(mintsA).toBe(1);
    expect(mB.calls).toHaveLength(0);
    gate.resolve();
    expect(await Promise.all([pa, pb])).toEqual(['FROM_A', 'FROM_A']);
    expect(mB.calls).toHaveLength(0);
    expect(sB.sleeps.length).toBeGreaterThan(0); // B had to wait
    expect(store.record.mints).toHaveLength(1);
  });

  it('memory store: tryLease is exclusive while held and free again once expired or released', async () => {
    const clock = makeClock();
    const store = createMemoryTokenStore();
    expect(await store.tryLease(clock.iso(30_000), clock.iso())).toBe(true);
    expect(await store.tryLease(clock.iso(30_000), clock.iso())).toBe(false);
    // a stale lease from a crashed instance is taken over after it expires
    expect(await store.tryLease(clock.iso(60_000), clock.iso(31_000))).toBe(true);
    await store.releaseLease();
    expect(await store.tryLease(clock.iso(30_000), clock.iso())).toBe(true);
  });

  it('a failed mint propagates the error and does not leave the lease stuck', async () => {
    const clock = makeClock();
    const store = createMemoryTokenStore();
    let fail = true;
    const minter: TokenMinter = {
      async mint() {
        if (fail) throw new Error('network down');
        return { accessToken: 'LATER', expiresInSeconds: 86_400 };
      },
    };
    const { sleep, sleeps } = makeSleep(clock);
    const token = createTokenProvider({ store, minter, now: clock.now, sleep, log: silentLogger });
    await expect(token()).rejects.toThrow(/network down/);
    fail = false;
    expect(await token()).toBe('LATER');
    // the retry did not have to wait out a stuck lease (memory store lease is released)
    expect(sleeps.reduce((a, b) => a + b, 0)).toBeLessThan(5_000);
  });
});

describe('token provider: 3 mints per 24 h', () => {
  function forceExpiry(store: ReturnType<typeof createMemoryTokenStore>, clock: ReturnType<typeof makeClock>) {
    store.record.expiresAt = clock.iso(-1);
  }

  it('warns at the 3rd mint; a 4th call with a valid token reuses it; with an expired token it throws TokenQuotaError; the window rolls', async () => {
    const clock = makeClock();
    const store = createMemoryTokenStore();
    const { minter, calls } = fakeMinter(['M1', 'M2', 'M3', 'M4']);
    const warnings: number[] = [];
    const token = createTokenProvider({
      store,
      minter,
      now: clock.now,
      sleep: makeSleep(clock).sleep,
      log: silentLogger,
      onQuotaWarning: (n) => warnings.push(n),
    });
    expect(MAX_SERVER_MINTS_PER_24H).toBe(3);

    expect(await token()).toBe('M1'); // mint 1 at T0
    clock.t += 1 * H;
    forceExpiry(store, clock);
    expect(await token()).toBe('M2'); // mint 2 at T0+1h
    expect(warnings).toEqual([]);
    clock.t += 1 * H;
    forceExpiry(store, clock);
    expect(await token()).toBe('M3'); // mint 3 at T0+2h -> warning
    expect(warnings).toEqual([3]);
    expect(calls).toHaveLength(3);

    // 4th request while M3 is still valid -> reuse, no mint, no error
    clock.t += 1 * H;
    expect(await token()).toBe('M3');
    expect(calls).toHaveLength(3);

    // 4th request with an expired token -> hard cap
    forceExpiry(store, clock);
    let err: unknown;
    try {
      await token();
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(TokenQuotaError);
    expect(Date.parse((err as TokenQuotaError).nextPossibleAt)).toBe(T0 + 24 * H); // oldest mint + 24 h
    expect(calls).toHaveLength(3);

    // once the oldest mint leaves the 24 h window a mint is possible again
    clock.t = T0 + 24 * H + 1_000;
    forceExpiry(store, clock);
    expect(await token()).toBe('M4');
    expect(calls).toHaveLength(4);
  });

  it('mints older than 24 h do not count against the cap', async () => {
    const clock = makeClock();
    const store = createMemoryTokenStore({
      accessToken: 'OLD',
      expiresAt: clock.iso(-1),
      mints: [clock.iso(-25 * H), clock.iso(-2 * H), clock.iso(-1 * H)],
    });
    const { minter, calls } = fakeMinter(['NEW']);
    const warnings: number[] = [];
    const token = createTokenProvider({ store, minter, now: clock.now, sleep: makeSleep(clock).sleep, log: silentLogger, onQuotaWarning: (n) => warnings.push(n) });
    expect(await token()).toBe('NEW'); // only 2 mints in window -> allowed, this is the 3rd
    expect(calls).toHaveLength(1);
    expect(warnings).toEqual([3]);
    // now 3 in window: an expired token cannot be re-minted before (T0-2h)+24h
    store.record.expiresAt = clock.iso(-1);
    let err: unknown;
    try {
      await token();
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(TokenQuotaError);
    expect(Date.parse((err as TokenQuotaError).nextPossibleAt)).toBe(clock.t - 2 * H + 24 * H);
    expect(calls).toHaveLength(1);
  });
});

describe('token provider: reactive refresh (401)', () => {
  it('forceRefresh mints once even though the token is valid, ignores a second forceRefresh within 10 min, and mints again after 10 min', async () => {
    const clock = makeClock();
    const store = createMemoryTokenStore({ accessToken: 'VALID', expiresAt: clock.iso(20 * H), mints: [clock.iso(-5 * H)] });
    const { minter, calls } = fakeMinter(['R1', 'R2']);
    const token = createTokenProvider({ store, minter, now: clock.now, sleep: makeSleep(clock).sleep, log: silentLogger });

    expect(await token({ forceRefresh: true })).toBe('R1');
    expect(calls).toHaveLength(1);

    clock.t += 5 * MIN;
    const again = await token({ forceRefresh: true });
    expect(calls).toHaveLength(1); // at most one reactive refresh per 10 min
    expect(again).toBe('R1'); // falls back to the cached token

    clock.t += 6 * MIN; // 11 min after the refresh
    expect(await token({ forceRefresh: true })).toBe('R2');
    expect(calls).toHaveLength(2);
  });

  it('a forced refresh that finds the lease held by another instance waits for the NEW token instead of returning the one that just got a 401', async () => {
    // impl_bug (low, cross-instance race): token.ts waiter returns as soon as the stored token is
    // "fresh" (line 127) - in the force path the stored token is the stale one that caused the 401.
    const clock = makeClock();
    const store = createMemoryTokenStore({ accessToken: 'STALE', expiresAt: clock.iso(20 * H), mints: [clock.iso(-5 * H)] });
    const gate = deferred<void>();
    const minterA: TokenMinter = {
      async mint() {
        await gate.promise;
        return { accessToken: 'FRESH_A', expiresInSeconds: 86_400 };
      },
    };
    const mB = fakeMinter(['FRESH_B']);
    const A = createTokenProvider({ store, minter: minterA, now: clock.now, sleep: makeSleep(clock).sleep, log: silentLogger });
    const B = createTokenProvider({ store, minter: mB.minter, now: clock.now, sleep: makeSleep(clock).sleep, log: silentLogger });
    const pa = A({ forceRefresh: true });
    await tick(); // A holds the lease and is inside mint()
    const pb = B({ forceRefresh: true });
    await tick();
    await tick();
    await tick();
    gate.resolve();
    expect(await pa).toBe('FRESH_A');
    expect(await pb).toBe('FRESH_A');
    expect(mB.calls).toHaveLength(0);
  });

  it('a plain call right after a forced refresh reuses the refreshed token', async () => {
    const clock = makeClock();
    const store = createMemoryTokenStore({ accessToken: 'VALID', expiresAt: clock.iso(20 * H), mints: [] });
    const { minter, calls } = fakeMinter(['R1']);
    const token = createTokenProvider({ store, minter, now: clock.now, sleep: makeSleep(clock).sleep, log: silentLogger });
    expect(await token({ forceRefresh: true })).toBe('R1');
    expect(await token()).toBe('R1');
    expect(calls).toHaveLength(1);
  });
});

describe('createMinter', () => {
  it('POSTs a form-encoded client-credentials grant with scope open-api and parses the token response', async () => {
    const ff = fakeFetch(() => json({ token_type: 'Bearer', expires_in: 86400, access_token: 'jwt.token.here', scope: 'open-api' }));
    const minter = createMinter({ clientId: 'cid-123', clientSecret: 'sekret-xyz' }, ff.fn);
    const r = await minter.mint();
    expect(r).toEqual({ accessToken: 'jwt.token.here', expiresInSeconds: 86400 });
    expect(ff.calls).toHaveLength(1);
    const c = ff.calls[0];
    expect(c.url.href).toBe(TOKEN_URL);
    expect((c.init.method ?? 'GET').toUpperCase()).toBe('POST');
    expect(c.headers.get('content-type')).toMatch(/application\/x-www-form-urlencoded/);
    expect(c.headers.get('accept')).toMatch(/application\/json/);
    const body = new URLSearchParams(c.body ?? '');
    expect(body.get('grant_type')).toBe('client_credentials');
    expect(body.get('scope')).toBe('open-api');
    expect(body.get('client_id')).toBe('cid-123');
    expect(body.get('client_secret')).toBe('sekret-xyz');
  });

  it('rejects on a non-2xx answer without leaking the client secret into the error', async () => {
    const ff = fakeFetch(() => json({ error: 'invalid_client' }, 401));
    const minter = createMinter({ clientId: 'cid-123', clientSecret: 'sekret-xyz' }, ff.fn);
    let err: unknown;
    try {
      await minter.mint();
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Error);
    expect(String((err as Error).message)).not.toContain('sekret-xyz');
  });

  it('rejects when the token response has no access_token', async () => {
    const ff = fakeFetch(() => json({ token_type: 'Bearer' }));
    const minter = createMinter({ clientId: 'c', clientSecret: 's' }, ff.fn);
    await expect(minter.mint()).rejects.toThrow();
  });
});

// ---------------------------------------------------------------- GuestyHttp

describe('GuestyHttp: request shape', () => {
  it('sends Authorization: Bearer and accept: application/json, builds the query, drops null/undefined, comma-joins arrays', async () => {
    const tp = staticToken('abc.def');
    const { http, calls } = httpWith(() => json({ ok: true }), tp.provider);
    const r = await http.get<{ ok: boolean }>('/listings', { limit: 100, skip: 0, fields: 'a b', active: true, nothing: undefined, nil: null, ids: ['x', 'y'] });
    expect(r).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    const c = calls[0];
    expect(c.url.href.startsWith(`${GUESTY_BASE_URL}/listings?`)).toBe(true);
    expect(c.headers.get('authorization')).toBe('Bearer abc.def');
    expect(c.headers.get('accept')).toMatch(/application\/json/);
    expect(param(c.url, 'limit')).toBe('100');
    expect(param(c.url, 'skip')).toBe('0');
    expect(param(c.url, 'fields')).toBe('a b');
    expect(param(c.url, 'active')).toBe('true');
    expect(c.url.searchParams.has('nothing')).toBe(false);
    expect(c.url.searchParams.has('nil')).toBe(false);
    expect(param(c.url, 'ids')).toBe('x,y');
    expect(tp.calls[0]?.forceRefresh ?? false).toBe(false);
    expect(http.calls).toBe(1);
  });

  it('post sends a JSON body and delete tolerates a 204 without body', async () => {
    const { http, calls } = httpWith((u) => (u.pathname.endsWith('/webhooks') ? json({ _id: 'w1' }, 201) : new Response(null, { status: 204 })));
    const created = await http.post<{ _id: string }>('/webhooks', { url: 'https://x.example/hook', events: ['listing.new'] });
    expect(created).toEqual({ _id: 'w1' });
    expect((calls[0].init.method ?? '').toUpperCase()).toBe('POST');
    expect(calls[0].headers.get('content-type')).toMatch(/application\/json/);
    expect(JSON.parse(calls[0].body ?? '{}')).toEqual({ url: 'https://x.example/hook', events: ['listing.new'] });
    await expect(http.delete('/webhooks/w1')).resolves.not.toThrow();
    expect((calls[1].init.method ?? '').toUpperCase()).toBe('DELETE');
  });
});

describe('GuestyHttp: backoff', () => {
  it('429 with Retry-After: 5 -> sleeps 5 s once, retries, succeeds (2 requests)', async () => {
    const { http, calls, sleeps } = httpWith(sequence(() => json({ message: 'slow down' }, 429, { 'retry-after': '5' }), () => json({ done: 1 })));
    expect(await http.get('/reservations-v3/search')).toEqual({ done: 1 });
    expect(calls).toHaveLength(2);
    expect(sleeps).toEqual([5_000]);
    expect(http.calls).toBe(2);
  });

  it('429 with Retry-After: 30 is still honoured (cap is inclusive)', async () => {
    const { http, calls, sleeps } = httpWith(sequence(() => json({}, 429, { 'retry-after': '30' }), () => json({ done: 1 })));
    expect(await http.get('/x')).toEqual({ done: 1 });
    expect(calls).toHaveLength(2);
    expect(sleeps).toEqual([30_000]);
  });

  it('429 with Retry-After: 60 -> gives up with a GuestyApiError(429) carrying retryAfterSeconds, no 60 s sleep', async () => {
    const { http, calls, sleeps } = httpWith(sequence(() => json({ message: 'nope' }, 429, { 'retry-after': '60' }), () => json({ done: 1 })));
    let err: unknown;
    try {
      await http.get('/x');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(GuestyApiError);
    expect((err as GuestyApiError).status).toBe(429);
    expect((err as GuestyApiError).retryAfterSeconds).toBe(60);
    expect(calls).toHaveLength(1);
    expect(sleeps.every((ms) => ms < 60_000)).toBe(true);
  });

  it('three 5xx in a row -> error after retries at 1 s and 3 s (3 requests total)', async () => {
    const { http, calls, sleeps } = httpWith(sequence(() => json({ e: 1 }, 502), () => json({ e: 2 }, 503), () => json({ e: 3 }, 500), () => json({ done: 1 })));
    let err: unknown;
    try {
      await http.get('/x');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(GuestyApiError);
    expect((err as GuestyApiError).status).toBe(500);
    expect(calls).toHaveLength(3);
    expect(sleeps).toEqual([1_000, 3_000]);
  });

  it('5xx, 5xx, 200 -> succeeds on the third request and counts every request', async () => {
    const { http, calls, sleeps } = httpWith(sequence(() => json({}, 500), () => json({}, 500), () => json({ done: 1 })));
    expect(await http.get('/x')).toEqual({ done: 1 });
    expect(calls).toHaveLength(3);
    expect(sleeps).toEqual([1_000, 3_000]);
    expect(http.calls).toBe(3);
  });

  it('401 -> token refresh (forceRefresh) -> retry with the new token -> success', async () => {
    // The provider is stateful like the real one: a forced refresh replaces the cached token.
    const tokenCalls: { forceRefresh?: boolean }[] = [];
    let current = 'OLD';
    const provider = async (o?: { forceRefresh?: boolean }) => {
      tokenCalls.push(o ?? {});
      if (o?.forceRefresh) current = 'NEW';
      return current;
    };
    const { http, calls } = httpWith((_u, _i, n) => (n === 1 ? json({ message: 'Unauthorized' }, 401) : json({ done: 1 })), provider);
    expect(await http.get('/x')).toEqual({ done: 1 });
    expect(calls).toHaveLength(2);
    expect(calls[0].headers.get('authorization')).toBe('Bearer OLD');
    expect(calls[1].headers.get('authorization')).toBe('Bearer NEW');
    expect(tokenCalls.filter((c) => c.forceRefresh)).toHaveLength(1);
  });

  it('401 twice -> GuestyApiError(401) after exactly one refresh and two requests', async () => {
    const tokenCalls: { forceRefresh?: boolean }[] = [];
    const provider = async (o?: { forceRefresh?: boolean }) => {
      tokenCalls.push(o ?? {});
      return 'T';
    };
    const { http, calls } = httpWith(() => json({ message: 'Unauthorized' }, 401), provider);
    let err: unknown;
    try {
      await http.get('/x');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(GuestyApiError);
    expect((err as GuestyApiError).status).toBe(401);
    expect(calls).toHaveLength(2);
    expect(tokenCalls.filter((c) => c.forceRefresh)).toHaveLength(1);
  });

  it('other 4xx (400, 404, 422) are not retried and surface status, path and parsed body', async () => {
    for (const status of [400, 404, 422]) {
      const { http, calls, sleeps } = httpWith(() => json({ message: `err ${status}` }, status));
      let err: unknown;
      try {
        await http.get('/listings/nope');
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(GuestyApiError);
      expect((err as GuestyApiError).status).toBe(status);
      expect((err as GuestyApiError).path).toContain('/listings/nope');
      expect((err as GuestyApiError).body).toEqual({ message: `err ${status}` });
      expect(calls).toHaveLength(1);
      expect(sleeps).toEqual([]);
    }
  });
});

describe('GuestyHttp: serialization', () => {
  it('runs one request at a time: the second request starts only after the first one finished', async () => {
    const gate = deferred<void>();
    const order: string[] = [];
    const ff = fakeFetch(async (u) => {
      order.push(`start ${u.pathname}`);
      if (u.pathname.endsWith('/a')) await gate.promise;
      order.push(`end ${u.pathname}`);
      return json({ p: u.pathname });
    });
    const http = new GuestyHttp(staticToken().provider, { fetch: ff.fn, sleep: makeSleep().sleep, log: silentLogger });
    const pa = http.get('/a');
    const pb = http.get('/b');
    const pc = http.get('/c');
    await tick();
    await tick();
    expect(order).toEqual(['start /v1/a']);
    gate.resolve();
    await Promise.all([pa, pb, pc]);
    expect(order).toEqual(['start /v1/a', 'end /v1/a', 'start /v1/b', 'end /v1/b', 'start /v1/c', 'end /v1/c']);
  });

  it('a failing request does not block the queue for the next one', async () => {
    const { http } = httpWith((u) => (u.pathname.endsWith('/bad') ? json({}, 400) : json({ ok: 1 })));
    const bad = http.get('/bad');
    const good = http.get('/good');
    await expect(bad).rejects.toBeInstanceOf(GuestyApiError);
    expect(await good).toEqual({ ok: 1 });
  });
});

// ---------------------------------------------------------------- schemas

describe('schemas helpers', () => {
  it('extractResults finds the item array in every documented envelope', () => {
    expect(extractResults({ results: [1, 2], count: 2, limit: 100, skip: 0 })).toEqual([1, 2]);
    expect(extractResults([1, 2])).toEqual([1, 2]);
    expect(extractResults({ data: { results: [3] } })).toEqual([3]);
    expect(extractResults({ data: [4] })).toEqual([4]);
    expect(extractResults({})).toEqual([]);
    expect(extractResults(null)).toEqual([]);
    expect(extractResults('x')).toEqual([]);
    expect(extractResults({ results: 'not-an-array' })).toEqual([]);
  });

  it('extractHasMore trusts pagination.hasMore and falls back to counting', () => {
    expect(extractHasMore({ results: [], pagination: { skip: 0, limit: 100, hasMore: true } }, 0, 100)).toBe(true);
    expect(extractHasMore({ results: [], pagination: { skip: 0, limit: 100, hasMore: false } }, 100, 100)).toBe(false);
    expect(extractHasMore({ results: [] }, 100, 100)).toBe(true);
    expect(extractHasMore({ results: [] }, 30, 100)).toBe(false);
    expect(extractHasMore([], 0, 100)).toBe(false);
  });

  it('parseMany skips the items that do not fit, reports them, and coerces numeric strings', () => {
    const bad: unknown[] = [];
    const out = parseMany(listingSchema, [{ _id: 'a', accommodates: '4' }, { nope: 1 }, { _id: 'b', bathrooms: 1.5 }], (_issue, item) => bad.push(item));
    expect(out.map((l) => l._id)).toEqual(['a', 'b']);
    expect(out[0].accommodates).toBe(4);
    expect(out[1].bathrooms).toBe(1.5);
    expect(bad).toEqual([{ nope: 1 }]);
    expect(tokenResponseSchema.parse({ access_token: 'x', expires_in: '86400' }).expires_in).toBe(86400);
  });
});

// ---------------------------------------------------------------- listings

function listingPage(from: number, n: number) {
  return Array.from({ length: n }, (_, i) => ({ _id: `L${from + i}`, nickname: `Flat ${from + i}`, active: true }));
}

describe('listings endpoint', () => {
  it('listAllListings pages the {results,count,limit,skip} envelope with limit=100&skip and the field list', async () => {
    const { http, calls } = httpWith((u) => {
      const skip = Number(param(u, 'skip') ?? 0);
      const items = skip === 0 ? listingPage(0, 100) : skip === 100 ? listingPage(100, 50) : [];
      return json({ results: items, count: 150, limit: 100, skip });
    });
    const all = await listAllListings(http);
    expect(all).toHaveLength(150);
    expect(new Set(all.map((l) => l._id)).size).toBe(150);
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(calls.length).toBeLessThanOrEqual(3);
    expect(calls.every((c) => c.url.pathname.endsWith('/listings'))).toBe(true);
    expect(param(calls[0].url, 'limit')).toBe('100');
    expect(param(calls[0].url, 'skip')).toBe('0');
    expect(param(calls[1].url, 'skip')).toBe('100');
    expect(param(calls[0].url, 'fields')).toBe(LISTING_FIELDS);
    expect(LISTING_FIELDS.split(' ')).toEqual(expect.arrayContaining(['_id', 'nickname', 'active', 'address.city', 'accommodates', 'bathrooms', 'customFields', 'listingRooms', 'tags']));
  });

  it('listAllListings accepts a bare array envelope: 100 + 30 stops after 2 calls, 100 + 100 + 0 after 3', async () => {
    const a = httpWith((u) => {
      const skip = Number(param(u, 'skip') ?? 0);
      return json(skip === 0 ? listingPage(0, 100) : skip === 100 ? listingPage(100, 30) : []);
    });
    const r1 = await listAllListings(a.http);
    expect(r1).toHaveLength(130);
    expect(a.calls).toHaveLength(2);

    const b = httpWith((u) => {
      const skip = Number(param(u, 'skip') ?? 0);
      return json(skip < 200 ? listingPage(skip, 100) : []);
    });
    const r2 = await listAllListings(b.http);
    expect(r2).toHaveLength(200);
    expect(new Set(r2.map((l) => l._id)).size).toBe(200);
    expect(b.calls).toHaveLength(3);
  });

  it('listAllListings honours maxPages/pageSize, forwards extra query params, and reports unparsable items', async () => {
    const bad: unknown[] = [];
    const { http, calls } = httpWith((u) => {
      const skip = Number(param(u, 'skip') ?? 0);
      return json({ results: [...listingPage(skip, 49), { title: 'no id' }], count: 1000, limit: 50, skip });
    });
    const out = await listAllListings(http, { pageSize: 50, maxPages: 2, query: { active: true }, onParseError: (_i, item) => bad.push(item) });
    expect(calls).toHaveLength(2);
    expect(param(calls[0].url, 'limit')).toBe('50');
    expect(param(calls[1].url, 'skip')).toBe('50');
    expect(param(calls[0].url, 'active')).toBe('true');
    expect(out).toHaveLength(98);
    expect(bad).toEqual([{ title: 'no id' }, { title: 'no id' }]);
  });

  it('getListing returns null on 404 and rethrows other errors; spaces and custom-field endpoints map their documented shapes', async () => {
    const h404 = httpWith(() => json({ message: 'Listing Not Found' }, 404));
    expect(await getListing(h404.http, 'missing')).toBeNull();
    expect(h404.calls[0].url.pathname).toMatch(/\/listings\/missing$/);
    const h500 = httpWith(() => json({}, 500));
    await expect(getListing(h500.http, 'x')).rejects.toBeInstanceOf(GuestyApiError);

    const spaces = httpWith(() =>
      json({
        unitTypeId: 'L1',
        spaces: [
          { name: 'Bedroom', beds: { KING_BED: 1 }, other: { CRIB: 1 } },
          { name: 'Living', beds: { SOFA_BED: 2, KING_BED: 1 } },
        ],
        bathrooms: { SHARED: 1, PRIVATE: 1 },
      }),
    );
    const s = await getUnitTypeSpaces(spaces.http, 'L1');
    expect(spaces.calls[0].url.pathname).toMatch(/\/properties\/spaces\/unit-type\/L1$/);
    expect(s?.beds).toMatchObject({ KING_BED: 2, SOFA_BED: 2 });
    expect(s?.bathrooms).toBe(2);
    const spaces404 = httpWith(() => json({}, 404));
    expect(await getUnitTypeSpaces(spaces404.http, 'L1')).toBeNull();

    const cf = httpWith(() => json({ propertyId: 'L1', customFields: [{ fieldId: 'f1', displayName: 'Informácie do práčovne', value: "Kapsule: L'OR" }] }));
    const values = await getListingCustomFields(cf.http, 'L1');
    expect(cf.calls[0].url.pathname).toMatch(/\/properties-api\/custom-fields\/L1$/);
    expect(values).toHaveLength(1);
    expect(values[0]).toMatchObject({ fieldId: 'f1', value: "Kapsule: L'OR" });

    const defs = httpWith(() =>
      json([
        { fieldId: 'f1', displayName: 'Laundry', object: 'listing', type: 'longtext' },
        { fieldId: 'f2', displayName: 'Res field', object: 'reservation', type: 'text' },
      ]),
    );
    const d = await getAccountCustomFieldDefs(defs.http, 'acc1');
    expect(defs.calls[0].url.pathname).toMatch(/\/accounts\/acc1\/custom-fields$/);
    expect(d.map((x) => x.fieldId)).toEqual(['f1']);
  });
});

// ---------------------------------------------------------------- reservations

function resv(id: string, listingId = 'L1') {
  return {
    _id: id,
    status: 'confirmed',
    stay: [{ listingId, checkInDateLocalized: '2026-10-01', checkOutDateLocalized: '2026-10-05', guestsCount: 2 }],
  };
}

describe('reservations endpoint', () => {
  it('searchReservations sends bracket filters and pages by pagination.hasMore', async () => {
    const { http, calls } = httpWith((u) => {
      const skip = Number(param(u, 'skip') ?? 0);
      return skip === 0
        ? json({ results: [resv('r1'), resv('r2')], pagination: { skip: 0, limit: 2, hasMore: true } })
        : json({ results: [resv('r3')], pagination: { skip: 2, limit: 2, hasMore: false } });
    });
    const r = await searchReservations(http, {
      checkOutGte: '2026-10-05',
      checkOutLte: '2026-10-07',
      status: 'confirmed',
      sort: 'checkOut',
      pageSize: 2,
    });
    expect(r.results.map((x) => x._id)).toEqual(['r1', 'r2', 'r3']);
    expect(r.truncated).toBe(false);
    expect(r.pages).toBe(2);
    expect(calls).toHaveLength(2);
    const u = calls[0].url;
    expect(u.pathname).toMatch(/\/reservations-v3\/search$/);
    expect(param(u, 'filter[checkOut][gte]')).toBe('2026-10-05');
    expect(param(u, 'filter[checkOut][lte]')).toBe('2026-10-07');
    expect(param(u, 'filter[status]')).toBe('confirmed');
    expect(param(u, 'sort')).toBe('checkOut');
    expect(param(u, 'limit')).toBe('2');
    expect(param(u, 'skip')).toBe('0');
    expect(param(calls[1].url, 'skip')).toBe('2');
  });

  it('searchReservations comma-joins listingIds and status lists (documented "comma-separated value implies in")', async () => {
    const { http, calls } = httpWith(() => json({ results: [], pagination: { skip: 0, limit: 100, hasMore: false } }));
    await searchReservations(http, { listingIds: ['L1', 'L2'], status: ['confirmed', 'reserved'], checkInGte: '2026-10-05', sort: 'checkIn' });
    const u = calls[0].url;
    expect(param(u, 'filter[listingId]')).toBe('L1,L2');
    expect(param(u, 'filter[status]')).toBe('confirmed,reserved');
    expect(param(u, 'filter[checkIn][gte]')).toBe('2026-10-05');
    expect(param(u, 'limit')).toBe('100');
  });

  it('stopWhen stops early and flags truncated only when Guesty still had more', async () => {
    const more = httpWith((u) => {
      const skip = Number(param(u, 'skip') ?? 0);
      return json({ results: [resv(`r${skip}`)], pagination: { skip, limit: 1, hasMore: true } });
    });
    const r1 = await searchReservations(more.http, { pageSize: 1, stopWhen: (all) => all.length >= 1 });
    expect(more.calls).toHaveLength(1);
    expect(r1.pages).toBe(1);
    expect(r1.truncated).toBe(true);
    expect(r1.results).toHaveLength(1);

    const last = httpWith(() => json({ results: [resv('r1')], pagination: { skip: 0, limit: 1, hasMore: false } }));
    const r2 = await searchReservations(last.http, { pageSize: 1, stopWhen: () => true });
    expect(r2.truncated).toBe(false);
    expect(last.calls).toHaveLength(1);
  });

  it('maxPages caps the paging and flags truncated only when hasMore was still true', async () => {
    const more = httpWith((u) => {
      const skip = Number(param(u, 'skip') ?? 0);
      return json({ results: [resv(`r${skip}`)], pagination: { skip, limit: 1, hasMore: true } });
    });
    const r1 = await searchReservations(more.http, { pageSize: 1, maxPages: 3 });
    expect(more.calls).toHaveLength(3);
    expect(r1.pages).toBe(3);
    expect(r1.results).toHaveLength(3);
    expect(r1.truncated).toBe(true);

    const exact = httpWith((u) => {
      const skip = Number(param(u, 'skip') ?? 0);
      return json({ results: [resv(`r${skip}`)], pagination: { skip, limit: 1, hasMore: skip < 2 } });
    });
    const r2 = await searchReservations(exact.http, { pageSize: 1, maxPages: 3 });
    expect(exact.calls).toHaveLength(3);
    expect(r2.truncated).toBe(false);
  });

  it('an envelope without pagination falls back to counting (a short page ends the paging)', async () => {
    const { http, calls } = httpWith((u) => {
      const skip = Number(param(u, 'skip') ?? 0);
      return json({ results: skip === 0 ? [resv('r1'), resv('r2')] : [resv('r3')] });
    });
    const r = await searchReservations(http, { pageSize: 2 });
    expect(r.results).toHaveLength(3);
    expect(calls).toHaveLength(2);
    expect(r.truncated).toBe(false);
  });

  it('getReservationsByIds chunks 23 ids into 3 calls of 10/10/3 and concatenates; an empty list makes no call', async () => {
    const ids = Array.from({ length: 23 }, (_, i) => `R${i}`);
    const requestedIds = (u: URL) =>
      [...u.searchParams.entries()].filter(([k]) => k.startsWith('reservationIds')).flatMap(([, v]) => v.split(','));
    const { http, calls } = httpWith((u) => json(requestedIds(u).map((id) => resv(id))));
    const out = await getReservationsByIds(http, ids);
    expect(calls).toHaveLength(3);
    expect(calls.every((c) => /\/reservations-v3$/.test(c.url.pathname))).toBe(true);
    expect(calls.map((c) => requestedIds(c.url).length)).toEqual([10, 10, 3]);
    expect(out.map((r) => r._id)).toEqual(ids);

    const none = httpWith(() => json([]));
    expect(await getReservationsByIds(none.http, [])).toEqual([]);
    expect(none.calls).toHaveLength(0);
  });

  it('reservationId reads either id generation', () => {
    expect(reservationId({ _id: 'a' })).toBe('a');
    expect(reservationId({ reservationId: 'b' })).toBe('b');
    expect(reservationId({ _id: null, reservationId: 'c' })).toBe('c');
    expect(reservationId({})).toBeNull();
  });
});

// ---------------------------------------------------------------- calendar

const day = (date: string, listingId?: string, extra: Record<string, unknown> = {}) => ({
  date,
  ...(listingId ? { listingId } : {}),
  minNights: 2,
  status: 'available',
  cta: false,
  ...extra,
});

describe('calendar endpoint', () => {
  it('extractCalendarDays collects day objects from a flat array, {data:{days}}, {days}, per-listing objects and minified {calendar}', () => {
    const d1 = day('2026-10-06', 'L1');
    const d2 = day('2026-10-07', 'L2');
    expect(extractCalendarDays([d1, d2])).toEqual([d1, d2]);
    expect(extractCalendarDays({ data: { days: [d1, d2] } })).toEqual([d1, d2]);
    expect(extractCalendarDays({ days: [d1] })).toEqual([d1]);
    expect(extractCalendarDays([{ listingId: 'L1', days: [d1] }, { listingId: 'L2', days: [d2] }])).toEqual([d1, d2]);
    expect(extractCalendarDays({ L1: { days: [d1] }, L2: { days: [d2] } })).toEqual([d1, d2]);
    expect(extractCalendarDays({ data: { listingId: 'L1', calendar: [d1] } })).toEqual([d1]);
    expect(extractCalendarDays({ message: 'nothing' })).toEqual([]);
    expect(extractCalendarDays(null)).toEqual([]);
  });

  it('getCalendarDays calls the multi-listing endpoint once for a small batch and parses minNights/status/cta', async () => {
    const { http, calls } = httpWith(() => json([day('2026-10-06', 'L1', { minNights: 3, status: 'unavailable', cta: true }), day('2026-10-06', 'L2')]));
    const days = await getCalendarDays(http, ['L1', 'L2'], '2026-10-06', '2026-10-06');
    expect(calls).toHaveLength(1);
    const u = calls[0].url;
    expect(u.pathname).toMatch(/\/availability-pricing\/api\/calendar\/listings$/);
    expect(param(u, 'listingIds')).toBe('L1,L2');
    expect(param(u, 'startDate')).toBe('2026-10-06');
    expect(param(u, 'endDate')).toBe('2026-10-06');
    expect(days).toHaveLength(2);
    expect(days[0]).toMatchObject({ date: '2026-10-06', listingId: 'L1', minNights: 3, status: 'unavailable', cta: true });
  });

  it('a 422 on the batch falls back to the single-listing endpoint and injects the listingId into days that lack it', async () => {
    const { http, calls } = httpWith((u) => {
      if (u.pathname.endsWith('/calendar/listings')) return json({ message: 'validation' }, 422);
      const id = u.pathname.split('/').pop()!;
      return json({ data: { days: [day('2026-10-06', undefined, { minNights: id === 'L1' ? 1 : 4 })] } });
    });
    const days = await getCalendarDays(http, ['L1', 'L2'], '2026-10-06', '2026-10-06');
    expect(calls).toHaveLength(3);
    expect(calls[1].url.pathname).toMatch(/\/calendar\/listings\/L1$/);
    expect(calls[2].url.pathname).toMatch(/\/calendar\/listings\/L2$/);
    expect(param(calls[1].url, 'startDate')).toBe('2026-10-06');
    expect(days.map((d) => [d.listingId, d.minNights])).toEqual([
      ['L1', 1],
      ['L2', 4],
    ]);
  });

  // spec_ambiguous: PROPOSAL §5 step 5 only says "Unknown days -> pack for capacity + muted note".
  // Reading A (current code, calendar.ts 52-56): a 404 for one listing in the fallback rethrows, the
  // reconcile marks the whole 'calendar' step partial (reconcile.ts 273-274) and every gap in the
  // chunk stays "min. pobyt neznámy" until the hourly listing refresh drops the deleted id.
  // Reading B (this test): contain the 404 per listing so only that listing's days are unknown.
  it.skip('a 404 for one listing in the per-listing fallback does not lose the other listings’ days', async () => {
    const { http, calls } = httpWith((u) => {
      if (u.pathname.endsWith('/calendar/listings')) return json({ message: 'Listing Not Found' }, 404);
      if (u.pathname.endsWith('/L2')) return json({ message: 'Listing Not Found' }, 404);
      return json([day('2026-10-06', undefined)]);
    });
    const days = await getCalendarDays(http, ['L1', 'L2', 'L3'], '2026-10-06', '2026-10-06');
    expect(calls).toHaveLength(4);
    expect(days.map((d) => d.listingId)).toEqual(['L1', 'L3']);
  });

  it('chunkSize splits many listings into several batch calls', async () => {
    const { http, calls } = httpWith((u) => json((param(u, 'listingIds') ?? '').split(',').map((id) => day('2026-10-06', id))));
    const ids = Array.from({ length: 5 }, (_, i) => `L${i}`);
    const days = await getCalendarDays(http, ids, '2026-10-06', '2026-10-06', { chunkSize: 2 });
    expect(calls).toHaveLength(3);
    expect(calls.map((c) => param(c.url, 'listingIds'))).toEqual(['L0,L1', 'L2,L3', 'L4']);
    expect(days.map((d) => d.listingId)).toEqual(ids);
  });

  it('days that do not fit the schema are skipped and reported; no listings -> no call', async () => {
    // An object without a string `date` is not day-like and is dropped silently by extractCalendarDays;
    // a day-like object that fails the schema (cta must be boolean) must be reported.
    const bad: unknown[] = [];
    const { http, calls } = httpWith(() => json([day('2026-10-06', 'L1'), day('2026-10-07', 'L1', { cta: 'yes' })]));
    const days = await getCalendarDays(http, ['L1'], '2026-10-06', '2026-10-07', { onParseError: (_i, item) => bad.push(item) });
    expect(days).toHaveLength(1);
    expect(bad).toHaveLength(1);
    expect((bad[0] as { date: string }).date).toBe('2026-10-07');
    const none = httpWith(() => json([]));
    expect(await getCalendarDays(none.http, [], '2026-10-06', '2026-10-06')).toEqual([]);
    expect(none.calls).toHaveLength(0);
    expect(calls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------- webhooks

describe('webhooks endpoint', () => {
  it('getWebhookSecret sends url=… and finds a whsec_ value at any depth, reporting the top-level keys only', async () => {
    const nested = httpWith(() => json({ data: { endpoint: 'x', signing: { secret: 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw' } } }));
    const r1 = await getWebhookSecret(nested.http, 'https://app.example/api/guesty/webhook');
    expect(nested.calls[0].url.pathname).toMatch(/\/webhooks-v2\/secret$/);
    expect(param(nested.calls[0].url, 'url')).toBe('https://app.example/api/guesty/webhook');
    expect(r1.secret).toBe('whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw');
    expect(r1.responseKeys).toEqual(['data']);

    const flat = httpWith(() => json({ key: 'whsec_abc', createdAt: '2026-10-05' }));
    const r2 = await getWebhookSecret(flat.http, 'https://app.example/hook');
    expect(r2.secret).toBe('whsec_abc');
    expect([...r2.responseKeys].sort()).toEqual(['createdAt', 'key']);

    const missing = httpWith(() => json({ message: 'no secret here', url: 'https://app.example/hook' }));
    const r3 = await getWebhookSecret(missing.http, 'https://app.example/hook');
    expect(r3.secret).toBeNull();
    expect([...r3.responseKeys].sort()).toEqual(['message', 'url']);
  });

  it('getWebhookSecret also finds a whsec_ value nested inside an array (the response shape is undocumented)', async () => {
    // impl_bug (low): webhooks.ts flatten() does not descend into arrays, so this returns null
    const inArray = httpWith(() => json({ secrets: [{ id: 1, value: 'whsec_inarr' }] }));
    expect((await getWebhookSecret(inArray.http, 'https://app.example/hook')).secret).toBe('whsec_inarr');
    const bareArray = httpWith(() => json([{ key: 'whsec_bare' }]));
    expect((await getWebhookSecret(bareArray.http, 'https://app.example/hook')).secret).toBe('whsec_bare');
  });

  it('listWebhooks parses a bare array and a {results} envelope, events default to []', async () => {
    const bare = httpWith(() =>
      json([
        { _id: 'w1', url: 'https://a.example/h', events: ['listing.new'], accountId: 'acc' },
        { _id: 'w2', url: 'https://b.example/h' },
      ]),
    );
    const l1 = await listWebhooks(bare.http);
    expect(bare.calls[0].url.pathname).toMatch(/\/webhooks$/);
    expect(l1.map((w) => [w._id, w.url, w.events])).toEqual([
      ['w1', 'https://a.example/h', ['listing.new']],
      ['w2', 'https://b.example/h', []],
    ]);
    const env = httpWith(() => json({ results: [{ _id: 'w3', url: 'https://c.example/h', events: [] }] }));
    expect((await listWebhooks(env.http)).map((w) => w._id)).toEqual(['w3']);
  });

  it('createWebhook POSTs {url, events} and returns the parsed webhook; deleteWebhook DELETEs /webhooks/{id}', async () => {
    const { http, calls } = httpWith((u, init) =>
      (init.method ?? 'GET').toUpperCase() === 'POST'
        ? json({ accountId: 'acc', _id: 'w9', url: 'https://app.example/hook', events: ['reservation.created.v2', 'listing.updated'] }, 201)
        : new Response(null, { status: 204 }),
    );
    const w = await createWebhook(http, 'https://app.example/hook', ['reservation.created.v2', 'listing.updated']);
    expect(w).toMatchObject({ _id: 'w9', url: 'https://app.example/hook', events: ['reservation.created.v2', 'listing.updated'] });
    expect(calls[0].url.pathname).toMatch(/\/webhooks$/);
    expect(JSON.parse(calls[0].body ?? '{}')).toEqual({ url: 'https://app.example/hook', events: ['reservation.created.v2', 'listing.updated'] });
    await deleteWebhook(http, 'w9');
    expect(calls[1].url.pathname).toMatch(/\/webhooks\/w9$/);
    expect((calls[1].init.method ?? '').toUpperCase()).toBe('DELETE');
  });
});
