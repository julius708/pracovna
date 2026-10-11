-- Early arrivals come from Guesty (owner, 2026-10-11): the planned arrival of
-- a reservation is the clock part of Guesty's check-in timestamp (16:00 is the
-- standard; an agreed early check-in shows as 12:00, 13:00 …). The sync stores
-- it on the reservation and keeps early_arrivals in line with the confirmed
-- reservations of the board days (src/sync/early-arrivals.ts). The manual entry
-- of 0012 is withdrawn: the two RPCs go, the table, its RLS and its realtime
-- trigger stay. The sync writes through the service role.

alter table public.reservations add column if not exists arrival_time text;

alter table public.early_arrivals add column if not exists source text not null default 'guesty';
alter table public.early_arrivals add column if not exists reservation_id text;
create index if not exists early_arrivals_reservation on public.early_arrivals (reservation_id) where removed_at is null;

drop function if exists public.add_early_arrival(text, date, text, text, uuid);
drop function if exists public.remove_early_arrival(uuid, uuid);
