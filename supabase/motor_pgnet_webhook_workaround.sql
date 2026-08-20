-- ============================================================================
-- MOTOR — Workaround for "schema supabase_functions does not exist"
-- Run this on the MOTOR project's Supabase SQL Editor.
--
-- The dashboard's Database Webhooks feature (Integrations → Webhooks →
-- Create a new hook) depends on an internal "supabase_functions" schema that
-- Supabase auto-provisions per-project — and on some projects it just never
-- gets created, which is a known platform bug (see e.g.
-- github.com/supabase/supabase/issues/20056 and #32700). No SQL fix exists
-- for that missing schema itself; the standard workaround is to skip that
-- feature entirely and call the webhook directly from a trigger using the
-- pg_net extension, which works independently of it.
--
-- This does exactly the same job as the dashboard webhook you were trying to
-- create — POSTs the same payload shape to the same motor-status-webhook
-- Edge Function — just via a trigger instead of the broken dashboard UI.
-- ============================================================================

create extension if not exists pg_net;

-- ⚠️ Replace both placeholders below before running:
--   1. the URL — copy it from OrderIT's Supabase dashboard → Edge Functions
--      → motor-status-webhook (same URL you were pasting into the dashboard
--      webhook form)
--   2. the secret — same value you set as MOTOR_WEBHOOK_SECRET on the
--      OrderIT project (`supabase secrets set MOTOR_WEBHOOK_SECRET=...`)
create or replace function notify_orderit_on_booking_change()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform net.http_post(
    url := 'https://wjlmynndwlwnwkkowczr.supabase.co/functions/v1/motor-status-webhook',
    body := jsonb_build_object(
      'type', 'UPDATE',
      'table', 'bookings',
      'record', to_jsonb(new),
      'old_record', to_jsonb(old)
    ),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', '9788a36ec5157c1ea6c5c1474a67776ecb9a299f656dcc09c8be8c134c2b2f26'
    )
  );
  return new;
end;
$$;

drop trigger if exists trg_notify_orderit_on_booking_change on bookings;
create trigger trg_notify_orderit_on_booking_change
  after update on bookings
  for each row execute procedure notify_orderit_on_booking_change();

-- ============================================================================
-- Verify it's actually firing (pg_net queues requests async, so check here
-- rather than expecting an immediate error if something's wrong):
--   select * from net._http_response order by created desc limit 5;
-- A non-200 status_code there tells you exactly what OrderIT's function
-- rejected (bad secret, function not deployed, etc.) — same debugging value
-- as the dashboard webhook would have given you, just queried instead of
-- shown in a UI panel.
-- ============================================================================
