import { describe, expect, it } from 'vitest';
import { countTicked, emptyTicks, isTicked, parseTicks, serializeTicks, toggleTick, TICKS_MAX_AGE_MS } from '@/ui/ticks';

const NOW = 1_800_000_000_000;

describe('odfajkávanie čo treba zbaliť (len prehliadač)', () => {
  it('prepne značku a druhé ťuknutie ju zruší; pôvodný objekt sa nemení', () => {
    const a = emptyTicks();
    const b = toggleTick(a, 'c:toaletak', 3, NOW);
    expect(isTicked(b, 'c:toaletak', 3)).toBe(true);
    expect(isTicked(a, 'c:toaletak', 3)).toBe(false);
    const c = toggleTick(b, 'c:toaletak', 3, NOW);
    expect(isTicked(c, 'c:toaletak', 3)).toBe(false);
    expect(b.t).toEqual({ 'c:toaletak': 3 });
  });

  it('po zmene počtu (prepočet karty) je položka znova neodfajknutá', () => {
    const s = toggleTick(emptyTicks(), 'l:plachta', 2, NOW);
    expect(isTicked(s, 'l:plachta', 2)).toBe(true);
    expect(isTicked(s, 'l:plachta', 3)).toBe(false);
    // odfajknutie nového počtu prepíše starú značku
    expect(toggleTick(s, 'l:plachta', 3, NOW).t).toEqual({ 'l:plachta': 3 });
  });

  it('uloží a znovu načíta; počíta len položky s aktuálnym počtom', () => {
    let s = emptyTicks();
    s = toggleTick(s, 'a', 1, NOW);
    s = toggleTick(s, 'b', 2, NOW);
    const back = parseTicks(serializeTicks(s), NOW + 1000);
    expect(back.t).toEqual({ a: 1, b: 2 });
    expect(countTicked(back, [{ id: 'a', n: 1 }, { id: 'b', n: 5 }, { id: 'c', n: 1 }])).toBe(1);
  });

  it('poškodený, cudzí alebo starý zápis = prázdno (nikdy výnimka)', () => {
    for (const raw of [null, undefined, '', 'nie json', '{}', '[]', 'null', '{"at":"x","t":{}}', '{"at":1,"t":null}']) {
      expect(parseTicks(raw as string | null, NOW)).toEqual(emptyTicks());
    }
    const old = serializeTicks({ at: NOW - TICKS_MAX_AGE_MS - 1, t: { a: 1 } });
    expect(parseTicks(old, NOW)).toEqual(emptyTicks());
    const fresh = serializeTicks({ at: NOW - TICKS_MAX_AGE_MS + 1000, t: { a: 1 } });
    expect(parseTicks(fresh, NOW).t).toEqual({ a: 1 });
  });

  it('nečíselné počty v zápise sa zahodia', () => {
    const raw = JSON.stringify({ at: NOW, t: { a: 2, b: 'x', c: null } });
    expect(parseTicks(raw, NOW).t).toEqual({ a: 2 });
  });
});
