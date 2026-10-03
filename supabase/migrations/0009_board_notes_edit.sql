-- Notice board: the author may edit their own note (owner request 2026-10-03).
-- The edit keeps the author and day, stamps edited_at, and is broadcast like
-- every other change. Admins remove notes but do not rewrite other people's words.

alter table public.board_notes add column if not exists edited_at timestamptz;

create or replace function public.edit_board_note(p_id uuid, p_text text, p_action_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  clean text := left(btrim(coalesce(p_text, '')), 500);
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
    return jsonb_build_object('ok', false, 'status', 'removed');
  end if;
  if row.author is distinct from me then
    return jsonb_build_object('ok', false, 'status', 'not_author');
  end if;
  if clean = '' then
    return jsonb_build_object('ok', false, 'status', 'empty');
  end if;
  if clean = row.text then
    return jsonb_build_object('ok', true, 'unchanged', true);
  end if;
  update public.board_notes set text = clean, edited_at = now() where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

revoke execute on function public.edit_board_note(uuid, text, uuid) from public, anon;
grant execute on function public.edit_board_note(uuid, text, uuid) to authenticated;
