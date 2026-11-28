-- Two weeks ahead (Martina 2026-11-28, approved by Július): the board shows 14 days
-- (today .. today+13) instead of 7, so packing can be planned and marked earlier.
-- Staff see and may change visible packages from yesterday to today+13; admins
-- everything. Same shape as migration 0010, only the upper bound moves from +6 to +13.
-- The application computes the same window (WINDOW_DAYS in src/core/packing/dates.ts).
-- No bare dollar sign: the Supabase SQL editor splits the script on it.

drop policy if exists packages_select on public.packages;
create policy packages_select on public.packages for select to authenticated using (
  public.is_active_user() and (public.is_admin() or (not hidden and date between public.today_ba() - 1 and public.today_ba() + 13))
);

create or replace function public.staff_may_change(p public.packages) returns boolean
language sql stable set search_path = '' as 'select public.is_admin() or (not p.hidden and p.date between public.today_ba() - 1 and public.today_ba() + 13)';
revoke execute on function public.staff_may_change(public.packages) from public, anon, authenticated;
