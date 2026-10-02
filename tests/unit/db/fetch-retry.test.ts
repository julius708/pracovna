import { describe, expect, it } from 'vitest';
import { createRetryingFetch } from '@/db/fetch-retry';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('createRetryingFetch', () => {
  it('repeats a request answered 401 "JWT issued at future" and returns the later answer', async () => {
    const calls: string[] = [];
    const waits: number[] = [];
    const base = (async (input: string | URL | Request) => {
      calls.push(String(input));
      return calls.length === 1 ? json(401, { code: 'PGRST301', message: 'JWT issued at future' }) : json(200, [{ key: 'x' }]);
    }) as typeof fetch;
    const f = createRetryingFetch({ fetch: base, sleep: async (ms) => void waits.push(ms) });
    const res = await f('https://x.supabase.co/rest/v1/app_state');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ key: 'x' }]);
    expect(calls).toHaveLength(2);
    expect(waits).toEqual([300]);
  });

  it('gives up after the configured retries and returns the last 401', async () => {
    let n = 0;
    const base = (async () => {
      n++;
      return json(401, { message: 'JWT issued at future' });
    }) as typeof fetch;
    const f = createRetryingFetch({ fetch: base, retries: 2, sleep: async () => {} });
    const res = await f('https://x.supabase.co/rest/v1/app_state');
    expect(res.status).toBe(401);
    expect(n).toBe(3);
    expect(await res.text()).toContain('JWT issued at future');
  });

  it('passes every other answer through untouched, including other 401s and 5xx', async () => {
    let n = 0;
    const base = (async () => {
      n++;
      return n === 1 ? json(401, { message: 'Invalid API key' }) : json(500, {});
    }) as typeof fetch;
    const f = createRetryingFetch({ fetch: base, sleep: async () => {} });
    expect((await f('https://x')).status).toBe(401);
    expect((await f('https://x')).status).toBe(500);
    expect(n).toBe(2);
  });
});
