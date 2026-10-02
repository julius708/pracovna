/**
 * A fetch for the Supabase clients that retries one platform quirk: the first
 * request of a fresh process is sometimes answered 401 "JWT issued at future"
 * (the gateway mints a token whose `iat` is a moment ahead of the API node's
 * clock); the same request succeeds a few hundred milliseconds later. The
 * failed request never reached the database, so repeating it is safe for GET
 * and POST alike. Everything else passes through untouched.
 */
export const JWT_FUTURE = /jwt issued at future/i;

export interface RetryingFetchOptions {
  fetch?: typeof fetch;
  retries?: number;
  delayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function createRetryingFetch(opts: RetryingFetchOptions = {}): typeof fetch {
  const base = opts.fetch ?? fetch;
  const retries = opts.retries ?? 2;
  const delay = opts.delayMs ?? 300;
  const sleep = opts.sleep ?? defaultSleep;
  return async (input, init) => {
    for (let attempt = 0; ; attempt++) {
      const res = await base(input, init);
      if (res.status !== 401 || attempt >= retries) return res;
      const text = await res.clone().text().catch(() => '');
      if (!JWT_FUTURE.test(text)) return res;
      await sleep(delay * (attempt + 1));
    }
  };
}
