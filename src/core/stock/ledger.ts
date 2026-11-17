import type { Movement } from './types';

export interface OnHand {
  qty: number;
  /** Instant of the first approved count; movements before it are never counted. */
  baselineAt: string | null;
  /** false = no opening balance yet: the quantity is not a known stock. */
  verified: boolean;
  /** Stock below zero is shown and audited, never blocked. */
  negative: boolean;
}

/**
 * Stock of an item = sum of ledger movements from the baseline on. The baseline is
 * the earliest 'opening_balance' (the approved first inventory); older movements
 * (issues before the count was taken) are ignored, so they are never counted twice.
 */
export function onHand(movements: readonly Movement[], itemId: string, warehouseId?: string): OnHand {
  const rows = movements.filter((m) => m.itemId === itemId && (!warehouseId || m.warehouseId === warehouseId));
  const openings = rows.filter((m) => m.kind === 'opening_balance').map((m) => m.at).sort();
  const baselineAt = openings[0] ?? null;
  if (!baselineAt) return { qty: 0, baselineAt: null, verified: false, negative: false };
  const qty = rows.filter((m) => m.at >= baselineAt).reduce((s, m) => s + m.qty, 0);
  return { qty, baselineAt, verified: true, negative: qty < 0 };
}

/** Stock at a given instant (used for the expected quantity when an inventory is closed). */
export function onHandAt(movements: readonly Movement[], itemId: string, warehouseId: string, at: string): number {
  return onHand(movements.filter((m) => m.at <= at), itemId, warehouseId).qty;
}

/**
 * A manual movement dated before the last closed inventory cut cannot rewrite the
 * counted past: it is booked at the cut and keeps its stated time in the note.
 */
export function bookingTime(requestedAt: string, lastCutAt: string | null): { at: string; shifted: boolean } {
  if (lastCutAt && requestedAt < lastCutAt) return { at: lastCutAt, shifted: true };
  return { at: requestedAt, shifted: false };
}

export interface CountedLine {
  itemId: string;
  warehouseId: string;
  state: 'unset' | 'zero' | 'counted' | 'unverified' | 'invalid';
  total?: number;
}

export interface CloseResult {
  ok: boolean;
  blockers: { itemId: string; reason: string }[];
  /** inventory_difference (or opening_balance for a first count) per counted line. */
  differences: { itemId: string; warehouseId: string; kind: 'opening_balance' | 'inventory_difference'; qty: number; expected: number; counted: number }[];
  /** Lines left empty: they are not counted as zero and produce no movement. */
  skipped: { itemId: string; warehouseId: string }[];
}

/**
 * Closing an inventory at `cutAt`: counted total vs the expected stock at that instant.
 * A line that is unverified or invalid blocks closing; an empty line is skipped (never 0).
 * The first count of an item is its opening balance; later counts book only the difference.
 */
export function closeInventory(lines: readonly CountedLine[], movements: readonly Movement[], cutAt: string): CloseResult {
  const blockers: CloseResult['blockers'] = [];
  const differences: CloseResult['differences'] = [];
  const skipped: CloseResult['skipped'] = [];
  for (const l of lines) {
    if (l.state === 'unset') {
      skipped.push({ itemId: l.itemId, warehouseId: l.warehouseId });
      continue;
    }
    if (l.state === 'unverified' || l.state === 'invalid' || l.total === undefined) {
      blockers.push({ itemId: l.itemId, reason: l.state === 'invalid' ? 'neplatné množstvo' : 'neoverený prepočet balení' });
      continue;
    }
    const base = onHand(movements.filter((m) => m.at <= cutAt), l.itemId, l.warehouseId);
    if (!base.verified) {
      differences.push({ itemId: l.itemId, warehouseId: l.warehouseId, kind: 'opening_balance', qty: l.total, expected: 0, counted: l.total });
    } else if (l.total !== base.qty) {
      differences.push({ itemId: l.itemId, warehouseId: l.warehouseId, kind: 'inventory_difference', qty: l.total - base.qty, expected: base.qty, counted: l.total });
    }
  }
  return { ok: blockers.length === 0, blockers, differences, skipped };
}
