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

-- ============================================================================
-- After running the SQL above, also set up the status webhook (this is a
-- dashboard step, not SQL — no further code to run here):
--
-- MOTOR project → Database → Webhooks → Create a new webhook
--   Name:    orderit-status-sync
--   Table:   bookings
--   Events:  Update
--   Type:    HTTP Request
--   Method:  POST
--   URL:     <OrderIt's motor-status-webhook Edge Function URL>
--            (find it under OrderIt's project → Edge Functions →
--            motor-status-webhook, after deploying it)
--   HTTP Headers: add one —
--     x-webhook-secret: <same value you set as MOTOR_WEBHOOK_SECRET
--                         on the OrderIt project>
--
-- This is what makes "driver accepted in MOTOR" show up live in OrderIt's
-- Hotel and Supplier order lists, not just when someone happens to have that
-- specific order's delivery panel open.
-- ============================================================================
