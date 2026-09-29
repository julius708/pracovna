import { CITY_MATCH, EXCLUDED_NICKNAME_PREFIX, OWNER_CLEANS_IDS, OWNER_CLEANS_TAG } from './constants';
import { norm } from './normalize';
import { textSaysOwnerCleans } from './parser';

export type ExclusionReason = 'inactive' | 'city' | 'prefix' | 'owner_id' | 'owner_tag' | 'owner_text';

export interface ScopeInput {
  guestyId: string;
  nickname: string | null | undefined;
  city: string | null | undefined;
  active: boolean | null | undefined;
  tags?: readonly string[] | null;
  laundryRaw?: string | null;
}

export interface ScopeResult {
  inScope: boolean;
  reason: ExclusionReason | null;
}

/**
 * Which listings belong to the Bratislava laundry.
 * Order of checks = order of the reasons reported.
 */
export function listingScope(l: ScopeInput): ScopeResult {
  if (l.active === false) return { inScope: false, reason: 'inactive' };
  if (!norm(l.city).includes(CITY_MATCH)) return { inScope: false, reason: 'city' };
  if (EXCLUDED_NICKNAME_PREFIX.test(String(l.nickname ?? ''))) return { inScope: false, reason: 'prefix' };
  if (OWNER_CLEANS_IDS.has(l.guestyId)) return { inScope: false, reason: 'owner_id' };
  if ((l.tags ?? []).some((t) => norm(t).includes(OWNER_CLEANS_TAG))) return { inScope: false, reason: 'owner_tag' };
  if (textSaysOwnerCleans(l.laundryRaw)) return { inScope: false, reason: 'owner_text' };
  return { inScope: true, reason: null };
}

/** Display name = nickname, title as fallback. */
export function listingDisplayName(nickname: string | null | undefined, title: string | null | undefined): string {
  return String(nickname ?? '').trim() || String(title ?? '').trim();
}
