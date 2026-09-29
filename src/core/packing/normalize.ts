/** Text helpers shared by the parser, the scope rules and the capsule matching. */

/** Removes diacritics: "Paplón veľký" -> "Paplon velky". */
export function stripDiacritics(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Diacritics-free, lower-case, underscores to spaces, collapsed whitespace. */
export function norm(s: string | null | undefined): string {
  return stripDiacritics(String(s ?? ''))
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Typographic apostrophes and accents become a plain apostrophe ("L’OR" -> "L'OR"). */
export function normApostrophes(s: string): string {
  return s.replace(/[‘’‛ʼ`´]/g, "'");
}

/** Key used to group capsule types: normalised text with plain apostrophes. */
export function typeKey(s: string | null | undefined): string {
  return norm(normApostrophes(String(s ?? '')));
}

/** First integer in a string ("2 (+1 rezerva)" -> 2), or null. */
export function firstInt(s: string | null | undefined): number | null {
  const m = /\d+/.exec(String(s ?? ''));
  return m ? parseInt(m[0], 10) : null;
}

/** Splits a list value on ";" or "," and trims the parts. */
export function splitList(s: string): string[] {
  return s
    .split(/[;,]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/** De-duplicates trimmed non-empty strings, keeping order. */
export function uniqueStrings(items: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const s = String(raw ?? '').trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}
