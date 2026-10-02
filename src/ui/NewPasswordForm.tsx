'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { sk } from '@/core/i18n/sk';
import { getBrowserSupabase } from '@/db/browser';
import { LogoMark } from './Header';
import { recoveryTokens } from './recovery';

type State = 'checking' | 'ready' | 'invalid' | 'saving' | 'done';

/**
 * The recovery session arrives either in cookies (set by /auth/callback for
 * token-hash and PKCE links) or in the URL fragment (implicit links). The
 * browser client is PKCE-only and ignores fragments, so the page reads the
 * tokens itself, drops them from the URL and calls setSession, which verifies
 * the access token with Supabase. The account's e-mail is shown so nobody sets
 * a password on a stranger's account by mistake.
 */
export function NewPasswordForm() {
  const [state, setState] = useState<State>(() => (getBrowserSupabase() ? 'checking' : 'invalid'));
  const [email, setEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    const supabase = getBrowserSupabase();
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      const tokens = recoveryTokens(window.location.hash);
      if (tokens) window.history.replaceState(null, '', window.location.pathname);
      const result = tokens ? await supabase.auth.setSession(tokens) : await supabase.auth.getSession();
      if (cancelled) return;
      const session = result.error ? null : result.data.session;
      if (!session) {
        setState('invalid');
        return;
      }
      setEmail(session.user.email ?? null);
      setState('ready');
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const p1 = String(form.get('password') ?? '');
    const p2 = String(form.get('again') ?? '');
    if (p1.length < 8) return setError(sk.recovery.tooShort);
    if (p1 !== p2) return setError(sk.recovery.mismatch);
    const supabase = getBrowserSupabase();
    if (!supabase) return setError(sk.recovery.failed);
    setError(null);
    setState('saving');
    const { error: err } = await supabase.auth.updateUser({ password: p1 });
    if (err) {
      setError(/different|same/i.test(err.message) ? sk.recovery.same : sk.recovery.failed);
      setState('ready');
      return;
    }
    setState('done');
    router.replace('/');
    router.refresh();
  };

  return (
    <div className="wrap">
      <div className="login-card">
        <h1 style={{ margin: '0 0 16px', fontFamily: 'var(--display)', fontWeight: 800, fontSize: 26, display: 'flex', alignItems: 'center', gap: 10 }}>
          <LogoMark />
          <span className="sep" aria-hidden="true" style={{ width: 1, height: 26, background: 'var(--line)' }} />
          {sk.recovery.title}
        </h1>
        {state === 'checking' && <p style={{ color: 'var(--muted)' }}>{sk.recovery.checking}</p>}
        {state === 'invalid' && (
          <>
            <div className="note" role="alert">
              {sk.recovery.invalid}
            </div>
            <div className="actions">
              <Link className="btn ghost" href="/login" style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center' }}>
                {sk.recovery.toLogin}
              </Link>
            </div>
          </>
        )}
        {state === 'done' && <p role="status">{sk.recovery.saved}</p>}
        {(state === 'ready' || state === 'saving') && (
          <form onSubmit={submit}>
            {email && (
              <p style={{ color: 'var(--muted)', fontSize: 14 }}>
                {sk.recovery.forAccount} <b style={{ color: 'var(--ink)' }}>{email}</b>.
              </p>
            )}
            <div className="form-row">
              <label htmlFor="password">{sk.recovery.password}</label>
              <input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} />
            </div>
            <div className="form-row">
              <label htmlFor="again">{sk.recovery.again}</label>
              <input id="again" name="again" type="password" autoComplete="new-password" required minLength={8} />
            </div>
            {error && (
              <div className="note" role="alert">
                {error}
              </div>
            )}
            <div className="actions">
              <button className="btn primary" type="submit" disabled={state === 'saving'}>
                {sk.recovery.save}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
