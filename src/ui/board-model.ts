/**
 * Pure derivations for the board (no React): which cards a day shows, the
 * counts, the summary totals and the sort order. Unit-tested.
 */
import { DEFAULT_ITEMS, type CapsuleLine, type LineItem, type PackingResult } from '@/core/packing';
import type { BoardNote, BoardPackage } from '@/app/_lib/board';
import { sk } from '@/core/i18n/sk';

export type Filter = 'todo' | 'packed' | 'all';

export const FILTER_KEYS: Filter[] = ['todo', 'packed', 'all'];

/** Cards of a day: cancelled ones only when they are still visible (were packed). */
export function dayJobs(packages: BoardPackage[], date: string): BoardPackage[] {
  return packages.filter((p) => p.date === date && !p.hidden);
}

/** Active (non-cancelled) cards of a day. */
export function activeJobs(jobs: BoardPackage[]): BoardPackage[] {
  return jobs.filter((p) => p.status !== 'cancelled');
}

export interface Counts {
  todo: number;
  packed: number;
  cancelled: number;
  total: number;
}

export function counts(jobs: BoardPackage[]): Counts {
  const c = { todo: 0, packed: 0, cancelled: 0, total: 0 };
  for (const p of jobs) {
    if (p.status === 'todo') c.todo++;
    else if (p.status === 'packed') c.packed++;
    else c.cancelled++;
  }
  c.total = c.todo + c.packed;
  return c;
}

export interface CleanerOption {
  key: string;
  label: string;
  n: number;
}

export const CLEANER_NONE = '_none';

/** Cleaning-company chips for a day; empty when no card has a company. */
export function cleanerOptions(jobs: BoardPackage[], cleaners: Record<string, string | null>, labels: { all: string; none: string }): CleanerOption[] {
  const names = [...new Set(jobs.map((j) => cleaners[j.listing_id]).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b, 'sk'));
  if (!names.length) return [];
  const out: CleanerOption[] = [{ key: '', label: labels.all, n: jobs.length }];
  for (const c of names) out.push({ key: c, label: c, n: jobs.filter((j) => cleaners[j.listing_id] === c).length });
  const none = jobs.filter((j) => !cleaners[j.listing_id]).length;
  if (none) out.push({ key: CLEANER_NONE, label: labels.none, n: none });
  return out;
}

export function applyCleaner(jobs: BoardPackage[], cleaners: Record<string, string | null>, cleaner: string): BoardPackage[] {
  if (!cleaner) return jobs;
  if (cleaner === CLEANER_NONE) return jobs.filter((j) => !cleaners[j.listing_id]);
  return jobs.filter((j) => cleaners[j.listing_id] === cleaner);
}

export interface SummaryLine {
  id: string;
  label: string;
  size: string;
  /** Remaining = sum over cards still to pack. */
  rem: number;
  /** Whole day = sum over to-pack and packed cards. */
  all: number;
  consumable: boolean;
  photo: string | null;
  /** Red note for capsule rows without a type. */
  note: string | null;
  source: 'calc' | 'guesty';
}

/** Totals of the day's active cards, linen first, consumables after, in card order. */
export function summaryLines(jobs: BoardPackage[], capsuleTexts: { generic: string; typed: (t: string) => string; unsure: string; missing: string }): SummaryLine[] {
  const lines = new Map<string, SummaryLine>();
  const add = (id: string, make: () => Omit<SummaryLine, 'rem' | 'all' | 'id'>, n: number, todo: boolean) => {
    let l = lines.get(id);
    if (!l) {
      l = { id, rem: 0, all: 0, ...make() };
      lines.set(id, l);
    }
    l.all += n;
    if (todo) l.rem += n;
  };
  for (const p of activeJobs(jobs)) {
    const r = p.computed_items as PackingResult;
    const todo = p.status === 'todo';
    for (const l of r.linen as LineItem[]) add(l.key, () => ({ label: l.label, size: l.size, consumable: false, photo: null, note: null, source: l.source }), l.n, todo);
    for (const l of r.consumables as LineItem[]) add(l.key, () => ({ label: l.label, size: l.size, consumable: true, photo: null, note: null, source: l.source }), l.n, todo);
    for (const c of r.capsules as CapsuleLine[]) {
      const id = c.state === 'ok' ? `kapsule|${c.typeKey}` : `kapsule|${c.state}`;
      add(
        id,
        () => ({
          label: c.state === 'ok' ? capsuleTexts.typed(c.type) : capsuleTexts.generic,
          size: '',
          consumable: true,
          photo: c.photo,
          note: c.state === 'unsure' ? capsuleTexts.unsure : c.state === 'missing' ? capsuleTexts.missing : null,
          source: c.fixed ? 'guesty' : 'calc',
        }),
        c.n,
        todo,
      );
    }
  }
  // tiles follow the linen-table order, capsules come last
  const order = new Map(DEFAULT_ITEMS.map((it, i) => [it.key, i]));
  const rank = (l: SummaryLine) => (l.id.startsWith('kapsule|') ? 1000 : (order.get(l.id) ?? 500));
  const out = [...lines.values()].sort((a, b) => rank(a) - rank(b));
  return [...out.filter((l) => !l.consumable), ...out.filter((l) => l.consumable)];
}

/** Numbers for Angelika's sentence (to-pack cards only, as in the prototype). */
export function angelikaNumbers(jobs: BoardPackage[]): { total: number; todo: number; rush: number; kids: number } {
  const active = activeJobs(jobs);
  const todo = active.filter((p) => p.status === 'todo');
  return {
    total: active.length,
    todo: todo.length,
    rush: todo.filter((p) => p.same_day).length,
    kids: todo.filter((p) => {
      const n = (p.computed_items as PackingResult).next;
      return !!n && (n.children > 0 || n.infants > 0);
    }).length,
  };
}

const ORDER: Record<string, number> = { todo: 0, packed: 1, cancelled: 2 };

/**
 * Cards to show for a filter: just-packed cards (`keep`) stay in "Na balenie" in
 * place; order is not-packed first, then alphabetical with Slovak collation.
 */
export function visibleJobs(jobs: BoardPackage[], filter: Filter, keep: Set<string>): BoardPackage[] {
  const shown = jobs.filter((j) => {
    if (filter === 'all') return true;
    if (filter === 'todo') return j.status === 'todo' || keep.has(j.id);
    return j.status === 'packed';
  });
  const rank = (j: BoardPackage) => (filter === 'todo' && keep.has(j.id) ? 0 : ORDER[j.status] ?? 3);
  return shown.sort((a, b) => rank(a) - rank(b) || a.listing_name.localeCompare(b.listing_name, 'sk'));
}

/** Header sync text: red when the last successful sync is older than 30 minutes. */
export function syncState(lastOkSyncAt: string | null, now: Date): { stale: boolean; ageMinutes: number | null } {
  if (!lastOkSyncAt) return { stale: false, ageMinutes: null };
  const age = (now.getTime() - Date.parse(lastOkSyncAt)) / 60_000;
  return { stale: age > 30, ageMinutes: Math.max(0, Math.round(age)) };
}

/* ---------------- change notices ---------------- */

/**
 * What changed between two reads of the board, for the notices every device
 * shows: packages that appeared, were cancelled or recomputed by the sync, and
 * packs or undos done by someone else. `ownIds` are packages this device just
 * changed itself (optimistic patches), which produce no notice. More than three
 * changes collapse into one line.
 */
export function boardNotices(prev: BoardPackage[], next: BoardPackage[], myName: string, ownIds: Set<string>, dayLabelOf: (date: BoardPackage['date']) => string): string[] {
  if (prev.length === 0) return [];
  const before = new Map(prev.map((p) => [p.id, p]));
  const out: string[] = [];
  let guestyChanges = 0;
  for (const n of next) {
    if (n.hidden) continue;
    const b = before.get(n.id);
    if (!b) {
      if (n.status !== 'cancelled') {
        out.push(sk.notices.newPackage(n.listing_name, dayLabelOf(n.date)));
        guestyChanges++;
      }
      continue;
    }
    if (b.status !== 'cancelled' && n.status === 'cancelled') {
      out.push(sk.notices.cancelled(n.listing_name));
      guestyChanges++;
      continue;
    }
    if (!ownIds.has(n.id)) {
      if (b.status === 'todo' && n.status === 'packed' && n.packed_by_name && n.packed_by_name !== myName) out.push(sk.notices.packedBy(n.packed_by_name, n.listing_name));
      else if (b.status === 'packed' && n.status === 'todo') out.push(sk.notices.unpacked(n.listing_name));
    }
    if (b.computed_hash !== n.computed_hash) {
      out.push(sk.notices.changed(n.listing_name));
      guestyChanges++;
    }
  }
  if (out.length > 3 && guestyChanges > 0) {
    const staff = out.filter((t) => !t.startsWith('Nový balíček') && !t.startsWith('Zmena z Guesty') && !t.startsWith('Zrušené'));
    return [sk.notices.many(guestyChanges), ...staff.slice(0, 2)];
  }
  return out.slice(0, 3);
}

/** Notices for notice-board notes that appeared since the last read and were written by someone else, with their day. */
export function noteNotices(prev: BoardNote[], next: BoardNote[], myName: string, dayLabelOf: (date: BoardNote['date']) => string): string[] {
  const before = new Map(prev.map((n) => [n.id, n]));
  const out: string[] = [];
  for (const n of next) {
    if (n.author_name === myName) continue;
    const was = before.get(n.id);
    if (!was) out.push(sk.notices.newNote(n.author_name, dayLabelOf(n.date)));
    else if (was.text !== n.text) out.push(sk.notices.editedNote(n.author_name, dayLabelOf(n.date)));
  }
  return out;
}
