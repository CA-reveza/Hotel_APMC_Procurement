-- ============================================================================
-- Migration 003 — In Stock / Out of Stock flag on supplier prices
-- Run in the Supabase SQL Editor after schema.sql + schema_extensions.sql.
-- Safe to re-run.
-- ============================================================================

alter table supplier_prices add column if not exists in_stock boolean not null default true;

-- Backfill: anything with 0 (or no) available quantity is treated as out of
-- stock so existing rows don't silently show "in stock" with nothing to sell.
update supplier_prices set in_stock = false where coalesce(available_qty, 0) <= 0;
