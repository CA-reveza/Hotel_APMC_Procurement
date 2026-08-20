-- ============================================================================
-- Hotel <-> APMC Procurement Platform — Feature extensions
-- Run this AFTER schema.sql, once, in the Supabase SQL Editor.
-- Adds: Razorpay payments, delivery/consolidation routing, WhatsApp intake
-- support columns, and supplier bidding/quote requests. (Invoices need no
-- schema — generated client-side in src/lib/invoice.js.)
-- Safe to re-run: uses IF NOT EXISTS / DROP POLICY IF EXISTS throughout.
-- ============================================================================

alter table orders add column if not exists payment_status text not null default 'unpaid'
  check (payment_status in ('unpaid','paid','refunded'));
alter table orders add column if not exists source text not null default 'app'
  check (source in ('app','whatsapp'));

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
drop policy if exists "payments_select" on payments;
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
drop policy if exists "deliveries_select" on deliveries;
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
drop policy if exists "deliveries_write" on deliveries;
create policy "deliveries_write" on deliveries
  for all using (
    exists (
      select 1 from orders o join suppliers s on s.id = o.supplier_id
      where o.id = order_id and s.profile_id = auth.uid()
    ) or is_admin()
  ) with check (
    exists (
      select 1 from orders o join suppliers s on s.id = o.supplier_id
      where o.id = order_id and s.profile_id = auth.uid()
    ) or is_admin()
  );

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

drop policy if exists "requests_select" on quote_requests;
create policy "requests_select" on quote_requests
  for select using (
    exists (select 1 from hotels h where h.id = hotel_id and h.profile_id = auth.uid())
    or exists (select 1 from suppliers s where s.profile_id = auth.uid())
    or is_admin()
  );
drop policy if exists "requests_insert_hotel" on quote_requests;
create policy "requests_insert_hotel" on quote_requests
  for insert with check (
    exists (select 1 from hotels h where h.id = hotel_id and h.profile_id = auth.uid())
  );
drop policy if exists "requests_update_hotel" on quote_requests;
create policy "requests_update_hotel" on quote_requests
  for update using (
    exists (select 1 from hotels h where h.id = hotel_id and h.profile_id = auth.uid()) or is_admin()
  );

drop policy if exists "quotes_select" on supplier_quotes;
create policy "quotes_select" on supplier_quotes
  for select using (
    exists (select 1 from suppliers s where s.id = supplier_id and s.profile_id = auth.uid())
    or exists (
      select 1 from quote_requests r join hotels h on h.id = r.hotel_id
      where r.id = request_id and h.profile_id = auth.uid()
    )
    or is_admin()
  );
drop policy if exists "quotes_insert_supplier" on supplier_quotes;
create policy "quotes_insert_supplier" on supplier_quotes
  for insert with check (
    exists (select 1 from suppliers s where s.id = supplier_id and s.profile_id = auth.uid())
  );
drop policy if exists "quotes_update_supplier" on supplier_quotes;
create policy "quotes_update_supplier" on supplier_quotes
  for update using (
    exists (select 1 from suppliers s where s.id = supplier_id and s.profile_id = auth.uid())
  );

-- ----------------------------------------------------------------------------
-- Supplier-initiated payment requests (Razorpay Payment Links) + manual
-- "mark as paid" for cash/bank-transfer settlements collected offline.
-- Adds an in-between 'requested' payment_status: order has a live payment
-- link out to the hotel but isn't paid yet. Existing 'unpaid'/'paid' checks
-- in the app (`payment_status !== 'paid'`) keep working unchanged.
-- ----------------------------------------------------------------------------
alter table orders drop constraint if exists orders_payment_status_check;
alter table orders add constraint orders_payment_status_check
  check (payment_status in ('unpaid','requested','paid','refunded'));

alter table payments add column if not exists method text not null default 'razorpay'
  check (method in ('razorpay','manual'));
alter table payments add column if not exists link_id text;
alter table payments add column if not exists short_url text;
alter table payments drop constraint if exists payments_status_check;
alter table payments add constraint payments_status_check
  check (status in ('created','paid','failed','cancelled'));

do $$
begin
  begin
    alter publication supabase_realtime add table payments;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table deliveries;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table quote_requests;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table supplier_quotes;
  exception when duplicate_object then null;
  end;
end $$;
