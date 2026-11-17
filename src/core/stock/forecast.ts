import type { IssueAlias, PackSnapshot, Ymd } from './types';
import { planIssue } from './issue-plan';

export type ScenarioName = 'low' | 'mid' | 'high';

/** 1) Known demand: packages of confirmed reservations, through the same plan the issue uses. */
export function knownDemand(snapshots: readonly PackSnapshot[], aliases: readonly IssueAlias[]): { byItem: Map<string, number>; unmappedRows: number } {
  const byItem = new Map<string, number>();
  let unmappedRows = 0;
  for (const s of snapshots) {
    const plan = planIssue(s, aliases);
    unmappedRows += plan.unmapped.length;
    for (const l of plan.lines) byItem.set(l.itemId, (byItem.get(l.itemId) ?? 0) + l.qty);
  }
  return { byItem, unmappedRows };
}

export interface FlatCapacity {
  listingId: string;
  city: string;
  /** Nights of the horizon the flat is active and sellable (repairs and blocks already removed). */
  availableNights: number;
}

export interface Occupancy {
  low: number;
  mid: number;
  high: number;
}

/** Occupied flat-nights = available nights of active flats x expected occupancy (0..1). */
export function occupiedFlatNights(flats: readonly FlatCapacity[], occ: Occupancy): Record<ScenarioName, number> {
  const nights = flats.reduce((s, f) => s + Math.max(0, f.availableNights), 0);
  return { low: nights * occ.low, mid: nights * occ.mid, high: nights * occ.high };
}

/** Stays ~ occupied nights / average stay length. */
export function expectedStays(occupiedNights: number, avgStayNights: number): number {
  return avgStayNights > 0 ? occupiedNights / avgStayNights : 0;
}

export interface Coefficient {
  itemId: string;
  perStay: number;
  /** Period and sample the number comes from (always shown with it). */
  from: Ymd;
  to: Ymd;
  stays: number;
  usable: boolean;
}

export interface SellThroughInput {
  flats: readonly FlatCapacity[];
  occupancy: Occupancy;
  avgStayNights: number;
  /** Stays already confirmed in the horizon: their demand is in knownDemand, never counted twice. */
  confirmedStays: number;
  /** Issue per stay for each item (calibrated), base units. */
  perStay: ReadonlyMap<string, Coefficient>;
}

export interface SellThrough {
  scenario: ScenarioName;
  additionalStays: number;
  byItem: Map<string, number>;
  /** Items with no usable coefficient: shown as "nedostatok dát", not as 0. */
  noData: string[];
}

export function sellThrough(i: SellThroughInput): SellThrough[] {
  const occ = occupiedFlatNights(i.flats, i.occupancy);
  return (['low', 'mid', 'high'] as const).map((scenario) => {
    const stays = expectedStays(occ[scenario], i.avgStayNights);
    const additionalStays = Math.max(0, stays - i.confirmedStays);
    const byItem = new Map<string, number>();
    const noData: string[] = [];
    for (const [itemId, c] of i.perStay) {
      if (!c.usable) noData.push(itemId);
      else byItem.set(itemId, additionalStays * c.perStay);
    }
    return { scenario, additionalStays, byItem, noData };
  });
}

/**
 * Per-stay issue from CLEANED history: only issues that were not corrected away, in a
 * period with at least `minStays` stays. Below that the coefficient is unusable
 * (shown as missing data) instead of being extrapolated from a handful of rows.
 */
export function calibrate(itemId: string, issued: number, period: { from: Ymd; to: Ymd; stays: number }, minStays = 20): Coefficient {
  const usable = period.stays >= minStays && issued >= 0;
  return { itemId, perStay: usable ? issued / period.stays : 0, from: period.from, to: period.to, stays: period.stays, usable };
}
