-- ============================================================================
-- Migration 012 — Auto-sync grand_total when delivery_charge changes
-- Run on the OrderIt Supabase project, after schema_platform_fee_and_delivery_formula.sql.
-- Safe to re-run.
--
-- Until now, delivery_charge was only ever set once, at order creation
-- (the hotel's checkout estimate). Once a real vehicle is booked (via MOTOR
-- or manually) with an actual distance, the true delivery cost can differ
-- from that estimate — this trigger makes updating orders.delivery_charge
-- from ANY code path (Edge Function, DeliveryPanel, admin) automatically
-- keep platform_fee_amount/grand_total correct, instead of relying on every
-- caller to recompute them by hand.
-- ============================================================================

create or replace function recalc_grand_total_on_orders_update()
returns trigger
language plpgsql
as $$
begin
  if new.delivery_charge is distinct from old.delivery_charge
     or new.order_total is distinct from old.order_total
     or new.platform_fee_pct is distinct from old.platform_fee_pct then
    new.platform_fee_amount := round(new.order_total * new.platform_fee_pct / 100, 2);
    new.grand_total := new.order_total + new.platform_fee_amount + coalesce(new.delivery_charge, 0);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_recalc_grand_total_on_orders_update on orders;
create trigger trg_recalc_grand_total_on_orders_update
  before update on orders
  for each row execute procedure recalc_grand_total_on_orders_update();
