-- ============================================================================
-- Migration 004 — Hotel contact info visible to suppliers
-- Run in the Supabase SQL Editor after the previous migrations.
-- Safe to re-run.
-- ============================================================================

alter table hotels add column if not exists phone text;
alter table hotels add column if not exists email text;

-- Backfill existing hotels from their linked profile (one-time; new hotels
-- get these set directly at sign-up going forward — see SetupOrg.jsx).
update hotels h
set phone = coalesce(h.phone, p.phone),
    email = coalesce(h.email, p.email)
from profiles p
where p.id = h.profile_id
  and (h.phone is null or h.email is null);

-- No RLS change needed: the existing "hotels_select" policy already lets any
-- supplier profile read all hotels rows (schema.sql), so phone/email ride
-- along automatically once added to the table.
