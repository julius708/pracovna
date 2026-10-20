-- "Dôležité info": replies to a note (Martina, 2026-10-19). A reply is a
-- board note of its own with parent_id set: it belongs to the parent's day,
-- shows under the parent, and is edited and removed like any note (same RPCs,
-- same rights). One level only: a reply to a reply is refused. Purely
-- additive: one nullable column, one index, one RPC; existing notes stay
-- top-level notes.

alter table public.board_notes add column if not exists parent_id uuid references public.board_notes(id) on delete cascade;
create index if not exists board_notes_parent on public.board_notes (parent_id) where parent_id is not null;

create or replace function public.add_board_reply(p_parent uuid, p_text text, p_action_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  me_name text;
  clean text := left(btrim(coalesce(p_text, '')), 500);
  parent public.board_notes;
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
  select * into parent from public.board_notes where id = p_parent;
  if not found or parent.removed_at is not null then
    return jsonb_build_object('ok', false, 'status', 'removed');
  end if;
  if parent.parent_id is not null then
    return jsonb_build_object('ok', false, 'status', 'nested');
  end if;
  select display_name into me_name from public.profiles where id = me;
  insert into public.board_notes (text, date, author, author_name, client_action_id, parent_id)
  values (clean, parent.date, me, coalesce(me_name, '—'), p_action_id, parent.id)
  returning * into row;
  return jsonb_build_object('ok', true, 'id', row.id);
end $$;

revoke execute on function public.add_board_reply(uuid, text, uuid) from public, anon;
grant execute on function public.add_board_reply(uuid, text, uuid) to authenticated;
