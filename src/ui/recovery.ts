/**
 * Helpers for Supabase password-recovery links. Pure, shared by the login
 * page, the board and the /auth/callback route.
 *
 * Two link styles reach the app:
 *  - PKCE (links the app itself requested): `…/auth/callback?code=…&next=/nove-heslo`,
 *    exchanged on the server;
 *  - implicit (links sent from the Supabase dashboard): the session arrives in the
 *    URL fragment `#access_token=…&type=recovery` at the Site URL, which the
 *    browser keeps across the redirect to /login; the page forwards it to /nove-heslo.
 */
function fragmentParams(hash: string): URLSearchParams {
  return new URLSearchParams(hash.replace(/^#/, ''));
}

/** True when a recovery session sits in the URL fragment (implicit link). */
export function isRecoveryHash(hash: string): boolean {
  const p = fragmentParams(hash);
  return p.get('type') === 'recovery' && p.has('access_token');
}

export interface RecoveryTokens {
  access_token: string;
  refresh_token: string;
}

/**
 * Both tokens of an implicit recovery link, or null. The @supabase/ssr browser
 * client is PKCE-only and ignores such fragments, so the page sets the session
 * itself with these.
 */
export function recoveryTokens(hash: string): RecoveryTokens | null {
  const p = fragmentParams(hash);
  const access_token = p.get('access_token');
  const refresh_token = p.get('refresh_token');
  if (p.get('type') !== 'recovery' || !access_token || !refresh_token) return null;
  return { access_token, refresh_token };
}

/** The error code of a failed link in the fragment (e.g. otp_expired), or null. */
export function recoveryError(hash: string): string | null {
  const p = fragmentParams(hash);
  if (!p.has('error') && !p.has('error_code') && !p.has('error_description')) return null;
  return p.get('error_code') ?? p.get('error') ?? 'error';
}

/** Only same-origin absolute paths may be used as a post-callback destination. */
export function safeNextPath(next: string | null | undefined, fallback = '/'): string {
  if (!next) return fallback;
  if (!/^\/(?!\/)[\w\-./?=&%]*$/.test(next)) return fallback;
  if (next.includes('\\') || /^\/\/|^\/\\/.test(next)) return fallback;
  return next;
}
