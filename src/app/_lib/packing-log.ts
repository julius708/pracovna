import { DEFAULT_ITEMS, type CapsuleLine, type LineItem, type PackingResult, type Ymd } from '@/core/packing';
import { capsuleLabel } from '@/core/i18n/sk';
import type { PackageStatus } from '@/db/types';

/**
 * What a "packed" audit event records (migration 0011): the card as it was at
 * the moment of packing. Pure helpers, shared by the in-memory RPC, the
 * "Zabalené balíčky" page and its CSV export.
 */
export interface PackSnapshot {
  people: number;
  linen: LineItem[];
  consumables: LineItem[];
  capsules: CapsuleLine[];
  private: boolean;
}

/** One row of the packing history. */
export interface PackingLogRow {
  id: number;
  package_id: string;
  package_date: Ymd;
  listing_id: string;
  listing_name: string;
  actor_name: string;
  /** When it was packed (ISO instant). */
  created_at: string;
  /** The counts as packed; null when neither the event nor the package has them. */
  snapshot: PackSnapshot | null;
  /** True when the counts come from the event itself (migration 0011); false = the package's current counts stand in. */
  exact: boolean;
  /** The package's status now: still packed, or 'todo' (unpacked since) / 'cancelled'; null when the package is gone. */
  status: PackageStatus | null;
  /** The package was unpacked and packed again after this event (a later "packed" row exists). */
  superseded: boolean;
  /** The staff note on the card ("chýba 1 osuška"): something still to bring to the flat; empty when none. */
  note: string;
  note_by_name: string | null;
}

/** A "Dôležité info" note shown under its day in the packing history (owner, 2026-10-19). */
export interface PackingDayNote {
  id: string;
  text: string;
  author_name: string;
  created_at: string;
  /** Set on a reply: the note it answers. */
  parent_id: string | null;
}

/** The day's notes in reading order: each note, then its replies (oldest first); replies to a removed note are left out. */
export function threadDayNotes(notes: PackingDayNote[]): { note: PackingDayNote; reply: boolean }[] {
  const byTime = [...notes].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const out: { note: PackingDayNote; reply: boolean }[] = [];
  for (const n of byTime) {
    if (n.parent_id) continue;
    out.push({ note: n, reply: false });
    for (const r of byTime) if (r.parent_id === n.id) out.push({ note: r, reply: true });
  }
  return out;
}

/** The snapshot the pack RPC stores, from the package row. */
export function packSnapshot(targetPeople: number, items: PackingResult | null | undefined): PackSnapshot {
  return {
    people: targetPeople,
    linen: [...(items?.linen ?? [])],
    consumables: [...(items?.consumables ?? [])],
    capsules: [...(items?.capsules ?? [])],
    private: !!items?.private,
  };
}

/** Does the event data hold the snapshot (events since migration 0011)? */
export function hasSnapshot(d: unknown): d is PackSnapshot {
  return !!d && typeof d === 'object' && Array.isArray((d as PackSnapshot).linen) && Array.isArray((d as PackSnapshot).consumables);
}
const isSnapshot = hasSnapshot;

/**
 * The event is superseded when the package was packed again later: its
 * packed_at is clearly after this event (the two timestamps of one packing
 * differ by milliseconds).
 */
export function isSuperseded(eventCreatedAt: string, packedAt: string | null | undefined): boolean {
  if (!packedAt) return false;
  const a = Date.parse(eventCreatedAt);
  const b = Date.parse(packedAt);
  return Number.isFinite(a) && Number.isFinite(b) && b - a > 60_000;
}

/**
 * The snapshot of a packed event. Events from before migration 0011 have empty
 * data; they fall back to the package's current counts (its last recompute),
 * which for past days is what was packed.
 */
export function snapshotOf(data: unknown, fallback: { target_people: number; computed_items: PackingResult } | null | undefined): PackSnapshot | null {
  if (isSnapshot(data)) {
    const d = data as Partial<PackSnapshot> & Pick<PackSnapshot, 'linen' | 'consumables'>;
    return { people: Number(d.people) || 0, linen: d.linen, consumables: d.consumables, capsules: Array.isArray(d.capsules) ? d.capsules : [], private: !!d.private };
  }
  return fallback ? packSnapshot(fallback.target_people, fallback.computed_items) : null;
}

const line = (l: LineItem) => `${l.n}× ${l.label}${l.size ? ` ${l.size}` : ''}`;

/** "2× Paplón veľký · 4× Vankúš" for the three groups; empty strings when nothing. */
export function snapshotText(s: PackSnapshot | null): { linen: string; consumables: string; capsules: string } {
  if (!s) return { linen: '', consumables: '', capsules: '' };
  return {
    linen: s.linen.map(line).join(' · '),
    consumables: s.consumables.map(line).join(' · '),
    capsules: s.capsules
      .map((c) => {
        const t = capsuleLabel(c);
        return `${c.n}× ${t.label}${t.note ? ` (${t.note})` : ''}`;
      })
      .join(' · '),
  };
}

/** CSV column headers of the item cells, in the linen-table order (default labels; keys are what count). */
export const SNAPSHOT_COLUMNS: string[] = DEFAULT_ITEMS.map((i) => (i.size ? `${i.label} ${i.size}` : i.label));

/** One cell per DEFAULT_ITEMS key (empty when the item was not packed), then the capsules text. */
export function snapshotCells(s: PackSnapshot | null): (number | string)[] {
  const by = new Map<string, number>();
  for (const l of [...(s?.linen ?? []), ...(s?.consumables ?? [])]) by.set(l.key, (by.get(l.key) ?? 0) + l.n);
  return [...DEFAULT_ITEMS.map((i) => by.get(i.key) ?? ''), snapshotText(s).capsules];
}

/** Slovak status note for a row whose packing did not stand: unpacked since, packed again later, or cancelled. */
export function statusNote(status: PackageStatus | null, superseded = false): string | null {
  if (status === 'cancelled') return 'rezervácia zrušená';
  if (status === 'todo') return 'neskôr vrátené na balenie';
  if (superseded) return 'neskôr vrátené a zabalené znova';
  return null;
}

/**
 * A card with a staff note had something missing that is brought to the flat
 * later; the history marks it for billing (owner, 2026-10-19).
 */
export const BILLING_NOTE = 'DO VYÚČTOVANIA';

/** Small note when the counts are not the ones stored at packing time. */
export const NOT_EXACT_NOTE = 'počty podľa aktuálnej karty (zabalené pred zavedením histórie)';
