-- ============================================================================
-- Migration — Platform fee + delivery charge formula
-- Run on the OrderIT Supabase project, after all previous migrations.
-- Safe to re-run.
--
-- Delivery charge: ₹140 flat for up to 5 km, then +₹20 for every km beyond
-- that (rounded up). Computed client-side at checkout (src/lib/orderFees.js)
-- and passed in as delivery_charge on the order — this migration just adds
-- the columns and folds them into grand_total, the same way for every order
-- regardless of how delivery_charge was computed.
-- ============================================================================

alter table orders add column if not exists delivery_distance_km numeric;
alter table orders add column if not exists delivery_charge numeric not null default 0;
alter table orders add column if not exists platform_fee_pct numeric not null default 3;
alter table orders add column if not exists platform_fee_amount numeric not null default 0;
alter table orders add column if not exists grand_total numeric not null default 0;

-- Extend the existing order-total trigger to also compute the platform fee
-- and grand total whenever order_items change. delivery_charge itself is set
-- once at order creation (by the hotel's distance entry) and left alone here.
create or replace function recalc_order_total()
returns trigger
security definer
set search_path = public
as $$
declare
  target_order_id uuid;
  new_total numeric;
  fee_pct numeric;
  delivery numeric;
  fee_amount numeric;
begin
  target_order_id := coalesce(new.order_id, old.order_id);

  select coalesce(sum(line_total), 0) into new_total
  from order_items where order_id = target_order_id;

  select coalesce(platform_fee_pct, 3), coalesce(delivery_charge, 0)
    into fee_pct, delivery
  from orders where id = target_order_id;

  fee_amount := round(new_total * fee_pct / 100, 2);

  update orders
  set order_total = new_total,
      commission_amount = round(new_total * commission_pct / 100, 2),
      gross_contribution = round(new_total * commission_pct / 100, 2) + delivery_contribution,
      platform_fee_amount = fee_amount,
      grand_total = new_total + fee_amount + delivery,
      updated_at = now()
  where id = target_order_id;

  return null;
end;
$$ language plpgsql;

-- Backfill grand_total/platform_fee_amount for orders that already existed
-- before this migration (their order_items won't fire the trigger again).
update orders
set platform_fee_amount = round(order_total * platform_fee_pct / 100, 2),
    grand_total = order_total + round(order_total * platform_fee_pct / 100, 2) + coalesce(delivery_charge, 0)
where grand_total = 0 or grand_total is null;

-- Payment-request tracking (used by the hotel/supplier order tables' Payment
-- column and OrderCard's payment gate).
alter table orders add column if not exists payment_requested_at timestamptz;
