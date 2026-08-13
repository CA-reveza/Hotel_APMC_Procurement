-- ============================================================================
-- Hotel <-> APMC Procurement Platform — Supabase Schema
-- Run this whole file once in Supabase SQL Editor (or via `supabase db push`)
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- PROFILES (mirrors auth.users, adds role)
-- ----------------------------------------------------------------------------
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique not null,
  full_name text,
  phone text,
  role text not null check (role in ('hotel','supplier','admin')) default 'hotel',
  created_at timestamptz default now()
);

-- Auto-create a profile row whenever a new auth user signs up.
-- Role + full_name are passed in via signUp() options.data
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into profiles (id, email, full_name, phone, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.raw_user_meta_data->>'phone', ''),
    coalesce(new.raw_user_meta_data->>'role', 'hotel')
  );
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- ----------------------------------------------------------------------------
-- HOTELS
-- ----------------------------------------------------------------------------
create table if not exists hotels (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references profiles(id) on delete cascade not null,
  name text not null,
  address text,
  city text default 'Bengaluru',
  gst_number text,
  credit_allowed boolean default false,
  created_at timestamptz default now()
);

-- ----------------------------------------------------------------------------
-- SUPPLIERS (APMC / wholesale)
-- ----------------------------------------------------------------------------
create table if not exists suppliers (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references profiles(id) on delete cascade not null,
  name text not null,
  apmc_yard text,
  address text,
  gst_number text,
  rating numeric default 0,
  created_at timestamptz default now()
);

-- ----------------------------------------------------------------------------
-- PRODUCTS (shared catalogue)
-- ----------------------------------------------------------------------------
create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text,
  unit text not null default 'kg',
  active boolean default true,
  created_at timestamptz default now()
);

-- ----------------------------------------------------------------------------
-- SUPPLIER PRICES (daily price list per supplier per product)
-- ----------------------------------------------------------------------------
create table if not exists supplier_prices (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid references suppliers(id) on delete cascade not null,
  product_id uuid references products(id) on delete cascade not null,
  price numeric not null check (price > 0),
  grade text default 'A' check (grade in ('A','B')),
  available_qty numeric default 0,
  price_date date default current_date,
  created_at timestamptz default now(),
  unique (supplier_id, product_id, price_date)
);

-- ----------------------------------------------------------------------------
-- ORDERS
-- ----------------------------------------------------------------------------
create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  hotel_id uuid references hotels(id) not null,
  supplier_id uuid references suppliers(id) not null,
  status text not null default 'pending'
    check (status in ('pending','accepted','rejected','packed','out_for_delivery','delivered','cancelled')),
  order_total numeric default 0,
  commission_pct numeric default 4,
  commission_amount numeric default 0,
  delivery_contribution numeric default 100,
  gross_contribution numeric default 0,
  delivery_slot text,
  delivery_address text,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ----------------------------------------------------------------------------
-- ORDER ITEMS
-- ----------------------------------------------------------------------------
create table if not exists order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id) on delete cascade not null,
  product_id uuid references products(id) not null,
  quantity numeric not null check (quantity > 0),
  unit_price numeric not null check (unit_price > 0),
  line_total numeric generated always as (quantity * unit_price) stored,
  created_at timestamptz default now()
);

-- ----------------------------------------------------------------------------
-- ORDER STATUS HISTORY (audit trail)
-- ----------------------------------------------------------------------------
create table if not exists order_status_history (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id) on delete cascade,
  status text not null,
  note text,
  changed_by uuid references profiles(id),
  created_at timestamptz default now()
);

-- ----------------------------------------------------------------------------
-- Recalculate order totals whenever order_items change
-- ----------------------------------------------------------------------------
create or replace function recalc_order_total()
returns trigger
security definer
set search_path = public
as $$
declare
  target_order_id uuid;
  new_total numeric;
begin
  target_order_id := coalesce(new.order_id, old.order_id);

  select coalesce(sum(line_total), 0) into new_total
  from order_items where order_id = target_order_id;

  update orders
  set order_total = new_total,
      commission_amount = round(new_total * commission_pct / 100, 2),
      gross_contribution = round(new_total * commission_pct / 100, 2) + delivery_contribution,
      updated_at = now()
  where id = target_order_id;

  return null;
end;
$$ language plpgsql;

drop trigger if exists trg_recalc_order_total on order_items;
create trigger trg_recalc_order_total
  after insert or update or delete on order_items
  for each row execute procedure recalc_order_total();

-- Log every status change automatically
create or replace function log_order_status_change()
returns trigger
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    insert into order_status_history (order_id, status, changed_by)
    values (new.id, new.status, auth.uid());
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_log_order_status on orders;
create trigger trg_log_order_status
  after update on orders
  for each row execute procedure log_order_status_change();

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
alter table profiles enable row level security;
alter table hotels enable row level security;
alter table suppliers enable row level security;
alter table products enable row level security;
alter table supplier_prices enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;
alter table order_status_history enable row level security;

-- Helper: is the current user an admin?
create or replace function is_admin()
returns boolean as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin');
$$ language sql security definer stable;

-- PROFILES: user can read/update own row; admin can read all
create policy "profiles_select_own_or_admin" on profiles
  for select using (id = auth.uid() or is_admin());
create policy "profiles_update_own" on profiles
  for update using (id = auth.uid());

-- HOTELS: owner (hotel profile) full access to own row, admin all, suppliers can read (for delivery info on their orders)
create policy "hotels_select" on hotels
  for select using (
    profile_id = auth.uid() or is_admin() or
    exists (select 1 from suppliers s where s.profile_id = auth.uid())
  );
create policy "hotels_insert_own" on hotels
  for insert with check (profile_id = auth.uid());
create policy "hotels_update_own" on hotels
  for update using (profile_id = auth.uid() or is_admin());

-- SUPPLIERS: readable by everyone authenticated (hotels need to browse suppliers/prices); write only by owner/admin
create policy "suppliers_select_all_authenticated" on suppliers
  for select using (auth.role() = 'authenticated');
create policy "suppliers_insert_own" on suppliers
  for insert with check (profile_id = auth.uid());
create policy "suppliers_update_own" on suppliers
  for update using (profile_id = auth.uid() or is_admin());

-- PRODUCTS: readable by all authenticated users; writable by admin only
create policy "products_select_all" on products
  for select using (auth.role() = 'authenticated');
create policy "products_write_admin" on products
  for insert with check (is_admin());
create policy "products_update_admin" on products
  for update using (is_admin());

-- SUPPLIER_PRICES: readable by all authenticated; writable by the owning supplier or admin
create policy "prices_select_all" on supplier_prices
  for select using (auth.role() = 'authenticated');
create policy "prices_write_own_supplier" on supplier_prices
  for insert with check (
    exists (select 1 from suppliers s where s.id = supplier_id and s.profile_id = auth.uid())
  );
create policy "prices_update_own_supplier" on supplier_prices
  for update using (
    exists (select 1 from suppliers s where s.id = supplier_id and s.profile_id = auth.uid()) or is_admin()
  );

-- ORDERS: hotel sees its own orders, supplier sees orders addressed to it, admin sees all
create policy "orders_select" on orders
  for select using (
    exists (select 1 from hotels h where h.id = hotel_id and h.profile_id = auth.uid())
    or exists (select 1 from suppliers s where s.id = supplier_id and s.profile_id = auth.uid())
    or is_admin()
  );
create policy "orders_insert_hotel" on orders
  for insert with check (
    exists (select 1 from hotels h where h.id = hotel_id and h.profile_id = auth.uid())
  );
create policy "orders_update" on orders
  for update using (
    exists (select 1 from hotels h where h.id = hotel_id and h.profile_id = auth.uid())
    or exists (select 1 from suppliers s where s.id = supplier_id and s.profile_id = auth.uid())
    or is_admin()
  );

-- ORDER_ITEMS: visible/writable by whoever can see the parent order
create policy "order_items_select" on order_items
  for select using (
    exists (
      select 1 from orders o
      left join hotels h on h.id = o.hotel_id
      left join suppliers s on s.id = o.supplier_id
      where o.id = order_id
      and (h.profile_id = auth.uid() or s.profile_id = auth.uid() or is_admin())
    )
  );
create policy "order_items_insert" on order_items
  for insert with check (
    exists (
      select 1 from orders o
      join hotels h on h.id = o.hotel_id
      where o.id = order_id and h.profile_id = auth.uid()
    )
  );

-- ORDER_STATUS_HISTORY: same visibility as parent order
create policy "history_select" on order_status_history
  for select using (
    exists (
      select 1 from orders o
      left join hotels h on h.id = o.hotel_id
      left join suppliers s on s.id = o.supplier_id
      where o.id = order_id
      and (h.profile_id = auth.uid() or s.profile_id = auth.uid() or is_admin())
    )
  );

-- ============================================================================
-- PHASE 2 — payments, delivery tracking, WhatsApp intake, supplier bidding
-- ============================================================================

alter table orders add column if not exists payment_status text not null default 'unpaid'
  check (payment_status in ('unpaid','paid','refunded'));
alter table orders add column if not exists source text not null default 'app'
  check (source in ('app','whatsapp'));

-- ----------------------------------------------------------------------------
-- PAYMENTS (Razorpay)
-- ----------------------------------------------------------------------------
create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id) on delete cascade not null,
  razorpay_order_id text,
  razorpay_payment_id text,
  razorpay_signature text,
  amount numeric not null,
  status text not null default 'created' check (status in ('created','paid','failed')),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table payments enable row level security;

create policy "payments_select" on payments
  for select using (
    exists (
      select 1 from orders o
      left join hotels h on h.id = o.hotel_id
      left join suppliers s on s.id = o.supplier_id
      where o.id = order_id
      and (h.profile_id = auth.uid() or s.profile_id = auth.uid() or is_admin())
    )
  );
-- Inserts/updates to payments only happen from Edge Functions using the
-- service role key, which bypasses RLS entirely — so no insert/update
-- policy is needed (and none is granted) for regular users.

-- ----------------------------------------------------------------------------
-- DELIVERIES (direct supplier→hotel, or via a consolidation hub)
-- ----------------------------------------------------------------------------
create table if not exists deliveries (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id) on delete cascade not null unique,
  delivery_type text not null default 'direct' check (delivery_type in ('direct','hub')),
  hub_name text,
  partner_name text,
  partner_phone text,
  picked_up_at timestamptz,
  delivered_at timestamptz,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table deliveries enable row level security;

create policy "deliveries_select" on deliveries
  for select using (
    exists (
      select 1 from orders o
      left join hotels h on h.id = o.hotel_id
      left join suppliers s on s.id = o.supplier_id
      where o.id = order_id
      and (h.profile_id = auth.uid() or s.profile_id = auth.uid() or is_admin())
    )
  );
create policy "deliveries_write" on deliveries
  for all using (
    exists (
      select 1 from orders o
      join suppliers s on s.id = o.supplier_id
      where o.id = order_id and s.profile_id = auth.uid()
    ) or is_admin()
  ) with check (
    exists (
      select 1 from orders o
      join suppliers s on s.id = o.supplier_id
      where o.id = order_id and s.profile_id = auth.uid()
    ) or is_admin()
  );

-- ----------------------------------------------------------------------------
-- SUPPLIER BIDDING — hotel posts a request, multiple suppliers quote, hotel picks
-- ----------------------------------------------------------------------------
create table if not exists quote_requests (
  id uuid primary key default gen_random_uuid(),
  hotel_id uuid references hotels(id) not null,
  product_id uuid references products(id) not null,
  quantity numeric not null check (quantity > 0),
  notes text,
  status text not null default 'open' check (status in ('open','closed','cancelled')),
  created_at timestamptz default now()
);

create table if not exists supplier_quotes (
  id uuid primary key default gen_random_uuid(),
  request_id uuid references quote_requests(id) on delete cascade not null,
  supplier_id uuid references suppliers(id) not null,
  price numeric not null check (price > 0),
  grade text default 'A' check (grade in ('A','B')),
  available_qty numeric,
  notes text,
  created_at timestamptz default now(),
  unique (request_id, supplier_id)
);

alter table quote_requests enable row level security;
alter table supplier_quotes enable row level security;

-- Requests: visible to the owning hotel, every supplier (so they can bid), and admin
create policy "requests_select" on quote_requests
  for select using (
    exists (select 1 from hotels h where h.id = hotel_id and h.profile_id = auth.uid())
    or exists (select 1 from suppliers s where s.profile_id = auth.uid())
    or is_admin()
  );
create policy "requests_insert_hotel" on quote_requests
  for insert with check (
    exists (select 1 from hotels h where h.id = hotel_id and h.profile_id = auth.uid())
  );
create policy "requests_update_hotel" on quote_requests
  for update using (
    exists (select 1 from hotels h where h.id = hotel_id and h.profile_id = auth.uid()) or is_admin()
  );

-- Quotes: visible to the quoting supplier, the requesting hotel, and admin
create policy "quotes_select" on supplier_quotes
  for select using (
    exists (select 1 from suppliers s where s.id = supplier_id and s.profile_id = auth.uid())
    or exists (
      select 1 from quote_requests r join hotels h on h.id = r.hotel_id
      where r.id = request_id and h.profile_id = auth.uid()
    )
    or is_admin()
  );
create policy "quotes_insert_supplier" on supplier_quotes
  for insert with check (
    exists (select 1 from suppliers s where s.id = supplier_id and s.profile_id = auth.uid())
  );
create policy "quotes_update_supplier" on supplier_quotes
  for update using (
    exists (select 1 from suppliers s where s.id = supplier_id and s.profile_id = auth.uid())
  );

alter publication supabase_realtime add table payments;
alter publication supabase_realtime add table deliveries;
alter publication supabase_realtime add table quote_requests;
alter publication supabase_realtime add table supplier_quotes;

-- ============================================================================
-- SEED DATA — starter catalogue (30 fast-moving APMC items from the plan)
-- ============================================================================
insert into products (name, category, unit) values
  ('Rice (Sona Masuri)', 'Grains', 'kg'),
  ('Wheat', 'Grains', 'kg'),
  ('Rava', 'Grains', 'kg'),
  ('Maida', 'Grains', 'kg'),
  ('Toor Dal', 'Pulses', 'kg'),
  ('Moong Dal', 'Pulses', 'kg'),
  ('Chana Dal', 'Pulses', 'kg'),
  ('Urad Dal', 'Pulses', 'kg'),
  ('Onion', 'Vegetables', 'kg'),
  ('Potato', 'Vegetables', 'kg'),
  ('Tomato', 'Vegetables', 'kg'),
  ('Green Chilli', 'Vegetables', 'kg'),
  ('Ginger', 'Vegetables', 'kg'),
  ('Garlic', 'Vegetables', 'kg'),
  ('Coriander Leaves', 'Vegetables', 'bunch'),
  ('Cooking Oil (Sunflower)', 'Oil', 'litre'),
  ('Sugar', 'Grocery', 'kg'),
  ('Salt', 'Grocery', 'kg'),
  ('Turmeric Powder', 'Spices', 'kg'),
  ('Red Chilli Powder', 'Spices', 'kg')
on conflict do nothing;

-- ============================================================================
-- REALTIME — enable replication so the apps can subscribe to changes
-- ============================================================================
alter publication supabase_realtime add table orders;
alter publication supabase_realtime add table order_items;
alter publication supabase_realtime add table supplier_prices;
