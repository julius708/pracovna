/**
 * Classification of Supabase auth errors, shared by the proxy, the server
 * client and the login action. Pure: no Next or Supabase imports.
 */
export interface AuthErrorLike {
  status?: number;
  code?: string;
  name?: string;
}

/** Supabase or the network is failing: an outage, not a statement about the session. */
export function isTransientAuthError(e: AuthErrorLike | null | undefined): boolean {
  if (!e) return false;
  return e.name === 'AuthRetryableFetchError' || !e.status || e.status >= 500;
}

export type LoginErrorKey = 'wrong' | 'tooMany' | 'offline' | 'failed';

/** Message key for a failed signInWithPassword; only a real credential error says "wrong password". */
export function loginErrorKey(e: AuthErrorLike): LoginErrorKey {
  if (e.status === 429 || e.code === 'over_request_rate_limit') return 'tooMany';
  if (e.code === 'invalid_credentials' || e.code === 'invalid_grant') return 'wrong';
  if (isTransientAuthError(e)) return 'offline';
  return 'failed';
}
