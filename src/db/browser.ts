'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

/** Browser Supabase client (anon key + the user's cookies), or null when not configured. */
export function getBrowserSupabase(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  // URL detection off: PKCE codes are exchanged on the server (/auth/callback) and the recovery
  // fragment is consumed by /nove-heslo itself; auth-js would otherwise swallow an init error on such URLs
  client = client ?? createBrowserClient(url, key, { auth: { detectSessionInUrl: false } });
  return client;
}
