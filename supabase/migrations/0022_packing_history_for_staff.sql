-- "Zabalené balíčky" for everyone (Martina, 2026-11-20; NEEDS Július's approval,
-- it widens who reads package_events): every active user may read the "packed"
-- events, i.e. who packed which flat, when, for how many people and the counts
-- as packed. The rest of the audit log stays the admin's (package_events_select).
-- Purely additive: one extra select policy, nothing removed or changed.
-- No bare dollar sign: the Supabase SQL editor splits the script on it.

drop policy if exists package_events_select_packed on public.package_events;
create policy package_events_select_packed on public.package_events for select to authenticated
  using (public.is_active_user() and event = 'packed');
