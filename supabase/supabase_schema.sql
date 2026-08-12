-- ============================================================================
-- TRUFFLES POS / KDS — SUPABASE SCHEMA
-- ============================================================================
-- Run this once in your Supabase project's SQL Editor (Dashboard -> SQL
-- Editor -> New query -> paste -> Run). Reconstructed directly from every
-- table/column referenced in src/lib/supabase.js — there is no schema file
-- anywhere in the repo, so if you're seeing an empty app with zero network
-- requests to *.supabase.co, start here: these tables almost certainly
-- don't exist yet.
--
-- RLS policies below are intentionally permissive (anon key can read/write
-- everything) because this app has no server-side auth layer — the
-- anon/publishable key IS the only credential, for every screen (admin,
-- KDS, customer portal). That's fine for a single-restaurant demo/internal
-- tool; if you ever expose this beyond trusted staff/customers, tighten
-- these policies (e.g. restrict writes to specific columns/roles).
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- menu_categories
-- ---------------------------------------------------------------------------
create table if not exists menu_categories (
  id uuid primary key default gen_random_uuid(),
  category_name text not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- menu_items
-- ---------------------------------------------------------------------------
create table if not exists menu_items (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references menu_categories(id) on delete set null,
  item_name text not null,
  description text default '',
  price numeric not null default 0,
  veg boolean not null default true,
  available boolean not null default true,
  image_url text default '',
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- restaurant_tables
-- ---------------------------------------------------------------------------
create table if not exists restaurant_tables (
  id uuid primary key default gen_random_uuid(),
  table_number int not null unique,
  status text not null default 'vacant', -- vacant | occupied | reserved | needs_cleaning
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- orders
-- ---------------------------------------------------------------------------
create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  table_id uuid references restaurant_tables(id) on delete set null,
  customer_name text default 'Guest',
  customer_phone text default '',
  order_status text not null default 'New', -- New | Preparing | Ready | Served | Payment Pending | Completed | Cancelled
  payment_status text not null default 'Pending', -- Pending | Paid | Unpaid
  total numeric default 0,
  total_amount numeric default 0,
  discount numeric default 0,
  tax numeric default 0,
  notes text default '',
  items jsonb default '[]'::jsonb, -- used by pre-orders (no order_items rows yet)
  is_preorder boolean not null default false,
  preorder_ticket text,
  guests int default 1,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- order_items
-- ---------------------------------------------------------------------------
create table if not exists order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  menu_item_id uuid references menu_items(id) on delete set null,
  price numeric default 0,
  quantity int not null default 1,
  notes text default '',
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- feedback
-- ---------------------------------------------------------------------------
create table if not exists feedback (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id) on delete set null,
  rating int default 5,
  comments text default '',
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- reservations
-- ---------------------------------------------------------------------------
create table if not exists reservations (
  id uuid primary key default gen_random_uuid(),
  customer_name text not null,
  customer_phone text default '',
  table_id uuid references restaurant_tables(id) on delete set null,
  start_time timestamptz not null,
  end_time timestamptz not null,
  guest_count int default 2,
  status text not null default 'confirmed', -- confirmed | cancelled
  created_at timestamptz not null default now()
);

-- ============================================================================
-- INDEXES — the app filters/sorts on these constantly (see fetchOrders,
-- resolveOrderUuid, reservation overlap checks)
-- ============================================================================
create index if not exists idx_orders_status on orders (order_status, payment_status);
create index if not exists idx_orders_created_at on orders (created_at desc);
create index if not exists idx_orders_table_id on orders (table_id);
create index if not exists idx_order_items_order_id on order_items (order_id);
create index if not exists idx_reservations_table_time on reservations (table_id, start_time, end_time);

-- ============================================================================
-- ROW LEVEL SECURITY — enabled + permissive (see note at top of file)
-- ============================================================================
alter table menu_categories enable row level security;
alter table menu_items enable row level security;
alter table restaurant_tables enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;
alter table feedback enable row level security;
alter table reservations enable row level security;

-- One permissive "allow everything to anon + authenticated" policy per table.
-- Drop-and-recreate pattern so this script is safe to re-run.
do $$
declare
  t text;
begin
  foreach t in array array['menu_categories','menu_items','restaurant_tables','orders','order_items','feedback','reservations']
  loop
    execute format('drop policy if exists "allow_all_%s" on %I;', t, t);
    execute format(
      'create policy "allow_all_%s" on %I for all to anon, authenticated using (true) with check (true);',
      t, t
    );
  end loop;
end $$;

-- ============================================================================
-- REALTIME — the app subscribes to postgres_changes on these 5 tables
-- (src/lib/supabase.js: subscribeToRealtimeChanges). Adding them to the
-- supabase_realtime publication is what makes Realtime actually fire;
-- without this, the app still works via polling, just less instantly.
-- ============================================================================
do $$
begin
  alter publication supabase_realtime add table orders;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table order_items;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table restaurant_tables;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table menu_items;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table menu_categories;
exception when duplicate_object then null;
end $$;

-- ============================================================================
-- SEED DATA (optional) — the app auto-seeds its own default categories/menu
-- items/tables on first load IF these tables come back empty (see
-- RestoContext.jsx's loadSupabaseData -> INITIAL_CATEGORIES / INITIAL_MENU_ITEMS
-- / INITIAL_TABLES), so you don't strictly need to seed anything by hand —
-- just running everything above and then loading the app once should
-- populate it automatically. This block is here only as a manual fallback
-- if you'd rather seed directly in SQL, or want tables to exist immediately
-- without waiting on the app's first successful load.
-- ============================================================================
insert into restaurant_tables (table_number, status)
select n, 'vacant'
from generate_series(1, 20) as n
where not exists (select 1 from restaurant_tables where table_number = n);
