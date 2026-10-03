import { describe, expect, it } from 'vitest';
import { memoryCheck, memoryNote, memoryPack, memoryUnpack, outOfWindow } from '@/app/_lib/memory-staff';
import type { Viewer } from '@/app/_lib/viewer';
import type { PackingResult } from '@/core/packing';
import { MemoryRepo } from '@/db/memory-repo';
import type { PackageComputed } from '@/db/types';

const staff: Viewer = { id: '00000000-0000-4000-8000-00000000005f', name: 'Eva', role: 'staff', active: true, dev: true };
const admin: Viewer = { id: '00000000-0000-4000-8000-0000000000ad', name: 'Julius', role: 'admin', active: true, dev: true };

let seq = 0;
function computed(date: string): PackageComputed {
  return {
    outgoing_reservation_id: `R${++seq}`,
    listing_id: 'L1',
    listing_name: 'BA: Test',
    date,
    incoming_reservation_id: null,
    same_day: false,
    gap_nights: null,
    gap_blocked: null,
    target_people: 2,
    people_source: 'capacity',
    computed_items: {} as PackingResult,
    computed_hash: 'h',
    warnings: [],
  };
}

/** Same rule as the Postgres RPCs: staff act only on visible rows from yesterday to the last board day (today+6). */
describe('memory staff actions: the visible window', () => {
  const repo = new MemoryRepo();
  // 2026-10-02 10:00 in Bratislava (CEST)
  repo.now = () => new Date('2026-10-02T08:00:00Z');
  const refused = { ok: false, status: 'out_of_window' };

  it('refuses rows before yesterday, after the last board day and hidden rows for staff', async () => {
    const old = await repo.insertPackage(computed('2026-09-30'));
    const far = await repo.insertPackage(computed('2026-10-09'));
    const hidden = await repo.insertPackage(computed('2026-10-02'));
    await repo.setPackageLifecycle(hidden.id, { hidden: true });
    expect(await memoryPack(repo, staff, old.id, null)).toEqual(refused);
    expect(await memoryPack(repo, staff, far.id, null)).toEqual(refused);
    expect(await memoryNote(repo, staff, old.id, 'x', null)).toEqual(refused);
    expect(await memoryCheck(repo, staff, hidden.id, 'Kľúče', true, null)).toEqual(refused);
    expect(repo.events).toEqual([]);
    expect(repo.packages.get(old.id)?.status).toBe('todo');
  });

  it('allows yesterday and the last board day (today+6) for staff', async () => {
    const low = await repo.insertPackage(computed('2026-10-01'));
    const high = await repo.insertPackage(computed('2026-10-08'));
    expect(await memoryPack(repo, staff, low.id, null)).toMatchObject({ ok: true, status: 'packed' });
    expect(await memoryPack(repo, staff, high.id, null)).toMatchObject({ ok: true, status: 'packed' });
    expect(await memoryUnpack(repo, staff, high.id, null)).toEqual({ ok: true, status: 'todo' });
  });

  it('admins may touch any row', async () => {
    const old = await repo.insertPackage(computed('2026-09-01'));
    expect(outOfWindow(repo, admin, repo.packages.get(old.id)!)).toBe(false);
    expect(await memoryPack(repo, admin, old.id, null)).toMatchObject({ ok: true, status: 'packed' });
    expect(await memoryUnpack(repo, staff, old.id, null)).toEqual(refused);
    expect(repo.packages.get(old.id)?.status).toBe('packed');
  });

  it('the window follows the Bratislava date, not UTC', async () => {
    const late = new MemoryRepo();
    // 23:30 UTC on 2026-10-02 is already 01:30 on 3.10. in Bratislava: 1.10. is no longer "yesterday"
    late.now = () => new Date('2026-10-02T23:30:00Z');
    const p = await late.insertPackage(computed('2026-10-01'));
    expect(outOfWindow(late, staff, late.packages.get(p.id)!)).toBe(true);
    const q = await late.insertPackage(computed('2026-10-05'));
    expect(outOfWindow(late, staff, late.packages.get(q.id)!)).toBe(false);
  });
});
