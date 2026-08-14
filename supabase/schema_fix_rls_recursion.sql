-- ============================================================================
-- Migration 008 — Fix infinite RLS recursion (orders ↔ deliveries)
-- Run in the Supabase SQL Editor after schema_vehicle_delivery.sql.
--
-- Cause: "orders_select_driver" (on orders) queries deliveries, and
-- "deliveries_select" (on deliveries) queries orders right back — Postgres
-- has to evaluate both policies to answer either, which loops forever
-- (error 42P17 "infinite recursion detected in policy").
--
-- Fix: check delivery-visibility through a SECURITY DEFINER function, which
-- runs with elevated privileges and so does NOT re-trigger deliveries' RLS
-- policies when it queries that table — breaking the cycle. Same pattern
-- schema.sql already uses for is_admin().
-- ============================================================================

create or replace function is_driver_delivery_visible(check_order_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from deliveries d
    where d.order_id = check_order_id
    and (d.driver_id = auth.uid() or (d.driver_id is null and d.vehicle_type is not null))
  );
$$;

drop policy if exists "orders_select_driver" on orders;
create policy "orders_select_driver" on orders
  for select using (is_driver_delivery_visible(orders.id));
