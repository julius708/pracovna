-- Postgres grants EXECUTE on new functions to PUBLIC, which covers anon even
-- after "revoke ... from anon". Remove the PUBLIC grant; the roles that need
-- the functions (authenticated, service_role) keep their explicit grants.
revoke execute on function public.today_ba() from public;
revoke execute on function public.is_admin() from public;
revoke execute on function public.is_active_user() from public;
revoke execute on function public.board_status() from public;
revoke execute on function public.pack_package(uuid, uuid) from public;
revoke execute on function public.unpack_package(uuid, uuid) from public;
revoke execute on function public.set_note(uuid, text, uuid) from public;
revoke execute on function public.toggle_check(uuid, text, boolean, uuid) from public;
revoke execute on function public.save_settings(text, jsonb, int) from public;
revoke execute on function public.admin_set_profile(uuid, text, boolean) from public;

grant execute on function public.today_ba() to authenticated, service_role;
grant execute on function public.is_admin() to authenticated, service_role;
grant execute on function public.is_active_user() to authenticated, service_role;
grant execute on function public.board_status() to authenticated, service_role;
grant execute on function public.pack_package(uuid, uuid) to authenticated, service_role;
grant execute on function public.unpack_package(uuid, uuid) to authenticated, service_role;
grant execute on function public.set_note(uuid, text, uuid) to authenticated, service_role;
grant execute on function public.toggle_check(uuid, text, boolean, uuid) to authenticated, service_role;
grant execute on function public.save_settings(text, jsonb, int) to authenticated, service_role;
grant execute on function public.admin_set_profile(uuid, text, boolean) to authenticated, service_role;

-- the sync RPCs are for the service role only
grant execute on function public.sync_upsert_package(jsonb) to service_role;
grant execute on function public.sync_set_lifecycle(uuid, text, boolean, text) to service_role;
grant execute on function public.increment_not_found(text) to service_role;
grant execute on function public.acquire_lock(text, int, text) to service_role;
grant execute on function public.run_retention(timestamptz) to service_role;
