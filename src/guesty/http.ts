import type { Logger } from './log';
import { silentLogger } from './log';

export const GUESTY_BASE_URL = 'https://open-api.guesty.com/v1';

export type QueryValue = string | number | boolean | string[] | undefined | null;

export class GuestyApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly path: string,
    public readonly body: unknown,
    public readonly retryAfterSeconds: number | null = null,
  ) {
    super(`Guesty ${status} on ${path}`);
    this.name = 'GuestyApiError';
  }
}

export type TokenProvider = (opts?: { forceRefresh?: boolean }) => Promise<string>;

export interface GuestyHttpOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  log?: Logger;
  /** Longest Retry-After the client honours before giving up (seconds). */
  maxRetryAfterSeconds?: number;
  /** Pause when the per-minute remaining header drops below this. */
  minuteRemainingFloor?: number;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * One-request-at-a-time HTTP client for the Guesty Open API with the documented
 * backoff: 429 -> wait Retry-After, 5xx -> retry after 1 s and 3 s, 401 -> one
 * token refresh. Rate limits are per account (15/s, 120/min, 5000/h).
 */
export class GuestyHttp {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly log: Logger;
  private readonly maxRetryAfter: number;
  private readonly minuteFloor: number;
  /** Requests actually sent (including retries). */
  calls = 0;

  constructor(
    private readonly token: TokenProvider,
    opts: GuestyHttpOptions = {},
  ) {
    this.baseUrl = (opts.baseUrl ?? GUESTY_BASE_URL).replace(/\/$/, '');
    this.fetchFn = opts.fetch ?? fetch;
    this.sleep = opts.sleep ?? defaultSleep;
    this.log = opts.log ?? silentLogger;
    this.maxRetryAfter = opts.maxRetryAfterSeconds ?? 30;
    this.minuteFloor = opts.minuteRemainingFloor ?? 10;
  }

  get<T = unknown>(path: string, query?: Record<string, QueryValue>): Promise<T> {
    return this.enqueue(() => this.request<T>('GET', path, query));
  }
  post<T = unknown>(path: string, body?: unknown, query?: Record<string, QueryValue>): Promise<T> {
    return this.enqueue(() => this.request<T>('POST', path, query, body));
  }
  put<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.enqueue(() => this.request<T>('PUT', path, undefined, body));
  }
  delete<T = unknown>(path: string): Promise<T> {
    return this.enqueue(() => this.request<T>('DELETE', path));
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  buildUrl(path: string, query?: Record<string, QueryValue>): string {
    const url = new URL(path.startsWith('http') ? path : `${this.baseUrl}${path.startsWith('/') ? '' : '/'}${path}`);
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v === undefined || v === null) continue;
      url.searchParams.set(k, Array.isArray(v) ? v.join(',') : String(v));
    }
    return url.toString();
  }

  private async request<T>(method: string, path: string, query?: Record<string, QueryValue>, body?: unknown): Promise<T> {
    const url = this.buildUrl(path, query);
    let refreshed = false;
    const serverRetries = [1000, 3000];
    let rateLimitRetries = 0;
    for (;;) {
      const token = await this.token();
      this.calls++;
      const res = await this.fetchFn(url, {
        method,
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${token}`,
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const text = await res.text();
      const json = text ? safeJson(text) : null;

      if (res.ok) {
        const remaining = Number(res.headers.get('x-ratelimit-remaining-minute'));
        if (res.headers.has('x-ratelimit-remaining-minute') && Number.isFinite(remaining) && remaining < this.minuteFloor) {
          this.log.warn('guesty.rate_limit.near', { remaining_minute: remaining });
          await this.sleep(5000);
        }
        return (res.status === 204 ? null : json) as T;
      }

      if (res.status === 401 && !refreshed) {
        refreshed = true;
        this.log.warn('guesty.401.refresh', { path });
        await this.token({ forceRefresh: true });
        continue;
      }
      if (res.status === 429 && rateLimitRetries < 2) {
        rateLimitRetries++;
        const retryAfter = Number(res.headers.get('retry-after')) || 1;
        if (retryAfter > this.maxRetryAfter) throw new GuestyApiError(429, path, json, retryAfter);
        this.log.warn('guesty.429', { path, retry_after: retryAfter });
        await this.sleep(retryAfter * 1000);
        continue;
      }
      if (res.status >= 500 && serverRetries.length) {
        const wait = serverRetries.shift()!;
        this.log.warn('guesty.5xx.retry', { path, status: res.status, wait_ms: wait });
        await this.sleep(wait);
        continue;
      }
      throw new GuestyApiError(res.status, path, json, res.status === 429 ? Number(res.headers.get('retry-after')) || null : null);
    }
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 500) };
  }
}
