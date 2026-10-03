-- Notice board per day (owner request 2026-10-03, second round): a note
-- belongs to one board day and is shown only under that day's tab. The day is
-- chosen by the tab the writer has open. add_board_note gets the day as a
-- parameter; a day far outside the board (before yesterday or more than 30
-- days ahead) is refused.

alter table public.board_notes add column if not exists date date;
update public.board_notes set date = (created_at at time zone 'Europe/Bratislava')::date where date is null;
alter table public.board_notes alter column date set not null;
create index if not exists board_notes_day on public.board_notes (date) where removed_at is null;

drop function if exists public.add_board_note(text, uuid);

create or replace function public.add_board_note(p_text text, p_date date, p_action_id uuid) returns jsonb
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
  if p_date is null or p_date < public.today_ba() - 1 or p_date > public.today_ba() + 30 then
    return jsonb_build_object('ok', false, 'status', 'bad_date');
  end if;
  select display_name into me_name from public.profiles where id = me;
  insert into public.board_notes (text, date, author, author_name, client_action_id)
  values (clean, p_date, me, coalesce(me_name, '—'), p_action_id)
  returning * into row;
  return jsonb_build_object('ok', true, 'id', row.id);
end $$;

revoke execute on function public.add_board_note(text, date, uuid) from public, anon;
grant execute on function public.add_board_note(text, date, uuid) to authenticated;
