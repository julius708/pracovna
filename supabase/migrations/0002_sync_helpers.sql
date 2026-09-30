-- Helper RPCs used by the sync (service role only; no grants to authenticated).

create or replace function public.increment_not_found(p_id text) returns void
language sql security definer set search_path = '' as
$$ update public.reservations set not_found_runs = not_found_runs + 1 where guesty_id = p_id $$;

-- Lease lock: true when this run now holds the lock.
create or replace function public.acquire_lock(p_name text, p_ttl_seconds int, p_run_id text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  got boolean := false;
begin
  insert into public.sync_locks (name, locked_until, run_id)
  values (p_name, now() + make_interval(secs => p_ttl_seconds), p_run_id)
  on conflict (name) do update
    set locked_until = excluded.locked_until, run_id = excluded.run_id
    where public.sync_locks.locked_until < now() or public.sync_locks.run_id = excluded.run_id
  returning true into got;
  return coalesce(got, false);
end $$;

-- Nightly retention (proposal §4): returns the number of rows removed per table.
create or replace function public.run_retention(p_now timestamptz) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  n_runs int; n_wh int; n_cal int; n_res int;
begin
  with d as (delete from public.sync_runs where started_at < p_now - interval '30 days' returning 1)
  select count(*) into n_runs from d;

  update public.webhook_events set payload = null where received_at < p_now - interval '30 days' and payload is not null;
  with d as (
    delete from public.webhook_events
    where received_at < p_now - interval '90 days'
       or (status = 'rejected' and received_at < p_now - interval '7 days')
    returning 1)
  select count(*) into n_wh from d;

  with d as (delete from public.calendar_min_nights where date < (p_now at time zone 'Europe/Bratislava')::date - 1 returning 1)
  select count(*) into n_cal from d;

  with d as (
    delete from public.reservations r
    where r.check_out_date < (p_now at time zone 'Europe/Bratislava')::date - 60
      and not exists (select 1 from public.packages p where p.outgoing_reservation_id = r.guesty_id or p.incoming_reservation_id = r.guesty_id)
    returning 1)
  select count(*) into n_res from d;

  return jsonb_build_object('sync_runs', n_runs, 'webhook_events', n_wh, 'calendar', n_cal, 'reservations', n_res);
end $$;

revoke all on function public.increment_not_found(text) from public, anon, authenticated;
revoke all on function public.acquire_lock(text, int, text) from public, anon, authenticated;
revoke all on function public.run_retention(timestamptz) from public, anon, authenticated;
revoke all on function public.sync_upsert_package(jsonb) from public, anon, authenticated;
revoke all on function public.sync_set_lifecycle(uuid, text, boolean, text) from public, anon, authenticated;
