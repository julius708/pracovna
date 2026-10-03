-- "Dôležité info pre Angeliku a Maxa" (owner request 2026-10-03): a shared
-- notice board shown above the apartment list on every day. Any active user
-- may add a note; the author's name and the time are recorded. A note is
-- removed by its author or an admin; removed notes stay in the table for the
-- record. Like the package actions, writes go only through the two RPCs, and
-- every change is broadcast on the "board" topic so all devices refresh.

create table if not exists public.board_notes (
  id uuid primary key default gen_random_uuid(),
  text text not null check (char_length(text) between 1 and 500),
  author uuid references public.profiles(id) on delete set null,
  author_name text not null,
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_by uuid references public.profiles(id) on delete set null,
  removed_by_name text,
  -- idempotency key of the add action (retries after a lost response)
  client_action_id uuid unique
);
create index if not exists board_notes_active on public.board_notes (created_at desc) where removed_at is null;

alter table public.board_notes enable row level security;
drop policy if exists board_notes_select on public.board_notes;
create policy board_notes_select on public.board_notes for select to authenticated
  using (public.is_active_user() and (removed_at is null or public.is_admin()));
revoke all on public.board_notes from public, anon;
revoke insert, update, delete, truncate, references, trigger on public.board_notes from authenticated;
grant select on public.board_notes to authenticated;

create or replace function public.add_board_note(p_text text, p_action_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  me_name text;
  clean text := left(btrim(coalesce(p_text, '')), 500);
  existing public.board_notes;
  row public.board_notes;
begin
  if not public.is_active_user() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_action_id is not null then
    select * into existing from public.board_notes where client_action_id = p_action_id;
    if found then
      return jsonb_build_object('ok', true, 'replayed', true, 'id', existing.id);
    end if;
  end if;
  if clean = '' then
    return jsonb_build_object('ok', false, 'status', 'empty');
  end if;
  select display_name into me_name from public.profiles where id = me;
  insert into public.board_notes (text, author, author_name, client_action_id)
  values (clean, me, coalesce(me_name, '—'), p_action_id)
  returning * into row;
  return jsonb_build_object('ok', true, 'id', row.id);
end $$;

create or replace function public.remove_board_note(p_id uuid, p_action_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  me_name text;
  row public.board_notes;
begin
  if not public.is_active_user() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into row from public.board_notes where id = p_id for update;
  if not found then
    raise exception 'note not found' using errcode = 'P0002';
  end if;
  if row.removed_at is not null then
    return jsonb_build_object('ok', true, 'replayed', true);
  end if;
  if row.author is distinct from me and not public.is_admin() then
    return jsonb_build_object('ok', false, 'status', 'not_author');
  end if;
  select display_name into me_name from public.profiles where id = me;
  update public.board_notes
    set removed_at = now(), removed_by = me, removed_by_name = coalesce(me_name, '—')
    where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

revoke execute on function public.add_board_note(text, uuid) from public, anon;
revoke execute on function public.remove_board_note(uuid, uuid) from public, anon;
grant execute on function public.add_board_note(text, uuid) to authenticated;
grant execute on function public.remove_board_note(uuid, uuid) to authenticated;

drop trigger if exists board_notes_notify on public.board_notes;
create trigger board_notes_notify after insert or update or delete on public.board_notes
  for each row execute function public.notify_board();
