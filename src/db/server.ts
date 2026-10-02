import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { env } from '@/env';
import { isTransientAuthError } from './auth-errors';
import type { ProfileRow } from './types';

/** Supabase client bound to the request's auth cookies (server components, route handlers). */
export async function createServerSupabase() {
  const e = env();
  if (!e.NEXT_PUBLIC_SUPABASE_URL || !e.NEXT_PUBLIC_SUPABASE_ANON_KEY) return null;
  const cookieStore = await cookies();
  return createServerClient(e.NEXT_PUBLIC_SUPABASE_URL, e.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) cookieStore.set(name, value, options);
        } catch {
          // called from a server component: the proxy refreshes the session instead
        }
      },
    },
  });
}

/**
 * The signed-in user's profile, or null when there is no session or no row.
 * Verifies the token signature (getClaims), never trusts getSession. An outage
 * (network, 5xx) throws instead, so callers never mistake it for "signed out".
 */
export async function currentProfile(): Promise<ProfileRow | null> {
  const db = await createServerSupabase();
  if (!db) return null;
  const { data: claims, error: claimsError } = await db.auth.getClaims();
  if (isTransientAuthError(claimsError)) throw claimsError;
  const sub = claims?.claims?.sub;
  if (!sub) return null;
  const { data, error } = await db.from('profiles').select('*').eq('id', sub).maybeSingle();
  if (error) throw new Error(`profiles: ${error.message}`);
  return (data as ProfileRow | null) ?? null;
}
