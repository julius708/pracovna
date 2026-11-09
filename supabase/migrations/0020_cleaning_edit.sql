-- "Info pre upratovačov": the author may edit their own message or reply
-- (Martina, 2026-11-09), like the notice board. The edit keeps the author and
-- day, stamps edited_at, and is broadcast like every other change (the
-- existing cleaning_requests_notify trigger). Admins still remove, but do not
-- rewrite other people's words.
-- Purely additive: one nullable column, one RPC. No bare dollar sign outside
-- the function body: the Supabase SQL editor splits the script on it.

alter table public.cleaning_requests add column if not exists edited_at timestamptz;

create or replace function public.edit_cleaning_request(p_id uuid, p_text text) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare
  me uuid := auth.uid();
  clean text := left(btrim(coalesce(p_text, '')), 500);
  row public.cleaning_requests;
begin
  if not public.is_active_user() or not public.has_cleaning_role(array['cleaning', 'admin', 'customer_service', 'operations']) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into row from public.cleaning_requests where id = p_id for update;
  if not found then
    raise exception 'request not found' using errcode = 'P0002';
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
  update public.cleaning_requests set text = clean, edited_at = now() where id = p_id;
  return jsonb_build_object('ok', true);
end $fn$;

revoke execute on function public.edit_cleaning_request(uuid, text) from public, anon;
grant execute on function public.edit_cleaning_request(uuid, text) to authenticated;
