-- Week view (owner request 2026-10-03): the board shows 7 days (today .. today+6)
-- instead of 3. Staff see and may change visible packages from yesterday to
-- today+6; admins everything. The application computes the same window
-- (WINDOW_DAYS in src/core/packing/dates.ts).

drop policy if exists packages_select on public.packages;
create policy packages_select on public.packages for select to authenticated using (
  public.is_active_user() and (public.is_admin() or (not hidden and date between public.today_ba() - 1 and public.today_ba() + 6))
);

create or replace function public.staff_may_change(p public.packages) returns boolean
language sql stable set search_path = '' as $$
  select public.is_admin() or (not p.hidden and p.date between public.today_ba() - 1 and public.today_ba() + 6)
$$;
revoke execute on function public.staff_may_change(public.packages) from public, anon, authenticated;
