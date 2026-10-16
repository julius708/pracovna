-- Push notifications (owner, 2026-10-11: an early arrival must show up as a
-- notification). A device that turned notifications on stores its Web Push
-- subscription here under the signed-in user; the sync sends to every
-- subscription of an active user through the service role and deletes the
-- ones the push service reports gone. Users see and manage only their own rows.

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  user_name text not null default '',
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text not null default '',
  created_at timestamptz not null default now(),
  last_ok_at timestamptz,
  failed_at timestamptz
);
create index if not exists push_subscriptions_user on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;
drop policy if exists push_subscriptions_select on public.push_subscriptions;
create policy push_subscriptions_select on public.push_subscriptions for select to authenticated
  using (public.is_active_user() and user_id = auth.uid());
revoke all on public.push_subscriptions from public, anon;
revoke insert, update, delete, truncate, references, trigger on public.push_subscriptions from authenticated;
grant select on public.push_subscriptions to authenticated;

-- A device belongs to whoever is signed in on it now (a shared phone or the office desktop):
-- saving moves the endpoint to the current user; turning off removes it whoever stored it.
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  me_name text;
begin
  if not public.is_active_user() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_endpoint is null or p_endpoint !~ '^https://' or length(p_endpoint) > 2000 or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then
    return jsonb_build_object('ok', false, 'status', 'invalid');
  end if;
  select display_name into me_name from public.profiles where id = me;
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id is distinct from me;
  insert into public.push_subscriptions (user_id, user_name, endpoint, p256dh, auth, user_agent)
  values (me, coalesce(me_name, '—'), p_endpoint, p_p256dh, p_auth, left(coalesce(p_user_agent, ''), 300))
  on conflict (endpoint) do update
    set p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent, user_name = excluded.user_name, failed_at = null;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.remove_push_subscription(p_endpoint text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  delete from public.push_subscriptions where endpoint = p_endpoint;
  return jsonb_build_object('ok', true);
end $$;

revoke execute on function public.save_push_subscription(text, text, text, text) from public, anon;
revoke execute on function public.remove_push_subscription(text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;
grant execute on function public.remove_push_subscription(text) to authenticated;
