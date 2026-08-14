-- ============================================================================
-- Migration 006 — Multi-item Request for Quote
-- Run in the Supabase SQL Editor after the previous migrations.
-- Turns quote_requests from "one product + qty" into a header with multiple
-- line items (quote_request_items), and supplier_quotes from "one price" into
-- a header with a matching set of per-item prices (supplier_quote_items),
-- summed into supplier_quotes.total_price automatically.
-- Safe to re-run; migrates any existing single-item data before dropping the
-- old columns.
-- ============================================================================

create table if not exists quote_request_items (
  id uuid primary key default gen_random_uuid(),
  request_id uuid references quote_requests(id) on delete cascade not null,
  product_id uuid references products(id) not null,
  quantity numeric not null check (quantity > 0),
  unique (request_id, product_id)
);

-- Migrate old single product_id/quantity columns on quote_requests, if present.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'quote_requests' and column_name = 'product_id'
  ) then
    insert into quote_request_items (request_id, product_id, quantity)
    select id, product_id, quantity from quote_requests
    where product_id is not null
    on conflict (request_id, product_id) do nothing;

    alter table quote_requests drop column if exists product_id;
    alter table quote_requests drop column if exists quantity;
  end if;
end $$;

create table if not exists supplier_quote_items (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid references supplier_quotes(id) on delete cascade not null,
  product_id uuid references products(id) not null,
  price numeric not null check (price > 0),
  grade text default 'A' check (grade in ('A','B')),
  available_qty numeric,
  unique (quote_id, product_id)
);

alter table supplier_quotes add column if not exists total_price numeric not null default 0;
alter table supplier_quotes add column if not exists notes text;

-- Migrate old single price/grade/available_qty columns on supplier_quotes, if
-- present. Old schema was strictly one item per request, so joining on
-- request_id safely attributes the old price to that one item.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'supplier_quotes' and column_name = 'price'
  ) then
    insert into supplier_quote_items (quote_id, product_id, price, grade, available_qty)
    select sq.id, qri.product_id, sq.price, sq.grade, sq.available_qty
    from supplier_quotes sq
    join quote_request_items qri on qri.request_id = sq.request_id
    on conflict (quote_id, product_id) do nothing;

    alter table supplier_quotes drop column if exists price;
    alter table supplier_quotes drop column if exists grade;
    alter table supplier_quotes drop column if exists available_qty;
  end if;
end $$;

-- Keep supplier_quotes.total_price = sum(item price * requested quantity)
create or replace function recalc_quote_total()
returns trigger
security definer
set search_path = public
as $$
declare
  target_quote_id uuid;
  new_total numeric;
begin
  target_quote_id := coalesce(new.quote_id, old.quote_id);
  select coalesce(sum(sqi.price * qri.quantity), 0) into new_total
  from supplier_quote_items sqi
  join supplier_quotes sq on sq.id = sqi.quote_id
  join quote_request_items qri on qri.request_id = sq.request_id and qri.product_id = sqi.product_id
  where sqi.quote_id = target_quote_id;
  update supplier_quotes set total_price = new_total where id = target_quote_id;
  return null;
end;
$$ language plpgsql;

drop trigger if exists trg_recalc_quote_total on supplier_quote_items;
create trigger trg_recalc_quote_total
  after insert or update or delete on supplier_quote_items
  for each row execute procedure recalc_quote_total();

alter table quote_request_items enable row level security;
alter table supplier_quote_items enable row level security;

drop policy if exists "quote_request_items_select" on quote_request_items;
create policy "quote_request_items_select" on quote_request_items
  for select using (
    exists (select 1 from quote_requests r join hotels h on h.id = r.hotel_id where r.id = request_id and h.profile_id = auth.uid())
    or exists (select 1 from suppliers s where s.profile_id = auth.uid())
    or is_admin()
  );
drop policy if exists "quote_request_items_insert_own_hotel" on quote_request_items;
create policy "quote_request_items_insert_own_hotel" on quote_request_items
  for insert with check (
    exists (select 1 from quote_requests r join hotels h on h.id = r.hotel_id where r.id = request_id and h.profile_id = auth.uid())
  );

drop policy if exists "supplier_quote_items_select" on supplier_quote_items;
create policy "supplier_quote_items_select" on supplier_quote_items
  for select using (
    exists (select 1 from supplier_quotes sq join suppliers s on s.id = sq.supplier_id where sq.id = quote_id and s.profile_id = auth.uid())
    or exists (
      select 1 from supplier_quotes sq
      join quote_requests r on r.id = sq.request_id
      join hotels h on h.id = r.hotel_id
      where sq.id = quote_id and h.profile_id = auth.uid()
    )
    or is_admin()
  );
drop policy if exists "supplier_quote_items_insert_own_supplier" on supplier_quote_items;
create policy "supplier_quote_items_insert_own_supplier" on supplier_quote_items
  for insert with check (
    exists (select 1 from supplier_quotes sq join suppliers s on s.id = sq.supplier_id where sq.id = quote_id and s.profile_id = auth.uid())
  );
drop policy if exists "supplier_quote_items_update_own_supplier" on supplier_quote_items;
create policy "supplier_quote_items_update_own_supplier" on supplier_quote_items
  for update using (
    exists (select 1 from supplier_quotes sq join suppliers s on s.id = sq.supplier_id where sq.id = quote_id and s.profile_id = auth.uid())
  );

do $$
begin
  begin
    alter publication supabase_realtime add table quote_request_items;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table supplier_quote_items;
  exception when duplicate_object then null;
  end;
end $$;
