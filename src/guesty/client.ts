import type { Env } from '@/env';
import { getCalendarDays } from './endpoints/calendar';
import { getAccountCustomFieldDefs, getListing, getListingCustomFields, getUnitTypeSpaces, listAllListings, type ListListingsOptions } from './endpoints/listings';
import { getReservationsByIds, searchReservations, type ReservationSearch, type ReservationSearchResult } from './endpoints/reservations';
import { createWebhook, deleteWebhook, getWebhookSecret, listWebhooks, type WebhookSecretResult } from './endpoints/webhooks';
import { GuestyHttp, type GuestyHttpOptions } from './http';
import type { Logger } from './log';
import type { ParsedCalendarDay, ParsedCustomFieldDef, ParsedListing, ParsedReservation, ParsedWebhook } from './schemas';
import { createMinter, createTokenProvider, type TokenStore } from './token';
import type { GuestyCustomFieldValue, GuestySpaces } from './types';

/** Everything the sync needs from Guesty. The fake client implements the same surface. */
export interface GuestyClient {
  listListings(opts?: ListListingsOptions): Promise<ParsedListing[]>;
  getListing(id: string): Promise<ParsedListing | null>;
  getSpaces(id: string): Promise<GuestySpaces | null>;
  getListingCustomFields(id: string): Promise<GuestyCustomFieldValue[]>;
  getCustomFieldDefs(): Promise<ParsedCustomFieldDef[]>;
  searchReservations(p: ReservationSearch): Promise<ReservationSearchResult>;
  getReservationsByIds(ids: string[]): Promise<ParsedReservation[]>;
  getCalendarDays(listingIds: string[], startDate: string, endDate: string): Promise<ParsedCalendarDay[]>;
  listWebhooks(): Promise<ParsedWebhook[]>;
  createWebhook(url: string, events: readonly string[]): Promise<ParsedWebhook>;
  deleteWebhook(id: string): Promise<void>;
  getWebhookSecret(url: string): Promise<WebhookSecretResult>;
  /** Requests sent since the client was created. */
  calls(): number;
  readonly kind: 'live' | 'fake';
}

export interface LiveClientOptions {
  env: Pick<Env, 'GUESTY_CLIENT_ID' | 'GUESTY_CLIENT_SECRET' | 'GUESTY_ACCOUNT_ID'>;
  tokenStore: TokenStore;
  fetch?: typeof fetch;
  log?: Logger;
  http?: Partial<GuestyHttpOptions>;
  onTokenQuotaWarning?: (mints: number) => void;
}

/** Client over the real Open API with the cached token. */
export function createGuestyClient(opts: LiveClientOptions): GuestyClient {
  if (!opts.env.GUESTY_CLIENT_ID || !opts.env.GUESTY_CLIENT_SECRET) {
    throw new Error('GUESTY_CLIENT_ID and GUESTY_CLIENT_SECRET are required for the live Guesty client');
  }
  const fetchFn = opts.fetch ?? fetch;
  const token = createTokenProvider({
    store: opts.tokenStore,
    minter: createMinter({ clientId: opts.env.GUESTY_CLIENT_ID, clientSecret: opts.env.GUESTY_CLIENT_SECRET }, fetchFn),
    log: opts.log,
    onQuotaWarning: opts.onTokenQuotaWarning,
  });
  const http = new GuestyHttp(token, { fetch: fetchFn, log: opts.log, ...(opts.http ?? {}) });
  return clientFromHttp(http, opts.env.GUESTY_ACCOUNT_ID);
}

/** Wraps an HTTP client (real or fetch-mocked) into the GuestyClient surface. */
export function clientFromHttp(http: GuestyHttp, accountId: string): GuestyClient {
  return {
    kind: 'live',
    listListings: (o) => listAllListings(http, o),
    getListing: (id) => getListing(http, id),
    getSpaces: (id) => getUnitTypeSpaces(http, id),
    getListingCustomFields: (id) => getListingCustomFields(http, id),
    getCustomFieldDefs: () => getAccountCustomFieldDefs(http, accountId),
    searchReservations: (p) => searchReservations(http, p),
    getReservationsByIds: (ids) => getReservationsByIds(http, ids),
    getCalendarDays: (ids, s, e) => getCalendarDays(http, ids, s, e),
    listWebhooks: () => listWebhooks(http),
    createWebhook: (url, events) => createWebhook(http, url, events),
    deleteWebhook: (id) => deleteWebhook(http, id),
    getWebhookSecret: (url) => getWebhookSecret(http, url),
    calls: () => http.calls,
  };
}
