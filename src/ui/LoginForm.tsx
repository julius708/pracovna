'use client';

import { useActionState } from 'react';
import { devLoginAction, loginAction } from '@/app/_lib/actions';
import { sk } from '@/core/i18n/sk';
import { LogoMark } from './Header';

const ERRORS: Record<string, string> = {
  wrong: sk.login.wrong,
  tooMany: sk.login.tooMany,
  deactivated: sk.login.deactivated,
  offline: sk.login.offline,
};

export function LoginForm({ devAllowed }: { devAllowed: boolean }) {
  const [state, action, pending] = useActionState(loginAction, { error: null });
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
        ) : (
          <form action={action}>
            <div className="form-row">
              <label htmlFor="email">E-mail</label>
              <input id="email" name="email" type="email" autoComplete="username" inputMode="email" required />
            </div>
            <div className="form-row">
              <label htmlFor="password">Heslo</label>
              <input id="password" name="password" type="password" autoComplete="current-password" required minLength={8} />
            </div>
            {state.error && (
              <div className="note" role="alert">
                {ERRORS[state.error] ?? sk.login.wrong}
              </div>
            )}
            <div className="actions">
              <button className="btn primary" type="submit" disabled={pending}>
                {sk.buttons.login}
              </button>
            </div>
            <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 16 }}>Zabudnuté heslo? Napíš Júliusovi.</p>
          </form>
        )}
      </div>
    </div>
  );
}
