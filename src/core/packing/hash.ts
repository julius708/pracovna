/** Stable JSON (sorted keys) so equal results hash equally regardless of key order. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

/** FNV-1a 32-bit with a custom offset basis, as 8 hex chars. */
function fnv1a32(s: string, basis: number): string {
  let h = basis >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * 64 bits of hash as 16 hex chars: two independent FNV-1a 32-bit passes.
 * Only for change detection, not security.
 */
export function fnv1a64(s: string): string {
  return fnv1a32(s, 0x811c9dc5) + fnv1a32(s, 0x9747b28c);
}

/** Hash of any JSON-like value with stable key order. */
export function hashOf(value: unknown): string {
  return fnv1a64(stableStringify(value));
}
