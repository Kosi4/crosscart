-- The pre-sale price when a product was on sale at save time (same currency as saved_price_minor),
-- so carts can show "was R19 299, -22%". Null when there was no sale.
alter table public.list_items add column if not exists original_price_minor bigint
  check (original_price_minor is null or original_price_minor > 0);
