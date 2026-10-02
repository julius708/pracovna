'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { devLoginAction, forgotPasswordAction, loginAction } from '@/app/_lib/actions';
import { sk } from '@/core/i18n/sk';
import type { LoginErrorKey } from '@/db/auth-errors';
import { LogoMark } from './Header';
import { isRecoveryHash, recoveryError } from './recovery';

/** Every key loginAction can return has a text; the type keeps the two in sync. */
const ERRORS: Record<LoginErrorKey | 'deactivated' | 'link', string> = {
  wrong: sk.login.wrong,
  tooMany: sk.login.tooMany,
  deactivated: sk.login.deactivated,
  offline: sk.login.offline,
  failed: sk.login.failed,
  link: sk.login.link,
};

const FORGOT_ERRORS = { email: sk.login.emailRequired, tooMany: sk.login.tooMany, offline: sk.login.offline, failed: sk.login.sendFailed } as const;

export function LoginForm({ devAllowed, notice = null }: { devAllowed: boolean; notice?: 'link' | null }) {
  const [state, action, pending] = useActionState(loginAction, { error: null });
  const [forgot, forgotAction, forgotPending] = useActionState(forgotPasswordAction, { sent: false, error: null });
  const [mode, setMode] = useState<'login' | 'forgot'>('login');
  const [linkError, setLinkError] = useState<boolean>(notice === 'link');
  const router = useRouter();

  // a recovery link sent from the Supabase dashboard lands on the site root with the session in the fragment
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash) return;
    if (isRecoveryHash(hash)) {
      router.replace(`/nove-heslo${hash}`);
      return;
    }
    if (recoveryError(hash)) {
      const t = setTimeout(() => setLinkError(true), 0);
      window.history.replaceState(null, '', window.location.pathname);
      return () => clearTimeout(t);
    }
  }, [router]);

  const error = state.error ? (ERRORS[state.error as keyof typeof ERRORS] ?? sk.login.failed) : linkError ? sk.login.link : null;

  return (
    <div className="wrap">
      <div className="login-card">
        <h1 style={{ margin: '0 0 16px', fontFamily: 'var(--display)', fontWeight: 800, fontSize: 26, display: 'flex', alignItems: 'center', gap: 10 }}>
          <LogoMark />
          <span className="sep" aria-hidden="true" style={{ width: 1, height: 26, background: 'var(--line)' }} />
          {sk.app}
        </h1>
        {devAllowed ? (
          <>
            <p style={{ color: 'var(--muted)', fontSize: 14 }}>Skúšobný režim bez databázy. Vyber si rolu:</p>
            <div className="actions">
              <form action={devLoginAction.bind(null, 'admin')}>
                <button className="btn primary" type="submit">
                  Test správca
                </button>
              </form>
              <form action={devLoginAction.bind(null, 'staff')}>
                <button className="btn ghost" type="submit" style={{ minHeight: 54 }}>
                  Test personál
                </button>
              </form>
            </div>
          </>
        ) : mode === 'login' ? (
          <form action={action}>
            <div className="form-row">
              <label htmlFor="email">E-mail</label>
              <input id="email" name="email" type="email" autoComplete="username" inputMode="email" required />
            </div>
            <div className="form-row">
              <label htmlFor="password">Heslo</label>
              <input id="password" name="password" type="password" autoComplete="current-password" required minLength={8} />
            </div>
            {error && (
              <div className="note" role="alert">
                {error}
              </div>
            )}
            <div className="actions">
              <button className="btn primary" type="submit" disabled={pending}>
                {sk.buttons.login}
              </button>
            </div>
            <button
              type="button"
              onClick={() => setMode('forgot')}
              style={{ background: 'none', border: 0, padding: '0 4px', marginTop: 16, minHeight: 44, color: 'var(--accent)', fontWeight: 600, fontSize: 14 }}
            >
              {sk.login.forgot}
            </button>
          </form>
        ) : (
          <form action={forgotAction}>
            <p style={{ color: 'var(--muted)', fontSize: 14 }}>{sk.login.forgotHint}</p>
            <div className="form-row">
              <label htmlFor="forgot-email">E-mail</label>
              <input id="forgot-email" name="email" type="email" autoComplete="username" inputMode="email" required />
            </div>
            {forgot.sent && (
              <div className="note" role="status" style={{ background: 'var(--ok-bg)' }}>
                {sk.login.linkSent}
              </div>
            )}
            {forgot.error && (
              <div className="note" role="alert">
                {FORGOT_ERRORS[forgot.error]}
              </div>
            )}
            <div className="actions">
              <button className="btn primary" type="submit" disabled={forgotPending || forgot.sent}>
                {sk.login.sendLink}
              </button>
            </div>
            <button
              type="button"
              onClick={() => setMode('login')}
              style={{ background: 'none', border: 0, padding: '0 4px', marginTop: 16, minHeight: 44, color: 'var(--accent)', fontWeight: 600, fontSize: 14 }}
            >
              {sk.login.back}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
