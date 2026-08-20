-- ============================================================================
-- Migration 009 — MOTOR bridge columns (run on the OrderIT/hotel-apmc-platform
-- Supabase project)
-- Adds tracking columns so a delivery can be fulfilled either by OrderIT's
-- own in-house driver pool (unchanged) or bridged out to the separate MOTOR
-- app as a real booking in MOTOR's own database.
-- Safe to re-run.
-- ============================================================================

alter table deliveries add column if not exists fulfilled_via text not null default 'internal'
  check (fulfilled_via in ('internal', 'motor'));
alter table deliveries add column if not exists motor_booking_id uuid;
alter table deliveries add column if not exists motor_status text;
