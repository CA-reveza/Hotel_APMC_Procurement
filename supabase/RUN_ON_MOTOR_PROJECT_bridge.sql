-- ============================================================================
-- ⚠️  RUN THIS ON THE MOTOR PROJECT'S SUPABASE — NOT ORDERIT'S.
-- MOTOR and OrderIt are two separate Supabase projects with separate auth.
-- This migration lets MOTOR accept bookings created by OrderIt's Edge
-- Function (which has no MOTOR customer account) and lets OrderIt's frontend
-- read back live status for just those bridged bookings, without needing a
-- MOTOR login.
-- Safe to re-run.
-- ============================================================================

-- OrderIt's Edge Function creates bookings via MOTOR's service-role key
-- (bypasses RLS), with no real MOTOR customer behind them.
alter table bookings alter column customer_id drop not null;

alter table bookings add column if not exists source text not null default 'motor'
  check (source in ('motor', 'orderit'));
alter table bookings add column if not exists external_order_id uuid;

-- OrderIt's frontend has no MOTOR session, so give it a narrow, explicit
-- read window: only bookings OrderIt itself created (source = 'orderit'),
-- nothing belonging to MOTOR's own customers.
drop policy if exists "Public can read orderit-sourced bookings" on bookings;
create policy "Public can read orderit-sourced bookings" on bookings
  for select using (source = 'orderit');

-- No new write policy needed: OrderIt only ever creates these bookings via
-- the service-role key from its Edge Function, which bypasses RLS by design.
-- MOTOR drivers already see them through the existing "Drivers can read
-- pending bookings" policy (status = 'pending', no customer_id check).
