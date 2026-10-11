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
drop policy if exists push_subscriptions_insert on public.push_subscriptions;
create policy push_subscriptions_insert on public.push_subscriptions for insert to authenticated
  with check (public.is_active_user() and user_id = auth.uid());
drop policy if exists push_subscriptions_update on public.push_subscriptions;
create policy push_subscriptions_update on public.push_subscriptions for update to authenticated
  using (public.is_active_user() and user_id = auth.uid())
  with check (public.is_active_user() and user_id = auth.uid());
drop policy if exists push_subscriptions_delete on public.push_subscriptions;
create policy push_subscriptions_delete on public.push_subscriptions for delete to authenticated
  using (public.is_active_user() and user_id = auth.uid());
revoke all on public.push_subscriptions from public, anon;
revoke truncate, references, trigger on public.push_subscriptions from authenticated;
grant select, insert, update, delete on public.push_subscriptions to authenticated;
