-- ============================================================================
-- OrderIT — Migration: full driver sync from MoveIT (MOTOR project).
--
-- MoveIT and OrderIT are separate Supabase projects with separate auth.
-- Drivers work day-to-day in MoveIT's own console (that's where they
-- actually go online/offline, and where their name/phone/vehicle info is
-- entered at signup) — OrderIT's `drivers` table should just mirror that,
-- automatically, with no manual admin step.
--
-- `drivers.id` used to be a strict foreign key to profiles(id) (i.e. an
-- OrderIT Supabase Auth user), which meant a driver could only exist in
-- OrderIT if they'd separately signed up for an OrderIT account too. That's
-- fine for a driver who genuinely uses the OrderIT app directly, but it's
-- the wrong shape for a driver who only ever uses MoveIT — this migration
-- decouples the two, so a MoveIT-sourced driver row can be created with no
-- OrderIT login at all. Native OrderIT driver signups (SetupOrg.jsx) are
-- unaffected — they still insert id = auth.uid() same as before, so
-- `id = auth.uid()` RLS checks keep working for anyone who does log in.
--
-- Run this on OrderIT's Supabase SQL Editor. Safe to re-run.
-- ============================================================================

create extension if not exists pgcrypto;

alter table drivers drop constraint if exists drivers_id_fkey;
alter table drivers alter column id set default gen_random_uuid();

alter table drivers add column if not exists motor_driver_id uuid;

drop index if exists drivers_motor_driver_id_idx;
create unique index drivers_motor_driver_id_idx on drivers(motor_driver_id)
  where motor_driver_id is not null;

-- Service-role (the sync Edge Function) needs to insert/update rows that
-- have no auth.uid() match — the two existing policies already allow admin
-- reads/writes, but service-role calls bypass RLS entirely anyway, so no
-- new policy is required. Kept here as a note, not a statement.

