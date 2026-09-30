-- Sync status for the board header (staff may not read app_state directly).
create or replace function public.board_status() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'last_ok_sync_at', (select value from public.app_state where key = 'last_ok_sync_at'),
    'consecutive_failures', coalesce((select value from public.app_state where key = 'consecutive_failures'), '0'::jsonb),
    'last_webhook_at', (select value from public.app_state where key = 'last_webhook_at')
  )
  where public.is_active_user()
$$;

grant execute on function public.board_status() to authenticated;
