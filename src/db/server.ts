import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { env } from '@/env';
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

/** The signed-in user's profile, or null. Verifies the token signature (getClaims), never trusts getSession. */
export async function currentProfile(): Promise<ProfileRow | null> {
  const db = await createServerSupabase();
  if (!db) return null;
  const { data: claims } = await db.auth.getClaims();
  const sub = claims?.claims?.sub;
  if (!sub) return null;
  const { data } = await db.from('profiles').select('*').eq('id', sub).maybeSingle();
  return (data as ProfileRow | null) ?? null;
}
