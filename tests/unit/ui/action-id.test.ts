import { afterEach, describe, expect, it, vi } from 'vitest';
import { newActionId } from '@/ui/action-id';

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('newActionId', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is a v4 UUID and unique', () => {
    const ids = new Set(Array.from({ length: 200 }, () => newActionId()));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(V4);
  });

  it('falls back to getRandomValues when randomUUID is missing (http:// LAN origin)', () => {
    const real = globalThis.crypto;
    vi.stubGlobal('crypto', { getRandomValues: (b: Uint8Array) => real.getRandomValues(b) });
    const a = newActionId();
    const b = newActionId();
    expect(a).toMatch(V4);
    expect(b).toMatch(V4);
    expect(a).not.toBe(b);
  });

  it('still produces a v4 shape without any crypto object', () => {
    vi.stubGlobal('crypto', undefined);
    expect(newActionId()).toMatch(V4);
  });
});
