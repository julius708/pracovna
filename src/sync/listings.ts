import { CITY_MATCH, EXCLUDED_NICKNAME_PREFIX, norm } from '@/core/packing';
import type { SyncRepo } from '@/db/repo';
import type { ListingRow } from '@/db/types';
import type { GuestyClient } from '@/guesty/client';
import type { Logger } from '@/guesty/log';
import { silentLogger } from '@/guesty/log';
import { bedsFromRooms, customFieldEntries, mapListing } from '@/guesty/mappers';
import type { ParsedListing } from '@/guesty/schemas';

export interface ListingsSyncDeps {
  repo: SyncRepo;
  client: GuestyClient;
  laundryFieldId: string;
  cleanerFieldId?: string | null;
  log?: Logger;
  now?: () => Date;
}

export interface ListingsSyncResult {
  fetched: number;
  inScope: number;
  removed: number;
  applied: boolean;
  dropped: number;
  extraCalls: { spaces: number; customFields: number };
}

/** A listing that would need the expensive fallbacks is worth them only if it could be in scope. */
function couldBeInScope(raw: ParsedListing): boolean {
  if (raw.active === false) return false;
  if (!norm(raw.address?.city).includes(CITY_MATCH)) return false;
  if (EXCLUDED_NICKNAME_PREFIX.test(String(raw.nickname ?? ''))) return false;
  return true;
}

/** Refuse a run that would drop more than this many in-scope listings at once. */
export const MAX_IN_SCOPE_DROP = 5;
const DEFS_TTL_MS = 24 * 3_600_000;

/**
 * Full listing sync: fetches every listing, resolves beds/bathrooms/laundry
 * field through the Spaces and custom-field endpoints when the listing object
 * lacks them, applies the scope rules, and marks vanished listings as removed.
 */
export async function syncListings(deps: ListingsSyncDeps): Promise<ListingsSyncResult> {
  const { repo, client } = deps;
  const log = (deps.log ?? silentLogger).child({ job: 'listings' });
  const now = deps.now ?? (() => new Date());
  const fetchedAt = now().toISOString();
  const extraCalls = { spaces: 0, customFields: 0 };

  const raw = await client.listListings({ onParseError: (issue) => log.warn('listing.parse_error', { issue }) });
  if (!raw.length) throw new Error('Guesty returned no listings');

  // custom field definitions (fieldId -> name), cached for a day
  let defs = await repo.getState<{ at: string; names: Record<string, string> }>('custom_field_defs');
  if (!defs || now().getTime() - Date.parse(defs.at) > DEFS_TTL_MS) {
    try {
      const list = await client.getCustomFieldDefs();
      defs = { at: fetchedAt, names: Object.fromEntries(list.map((d) => [d.fieldId, d.displayName ?? d.key ?? ''])) };
      await repo.setState('custom_field_defs', defs);
    } catch (e) {
      log.warn('custom_field_defs.failed', { error: String(e) });
      defs = defs ?? { at: fetchedAt, names: {} };
    }
  }

  const existing = new Map((await repo.getListings()).map((l) => [l.guesty_id, l]));
  const rows: ListingRow[] = [];
  for (const l of raw) {
    const candidate = couldBeInScope(l);
    let spaces = null;
    let customFieldValues = null;
    if (candidate && !Object.keys(bedsFromRooms(l.listingRooms)).length) {
      spaces = await client.getSpaces(l._id);
      extraCalls.spaces++;
    }
    if (candidate && !customFieldEntries(l.customFields).length) {
      customFieldValues = await client.getListingCustomFields(l._id);
      extraCalls.customFields++;
    }
    rows.push(
      mapListing(l, {
        laundryFieldId: deps.laundryFieldId,
        cleanerFieldId: deps.cleanerFieldId,
        fieldNames: defs.names,
        spaces,
        customFieldValues,
        fetchedAt,
      }),
    );
  }

  const seen = new Set(rows.map((r) => r.guesty_id));
  const removed: ListingRow[] = [];
  for (const old of existing.values()) {
    if (!seen.has(old.guesty_id) && (old.active || old.in_scope)) {
      removed.push({ ...old, active: false, in_scope: false, exclusion_reason: 'removed', fetched_at: fetchedAt });
    }
  }

  const prevInScope = [...existing.values()].filter((l) => l.in_scope).length;
  const nextInScope = rows.filter((r) => r.in_scope).length;
  const dropped = Math.max(0, prevInScope - nextInScope);
  if (prevInScope > 0 && dropped > MAX_IN_SCOPE_DROP) {
    await repo.setState('listing_drop', { at: fetchedAt, previous: prevInScope, next: nextInScope, fetched: raw.length });
    log.error('listings.drop_guard', { previous: prevInScope, next: nextInScope });
    return { fetched: raw.length, inScope: nextInScope, removed: removed.length, applied: false, dropped, extraCalls };
  }

  await repo.upsertListings([...rows, ...removed]);
  await repo.setState('listings_synced_at', fetchedAt);
  if (dropped === 0) await repo.setState('listing_drop', null);
  log.info('listings.synced', { fetched: raw.length, in_scope: nextInScope, removed: removed.length, ...extraCalls });
  return { fetched: raw.length, inScope: nextInScope, removed: removed.length, applied: true, dropped, extraCalls };
}
