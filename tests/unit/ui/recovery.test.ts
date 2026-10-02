import { describe, expect, it } from 'vitest';
import { isRecoveryHash, recoveryError, recoveryTokens, safeNextPath } from '@/ui/recovery';

describe('recovery link helpers', () => {
  it('extracts both tokens of an implicit recovery link, nothing else', () => {
    expect(recoveryTokens('#access_token=abc&expires_in=3600&refresh_token=def&token_type=bearer&type=recovery')).toEqual({ access_token: 'abc', refresh_token: 'def' });
    expect(recoveryTokens('#access_token=abc&type=recovery')).toBeNull();
    expect(recoveryTokens('#access_token=abc&refresh_token=def&type=magiclink')).toBeNull();
    expect(recoveryTokens('')).toBeNull();
  });

  it('recognises an implicit recovery session in the fragment', () => {
    expect(isRecoveryHash('#access_token=abc&expires_in=3600&refresh_token=def&token_type=bearer&type=recovery')).toBe(true);
    expect(isRecoveryHash('access_token=abc&type=recovery')).toBe(true);
    expect(isRecoveryHash('#access_token=abc&type=magiclink')).toBe(false);
    expect(isRecoveryHash('#type=recovery')).toBe(false);
    expect(isRecoveryHash('')).toBe(false);
  });

  it('reports a failed link by its error code', () => {
    expect(recoveryError('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired')).toBe('otp_expired');
    expect(recoveryError('#error=access_denied')).toBe('access_denied');
    expect(recoveryError('#access_token=abc&type=recovery')).toBeNull();
    expect(recoveryError('')).toBeNull();
  });

  it('allows only same-origin paths as the post-callback destination', () => {
    expect(safeNextPath('/nove-heslo')).toBe('/nove-heslo');
    expect(safeNextPath('/historia?od=2026-10-01')).toBe('/historia?od=2026-10-01');
    expect(safeNextPath(null)).toBe('/');
    expect(safeNextPath('')).toBe('/');
    expect(safeNextPath('//evil.example')).toBe('/');
    expect(safeNextPath('/\\evil.example')).toBe('/');
    expect(safeNextPath('https://evil.example/')).toBe('/');
    expect(safeNextPath('javascript:alert(1)')).toBe('/');
    expect(safeNextPath('nove-heslo', '/x')).toBe('/x');
  });
});
