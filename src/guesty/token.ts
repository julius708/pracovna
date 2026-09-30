import { tokenResponseSchema } from './schemas';
import type { Logger } from './log';
import { silentLogger } from './log';

export const TOKEN_URL = 'https://open-api.guesty.com/oauth2/token';
/** Guesty allows 5 tokens per 24 h per client id; the server keeps 2 in reserve. */
export const MAX_SERVER_MINTS_PER_24H = 3;
export const REFRESH_BEFORE_MS = 30 * 60_000;
const REACTIVE_REFRESH_MIN_GAP_MS = 10 * 60_000;
const LEASE_MS = 60_000;

export interface TokenRecord {
  accessToken: string | null;
  /** ISO instant. */
  expiresAt: string | null;
  /** ISO instants of every server mint, oldest first. */
  mints: string[];
  leaseUntil: string | null;
}

/** Persistence of the single cached token (one row shared by every server instance). */
export interface TokenStore {
  read(): Promise<TokenRecord>;
  /** Atomically takes the mint lease when it is free or expired. */
  tryLease(untilIso: string, nowIso: string): Promise<boolean>;
  releaseLease(): Promise<void>;
  save(rec: { accessToken: string; expiresAt: string; mintedAt: string }): Promise<void>;
}

export interface TokenMinter {
  mint(): Promise<{ accessToken: string; expiresInSeconds: number }>;
}

export class TokenQuotaError extends Error {
  constructor(public readonly nextPossibleAt: string) {
    super(`Guesty token quota reached; next mint possible at ${nextPossibleAt}`);
    this.name = 'TokenQuotaError';
  }
}

/** POST /oauth2/token with the client-credentials grant (form-encoded, scope open-api). */
export function createMinter(creds: { clientId: string; clientSecret: string }, fetchFn: typeof fetch = fetch): TokenMinter {
  return {
    async mint() {
      const body = new URLSearchParams({
        grant_type: 'client_credentials',
        scope: 'open-api',
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
      });
      const res = await fetchFn(TOKEN_URL, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
        body,
      });
      const json: unknown = await res.json().catch(() => null);
      if (!res.ok) throw new Error(`Guesty token endpoint returned ${res.status}`);
      const parsed = tokenResponseSchema.parse(json);
      return { accessToken: parsed.access_token, expiresInSeconds: parsed.expires_in ?? 86_400 };
    },
  };
}

export interface TokenProviderOptions {
  store: TokenStore;
  minter: TokenMinter;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  log?: Logger;
  maxMintsPer24h?: number;
  onQuotaWarning?: (mintsInWindow: number) => void;
}

/** In-memory token store for tests and the seed mode. */
export function createMemoryTokenStore(initial?: Partial<TokenRecord>): TokenStore & { record: TokenRecord } {
  const record: TokenRecord = { accessToken: null, expiresAt: null, mints: [], leaseUntil: null, ...initial };
  return {
    record,
    async read() {
      return { ...record, mints: [...record.mints] };
    },
    async tryLease(untilIso, nowIso) {
      if (record.leaseUntil && record.leaseUntil > nowIso) return false;
      record.leaseUntil = untilIso;
      return true;
    },
    async releaseLease() {
      record.leaseUntil = null;
    },
    async save(rec) {
      record.accessToken = rec.accessToken;
      record.expiresAt = rec.expiresAt;
      record.mints = [...record.mints, rec.mintedAt];
    },
  };
}

function mintsInLast24h(mints: string[], now: Date): string[] {
  const since = now.getTime() - 24 * 3_600_000;
  return mints.filter((m) => Date.parse(m) > since);
}

/**
 * Returns a token provider that reuses the cached token until 30 minutes before
 * expiry, mints under a single-flight lease, caps server mints at 3 per 24 h,
 * and refreshes at most once per 10 minutes when Guesty answers 401.
 */
export function createTokenProvider(opts: TokenProviderOptions) {
  const now = opts.now ?? (() => new Date());
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const log = opts.log ?? silentLogger;
  const maxMints = opts.maxMintsPer24h ?? MAX_SERVER_MINTS_PER_24H;

  const isFresh = (rec: TokenRecord, at: Date) =>
    !!rec.accessToken && !!rec.expiresAt && Date.parse(rec.expiresAt) - at.getTime() > REFRESH_BEFORE_MS;
  const isUsable = (rec: TokenRecord, at: Date) =>
    !!rec.accessToken && !!rec.expiresAt && Date.parse(rec.expiresAt) > at.getTime();

  async function mintUnderLease(reason: string, attempt = 0): Promise<string> {
    const at = now();
    const before = await opts.store.read();
    const leased = await opts.store.tryLease(new Date(at.getTime() + LEASE_MS).toISOString(), at.toISOString());
    if (!leased) {
      // another instance is minting: wait for ITS new token (for a forced refresh the
      // old token is still "fresh" by expiry, so wait until the token actually changes)
      const arrived = (rec: TokenRecord) =>
        reason === 'force' ? !!rec.accessToken && rec.accessToken !== before.accessToken && isUsable(rec, now()) : isFresh(rec, now());
      for (let i = 0; i < 20; i++) {
        await sleep(1000);
        const rec = await opts.store.read();
        if (arrived(rec)) return rec.accessToken!;
        if (!rec.leaseUntil || rec.leaseUntil <= now().toISOString()) {
          // the holder gave up without a new token: take the lease ourselves once
          if (attempt === 0) return mintUnderLease(reason, 1);
          break;
        }
      }
      const rec = await opts.store.read();
      if (isUsable(rec, now())) {
        log.warn('guesty.token.wait_fallback', { reason });
        return rec.accessToken!;
      }
      throw new Error('Guesty token lease held by another instance and no token appeared');
    }
    try {
      const rec = await opts.store.read();
      if (reason !== 'force' && isFresh(rec, now())) return rec.accessToken!;
      const recent = mintsInLast24h(rec.mints, now());
      if (recent.length >= maxMints) {
        const nextAt = new Date(Date.parse(recent[0]) + 24 * 3_600_000).toISOString();
        if (isUsable(rec, now())) {
          log.warn('guesty.token.quota_using_existing', { next_possible_at: nextAt });
          return rec.accessToken!;
        }
        throw new TokenQuotaError(nextAt);
      }
      const minted = await opts.minter.mint();
      const mintedAt = now();
      const expiresAt = new Date(mintedAt.getTime() + minted.expiresInSeconds * 1000).toISOString();
      await opts.store.save({ accessToken: minted.accessToken, expiresAt, mintedAt: mintedAt.toISOString() });
      const count = recent.length + 1;
      log.info('guesty.token.minted', { reason, mints_24h: count, expires_at: expiresAt });
      if (count >= maxMints) opts.onQuotaWarning?.(count);
      return minted.accessToken;
    } finally {
      await opts.store.releaseLease();
    }
  }

  return async function getToken(o?: { forceRefresh?: boolean }): Promise<string> {
    const rec = await opts.store.read();
    const at = now();
    if (o?.forceRefresh) {
      const last = rec.mints.length ? Date.parse(rec.mints[rec.mints.length - 1]) : 0;
      if (at.getTime() - last < REACTIVE_REFRESH_MIN_GAP_MS && rec.accessToken) {
        log.warn('guesty.token.refresh_throttled');
        return rec.accessToken;
      }
      return mintUnderLease('force');
    }
    if (isFresh(rec, at)) return rec.accessToken!;
    return mintUnderLease(rec.accessToken ? 'expiring' : 'initial');
  };
}
