-- ============================================================================
-- Migration 010 — Stock deduction, low-stock threshold, MOTOR webhook prep
-- Run on the OrderIt Supabase project. Safe to re-run.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Low-stock threshold per supplier price row (supplier sets it; defaults
--    to 5 so existing rows get a sane warning point automatically)
-- ----------------------------------------------------------------------------
alter table supplier_prices add column if not exists low_stock_threshold numeric not null default 5;

-- ----------------------------------------------------------------------------
-- 2. Deduct stock when an order is marked "packed" (the point goods are
--    physically set aside for dispatch). Matches against that supplier's
--    most recent price row per product, and auto-flips in_stock to false if
--    it hits zero. Only fires once per order (guarded by old.status check).
-- ----------------------------------------------------------------------------
create or replace function reduce_stock_on_pack()
returns trigger
security definer
set search_path = public
as $$
declare
  item record;
  target_price_id uuid;
begin
  if new.status = 'packed' and old.status is distinct from 'packed' then
    for item in select product_id, quantity from order_items where order_id = new.id loop
      select id into target_price_id
      from supplier_prices
      where supplier_id = new.supplier_id and product_id = item.product_id
      order by price_date desc
      limit 1;

      if target_price_id is not null then
        update supplier_prices
        set available_qty = greatest(coalesce(available_qty, 0) - item.quantity, 0)
        where id = target_price_id;

        update supplier_prices
        set in_stock = false
        where id = target_price_id and available_qty <= 0;
      end if;
    end loop;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_reduce_stock_on_pack on orders;
create trigger trg_reduce_stock_on_pack
  after update on orders
  for each row execute procedure reduce_stock_on_pack();

-- ----------------------------------------------------------------------------
-- 3. MOTOR webhook support: allow the webhook Edge Function (service role)
--    to be looked up unambiguously by motor_booking_id. Index for speed
--    since every webhook call does this lookup.
-- ----------------------------------------------------------------------------
create index if not exists idx_deliveries_motor_booking_id on deliveries(motor_booking_id);
alter table deliveries add column if not exists motor_driver_id uuid;
