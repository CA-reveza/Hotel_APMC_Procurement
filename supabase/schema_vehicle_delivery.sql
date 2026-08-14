-- ============================================================================
-- Migration 007 — Vehicle/driver delivery system
-- Adapted from the standalone "motor" app (Porter-style vehicle catalog +
-- driver accept/progress flow) into this project's existing schema, so it
-- shares the same Supabase Auth/profiles table instead of running two
-- separate backends.
-- Run in the Supabase SQL Editor after the previous migrations.
-- Safe to re-run.
-- ============================================================================

-- 1. Allow a 'driver' role on profiles
alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check check (role in ('hotel','supplier','admin','driver'));

-- 2. Drivers — one-time setup info, mirrors motor's profiles.vehicle fields
create table if not exists drivers (
  id uuid primary key references profiles(id) on delete cascade,
  name text not null,
  phone text,
  vehicle_type text not null,
  vehicle_number text,
  is_online boolean default true,
  created_at timestamptz default now()
);

alter table drivers enable row level security;

drop policy if exists "drivers_select_own_or_admin" on drivers;
create policy "drivers_select_own_or_admin" on drivers
  for select using (id = auth.uid() or is_admin());
drop policy if exists "drivers_insert_own" on drivers;
create policy "drivers_insert_own" on drivers
  for insert with check (id = auth.uid());
drop policy if exists "drivers_update_own" on drivers;
create policy "drivers_update_own" on drivers
  for update using (id = auth.uid() or is_admin());

-- 3. Extend deliveries with vehicle-booking fields (motor's bookings shape,
-- folded into the existing per-order deliveries row rather than a separate
-- bookings table, since it's always 1:1 with an order here).
alter table deliveries add column if not exists vehicle_type text;
alter table deliveries add column if not exists distance_km numeric;
alter table deliveries add column if not exists fare_estimate numeric;
alter table deliveries add column if not exists fare_final numeric;
alter table deliveries add column if not exists driver_id uuid references profiles(id);
alter table deliveries add column if not exists requested_at timestamptz;
alter table deliveries add column if not exists accepted_at timestamptz;
alter table deliveries add column if not exists in_transit_at timestamptz;

-- 4. Drivers can see the open pool (posted, unaccepted vehicle bookings) and
-- their own accepted ones; can update to accept or progress status.
drop policy if exists "deliveries_select_driver_pool" on deliveries;
create policy "deliveries_select_driver_pool" on deliveries
  for select using (
    (driver_id is null and vehicle_type is not null) or driver_id = auth.uid()
  );
drop policy if exists "deliveries_update_driver" on deliveries;
create policy "deliveries_update_driver" on deliveries
  for update using (
    (driver_id is null and vehicle_type is not null) or driver_id = auth.uid()
  );

-- 5. Drivers need to read the parent order (pickup/drop context) for
-- deliveries they can see.
drop policy if exists "orders_select_driver" on orders;
create policy "orders_select_driver" on orders
  for select using (
    exists (
      select 1 from deliveries d
      where d.order_id = orders.id
      and (d.driver_id = auth.uid() or (d.driver_id is null and d.vehicle_type is not null))
    )
  );

-- 6. Hotels table: broaden read access to any authenticated user (matches
-- suppliers, which was already broad) so drivers can see hotel name/address
-- on their deliveries without a bespoke policy.
drop policy if exists "hotels_select" on hotels;
create policy "hotels_select" on hotels
  for select using (auth.role() = 'authenticated');

do $$
begin
  begin
    alter publication supabase_realtime add table drivers;
  exception when duplicate_object then null;
  end;
end $$;
