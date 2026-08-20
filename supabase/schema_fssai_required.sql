-- ============================================================================
-- Migration 013 — FSSAI license number required for hotel onboarding
-- Run on the OrderIT Supabase project. Safe to re-run.
-- ============================================================================

alter table hotels add column if not exists fssai_number text;

-- Existing hotels (created before this migration) won't have one on file —
-- give them a placeholder so the NOT NULL constraint below doesn't fail,
-- rather than silently making it optional. Replace with real numbers in the
-- Table Editor when you have them, or ask each hotel to update it.
update hotels set fssai_number = 'PENDING' where fssai_number is null;

alter table hotels alter column fssai_number set not null;
