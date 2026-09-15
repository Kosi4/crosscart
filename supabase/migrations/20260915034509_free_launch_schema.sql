-- Free-launch schema: accounts, lists, items, price checks, stores, waitlist.
-- Payments/orders tables come later, once paid checkout is greenlit.
-- Money is integer minor units + ISO currency code. Every syncable row has
-- updated_at and a soft-delete deleted_at so clients can pull changes since a point in time.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------- profiles ----------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  preferred_currency text not null default 'USD' check (preferred_currency ~ '^[A-Z]{3}$'),
  theme text not null default 'light' check (theme in ('light', 'dark')),
  country text check (country ~ '^[A-Z]{2}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- stores (shared metadata, not user data) ----------

create table public.stores (
  domain text primary key check (domain = lower(domain)),
  display_name text,
  currency text check (currency ~ '^[A-Z]{3}$'),
  country text check (country ~ '^[A-Z]{2}$'),
  updated_at timestamptz not null default now()
);

create trigger stores_updated_at before update on public.stores
  for each row execute function public.set_updated_at();

-- ---------- lists ----------

create table public.lists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create unique index lists_user_name_active on public.lists (user_id, name) where deleted_at is null;
create index lists_user_updated on public.lists (user_id, updated_at);

create trigger lists_updated_at before update on public.lists
  for each row execute function public.set_updated_at();

-- ---------- list items ----------

create table public.list_items (
  -- Ids are generated on the device at save time so offline saves and merges stay idempotent.
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.lists (id) on delete cascade,
  -- Denormalized owner: lets RLS and "changes since" sync queries skip a join.
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  url text not null check (url ~* '^https?://'),
  canonical_url text not null check (canonical_url ~* '^https?://'),
  domain text not null,
  title text not null check (char_length(title) between 1 and 500),
  image_url text check (image_url is null or image_url ~* '^https?://'),
  saved_price_minor bigint check (saved_price_minor >= 0),
  saved_currency text check (saved_currency ~ '^[A-Z]{3}$'),
  quantity integer not null default 1 check (quantity between 1 and 999),
  position integer not null default 0,
  variant_selected jsonb not null default '{}'::jsonb check (jsonb_typeof(variant_selected) = 'object'),
  variant_options jsonb not null default '{}'::jsonb check (jsonb_typeof(variant_options) = 'object'),
  variant_source text check (variant_source in ('jsonld', 'shopify_json', 'woo_form', 'dom_label', 'none')),
  variant_confidence text check (variant_confidence in ('high', 'low')),
  options_checked_at timestamptz,
  saved_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Same product + same variant in one list is one line; a different size is a separate line.
create unique index list_items_dedupe_active
  on public.list_items (list_id, canonical_url, variant_selected) where deleted_at is null;
create index list_items_user_updated on public.list_items (user_id, updated_at);
create index list_items_list on public.list_items (list_id);

create trigger list_items_updated_at before update on public.list_items
  for each row execute function public.set_updated_at();

-- ---------- price checks ----------

create table public.price_checks (
  id uuid primary key default gen_random_uuid(),
  list_item_id uuid not null references public.list_items (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  variant_selected jsonb not null default '{}'::jsonb,
  price_minor bigint check (price_minor >= 0),
  currency text check (currency ~ '^[A-Z]{3}$'),
  in_stock boolean,
  checked_at timestamptz not null default now()
);

create index price_checks_item_checked on public.price_checks (list_item_id, checked_at desc);
create index price_checks_user on public.price_checks (user_id);

-- ---------- waitlist (demand signal for paid checkout) ----------

create table public.waitlist (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique default auth.uid() references auth.users (id) on delete cascade,
  cart_item_count integer check (cart_item_count >= 0),
  cart_value_minor bigint check (cart_value_minor >= 0),
  cart_currency text check (cart_currency ~ '^[A-Z]{3}$'),
  store_domains text[] not null default '{}',
  created_at timestamptz not null default now()
);

-- ---------- row-level security ----------

alter table public.profiles enable row level security;
alter table public.stores enable row level security;
alter table public.lists enable row level security;
alter table public.list_items enable row level security;
alter table public.price_checks enable row level security;
alter table public.waitlist enable row level security;

create policy "own profile: read" on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy "own profile: update" on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- Store metadata is public; only the service role writes it.
create policy "stores: read" on public.stores
  for select to anon, authenticated using (true);

create policy "own lists: read" on public.lists
  for select to authenticated using (user_id = (select auth.uid()));
create policy "own lists: insert" on public.lists
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "own lists: update" on public.lists
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own lists: delete" on public.lists
  for delete to authenticated using (user_id = (select auth.uid()));

-- Items must belong to the caller AND sit in a list the caller owns.
create policy "own items: read" on public.list_items
  for select to authenticated using (user_id = (select auth.uid()));
create policy "own items: insert" on public.list_items
  for insert to authenticated with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.lists l where l.id = list_id and l.user_id = (select auth.uid()))
  );
create policy "own items: update" on public.list_items
  for update to authenticated using (user_id = (select auth.uid())) with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.lists l where l.id = list_id and l.user_id = (select auth.uid()))
  );
create policy "own items: delete" on public.list_items
  for delete to authenticated using (user_id = (select auth.uid()));

create policy "own price checks: read" on public.price_checks
  for select to authenticated using (user_id = (select auth.uid()));
create policy "own price checks: insert" on public.price_checks
  for insert to authenticated with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.list_items i where i.id = list_item_id and i.user_id = (select auth.uid()))
  );

create policy "own waitlist: read" on public.waitlist
  for select to authenticated using (user_id = (select auth.uid()));
create policy "own waitlist: insert" on public.waitlist
  for insert to authenticated with check (user_id = (select auth.uid()));
