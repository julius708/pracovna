import type { IssueAlias, PackSnapshot } from './types';

export interface PlannedIssue {
  itemId: string;
  qty: number;
  kind: IssueAlias['kind'];
  /** Source rows that went into this item (for the audit). */
  sources: string[];
}
export interface UnmappedIssue {
  kind: IssueAlias['kind'];
  sourceKey: string;
  label: string;
  n: number;
  reason: string;
}
export interface IssuePlan {
  lines: PlannedIssue[];
  unmapped: UnmappedIssue[];
}

const keyOf = (kind: IssueAlias['kind'], sourceKey: string) => `${kind}\u0000${sourceKey}`;

/** consumable key, or linen "key|size": the size is part of the identity (never guessed). */
export const linenSourceKey = (l: { key: string; size?: string }) => (l.size ? `${l.key}|${l.size}` : l.key);

/**
 * What a packed card takes from the stock, computed from the snapshot stored in the
 * 'packed' event (not from recomputed needs). A row without an alias, a coffee row
 * with an unknown or unsure type, and a non-positive count end up in `unmapped`:
 * they are recorded for review, they never block packing and never deduct a guess.
 * The SQL function stock_issue_package computes the same plan; tests compare both.
 */
export function planIssue(snapshot: PackSnapshot, aliases: readonly IssueAlias[]): IssuePlan {
  const map = new Map(aliases.map((a) => [keyOf(a.kind, a.sourceKey), a]));
  const byItem = new Map<string, PlannedIssue>();
  const unmapped: UnmappedIssue[] = [];

  const add = (kind: IssueAlias['kind'], sourceKey: string, label: string, n: number, state?: string) => {
    if (!Number.isFinite(n) || n <= 0) return;
    if (state && state !== 'ok') return void unmapped.push({ kind, sourceKey, label, n, reason: 'druh nie je určený' });
    if (!sourceKey) return void unmapped.push({ kind, sourceKey, label, n, reason: 'druh nie je určený' });
    const alias = map.get(keyOf(kind, sourceKey));
    if (!alias) return void unmapped.push({ kind, sourceKey, label, n, reason: 'bez priradenia ku skladovej karte' });
    const cur = byItem.get(alias.itemId) ?? { itemId: alias.itemId, qty: 0, kind, sources: [] };
    cur.qty += n * alias.factor;
    cur.sources.push(sourceKey);
    byItem.set(alias.itemId, cur);
  };

  for (const c of snapshot.consumables ?? []) add('consumable', c.key, c.label ?? c.key, c.n);
  for (const c of snapshot.capsules ?? []) add('capsule', c.typeKey ?? '', c.type || 'kapsuly', c.n, c.state ?? 'ok');
  for (const l of snapshot.linen ?? []) add('linen', linenSourceKey(l), l.label ?? l.key, l.n);

  return { lines: [...byItem.values()].sort((a, b) => (a.itemId < b.itemId ? -1 : 1)), unmapped };
}

export interface IssueDelta {
  /** More is needed than was issued: this part is issued now. */
  extra: { itemId: string; qty: number }[];
  /** Less is needed than was issued: needs a confirmed physical return, never silent. */
  surplus: { itemId: string; qty: number }[];
}

/** Difference between what an open issue holds and what a repeated packing snapshot needs. */
export function issueDelta(held: readonly { itemId: string; qty: number }[], next: readonly { itemId: string; qty: number }[]): IssueDelta {
  const h = new Map(held.map((l) => [l.itemId, l.qty]));
  const n = new Map(next.map((l) => [l.itemId, l.qty]));
  const ids = [...new Set([...h.keys(), ...n.keys()])].sort();
  const extra: IssueDelta['extra'] = [];
  const surplus: IssueDelta['surplus'] = [];
  for (const id of ids) {
    const d = (n.get(id) ?? 0) - (h.get(id) ?? 0);
    if (d > 0) extra.push({ itemId: id, qty: d });
    else if (d < 0) surplus.push({ itemId: id, qty: -d });
  }
  return { extra, surplus };
}
