import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { isTransientAuthError } from '@/db/auth-errors';
import { createRetryingFetch } from '@/db/fetch-retry';

const PUBLIC = ['/login', '/nove-heslo', '/auth/', '/health', '/api/'];
const ADMIN = ['/nastavenia', '/historia', '/stav'];
const DEV_ROLE_COOKIE = 'pr-dev-role';

function isPublic(path: string) {
  return PUBLIC.some((p) => path === p || path.startsWith(p));
}

/**
 * Refreshes the Supabase session on every page request and redirects
 * anonymous visitors to /login. Without Supabase (seed mode) the development
 * role cookie plays the session.
 */
export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // an auth e-mail link that fell back to the Site URL (root or /login) is handed to the callback with its parameters
  const sp = request.nextUrl.searchParams;
  if ((path === '/' || path === '/login') && (sp.has('code') || (sp.has('token_hash') && sp.has('type')))) {
    const cb = new URL('/auth/callback', request.url);
    cb.search = request.nextUrl.search;
    if (!cb.searchParams.has('next')) cb.searchParams.set('next', '/nove-heslo');
    return NextResponse.redirect(cb);
  }
  // an expired or already used link reports its error as query parameters on the Site URL
  if ((path === '/' || path === '/login') && (sp.has('error_code') || sp.has('error_description'))) {
    return NextResponse.redirect(new URL('/login?chyba=link', request.url));
  }

  if (isPublic(path)) return NextResponse.next();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    const role = request.cookies.get(DEV_ROLE_COOKIE)?.value;
    if (!role) return NextResponse.redirect(new URL('/login', request.url));
    if (ADMIN.some((p) => path.startsWith(p)) && role !== 'admin') return NextResponse.redirect(new URL('/', request.url));
    return NextResponse.next();
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    global: { fetch: createRetryingFetch() },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      },
    },
  });
  const { data, error } = await supabase.auth.getClaims();
  // an outage is not "signed out": let the page report the error instead of showing the login form over a valid session
  if (isTransientAuthError(error)) return response;
  if (!data?.claims?.sub) {
    const login = new URL('/login', request.url);
    return NextResponse.redirect(login);
  }
  if (ADMIN.some((p) => path.startsWith(p))) {
    const { data: profile, error: profileError } = await supabase.from('profiles').select('role, active').eq('id', data.claims.sub).maybeSingle();
    if (profileError) return response;
    const p = profile as { role: string; active: boolean } | null;
    if (!p || !p.active || p.role !== 'admin') return NextResponse.redirect(new URL('/', request.url));
  }
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|assets/|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico|webp)$).*)'],
};
