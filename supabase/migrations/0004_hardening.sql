-- Hardening after the Supabase security advisor run (2026-10-01).
-- Functions in the exposed "public" schema are callable through PostgREST by
-- anyone who has EXECUTE; Postgres grants it to PUBLIC by default.

-- fixed search_path for the remaining functions
alter function public.today_ba() set search_path = '';
alter function public.packages_guard() set search_path = '';
alter function public.package_events_immutable() set search_path = '';

-- nothing is callable anonymously
revoke execute on function public.today_ba() from anon;
revoke execute on function public.is_admin() from anon;
revoke execute on function public.is_active_user() from anon;
revoke execute on function public.board_status() from anon;
revoke execute on function public.pack_package(uuid, uuid) from anon;
revoke execute on function public.unpack_package(uuid, uuid) from anon;
revoke execute on function public.set_note(uuid, text, uuid) from anon;
revoke execute on function public.toggle_check(uuid, text, boolean, uuid) from anon;
revoke execute on function public.save_settings(text, jsonb, int) from anon;
revoke execute on function public.admin_set_profile(uuid, text, boolean) from anon;

-- trigger functions are never called directly
revoke execute on function public.handle_new_user() from public, anon, authenticated;
grant execute on function public.handle_new_user() to supabase_auth_admin;
revoke execute on function public.notify_board() from public, anon, authenticated;
revoke execute on function public.packages_guard() from public, anon, authenticated;
revoke execute on function public.package_events_immutable() from public, anon, authenticated;

-- signed-in users keep only what the app calls (policies call is_admin/is_active_user as the session role)
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_active_user() to authenticated;
grant execute on function public.today_ba() to authenticated;
