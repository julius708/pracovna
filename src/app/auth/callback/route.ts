import { NextResponse } from 'next/server';
import { BASE } from '@/lib/base';
import { createServerSupabase } from '@/db/server';
import { safeNextPath } from '@/ui/recovery';

export const dynamic = 'force-dynamic';

/**
 * Lands e-mail links from Supabase Auth.
 *  - `token_hash` + `type=recovery`: the device-independent form produced by the
 *    recommended "Reset Password" e-mail template; verified with verifyOtp, no cookie needed.
 *  - `code`: a PKCE link; exchanged with the verifier cookie of the browser that asked for it.
 * Only recovery links are accepted (the app sends no other kind), so a token can
 * never sign someone into another account through a magic link. On success the
 * session cookies are set and a recovery continues to /nove-heslo; otherwise back
 * to the login page with a notice.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  let next = safeNextPath(url.searchParams.get('next'), '/');
  const code = url.searchParams.get('code');
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type');
  const db = await createServerSupabase();
  let ok = false;
  if (db && tokenHash && type === 'recovery') {
    ok = !(await db.auth.verifyOtp({ type: 'recovery', token_hash: tokenHash })).error;
    if (ok) next = '/nove-heslo';
  } else if (db && code) {
    const { data, error } = await db.auth.exchangeCodeForSession(code);
    ok = !error;
    if (ok && (data as { redirectType?: string | null }).redirectType === 'recovery') next = '/nove-heslo';
  }
  // relatívne presmerovanie s prefixom: ostaneme na doméne, z ktorej odkaz prišiel
  return new NextResponse(null, { status: 303, headers: { Location: `${BASE}${ok ? next : '/login?chyba=link'}` } });
}
