import { describe, expect, it } from 'vitest';
import { isTransientAuthError, loginErrorKey } from '@/db/auth-errors';

describe('loginErrorKey', () => {
  it('says "wrong password" only for a real credential error', () => {
    expect(loginErrorKey({ status: 400, code: 'invalid_credentials', name: 'AuthApiError' })).toBe('wrong');
    expect(loginErrorKey({ status: 400, code: 'invalid_grant' })).toBe('wrong');
  });
  it('rate limits', () => {
    expect(loginErrorKey({ status: 429, code: 'over_request_rate_limit' })).toBe('tooMany');
    expect(loginErrorKey({ status: 429 })).toBe('tooMany');
  });
  it('outages are "offline", not a password problem', () => {
    expect(loginErrorKey({ status: 0, name: 'AuthRetryableFetchError' })).toBe('offline');
    expect(loginErrorKey({ status: 503 })).toBe('offline');
    expect(loginErrorKey({ name: 'AuthUnknownError' })).toBe('offline');
  });
  it('everything else is a generic failure (unconfirmed e-mail, banned user, disabled provider)', () => {
    expect(loginErrorKey({ status: 400, code: 'email_not_confirmed' })).toBe('failed');
    expect(loginErrorKey({ status: 403, code: 'user_banned' })).toBe('failed');
    expect(loginErrorKey({ status: 422, code: 'email_provider_disabled' })).toBe('failed');
  });
});

describe('isTransientAuthError', () => {
  it('network and 5xx errors are transient, 4xx answers are not', () => {
    expect(isTransientAuthError({ name: 'AuthRetryableFetchError', status: 0 })).toBe(true);
    expect(isTransientAuthError({ status: 502 })).toBe(true);
    expect(isTransientAuthError({ name: 'AuthUnknownError' })).toBe(true);
    expect(isTransientAuthError({ status: 401, code: 'bad_jwt' })).toBe(false);
    expect(isTransientAuthError({ status: 400, code: 'session_not_found' })).toBe(false);
    expect(isTransientAuthError(null)).toBe(false);
  });
});
