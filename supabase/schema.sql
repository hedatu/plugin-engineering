-- Supabase + Waffo + Chrome Extension Membership Schema
-- Version: 2026-04-21
-- Run in Supabase SQL editor or through migrations.

create extension if not exists pgcrypto;

-- =========================
-- 1. Helper timestamps
-- =========================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- =========================
-- 2. Core user profile
-- =========================

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists profiles_email_unique_idx on public.profiles(lower(email));

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, coalesce(new.email, ''))
  on conflict (id) do update set email = excluded.email, updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- =========================
-- 3. Products and plans
-- =========================

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  product_key text not null unique,
  slug text not null unique,
  name text not null,
  description text,
  chrome_extension_id text,
  website_url text,
  status text not null default 'active' check (status in ('draft','active','archived')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_products_updated_at on public.products;
create trigger trg_products_updated_at
before update on public.products
for each row execute function public.set_updated_at();

create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  plan_key text not null,
  name text not null,
  description text,
  billing_type text not null check (billing_type in ('free','monthly','yearly','lifetime','onetime')),
  currency text not null default 'USD',
  amount numeric(12,2) not null default 0,
  waffo_product_id_test text,
  waffo_product_id_prod text,
  waffo_product_type_test text,
  waffo_product_type_prod text,
  waffo_plan_id_test text,
  waffo_plan_id_prod text,
  waffo_price_id_test text,
  waffo_price_id_prod text,
  features jsonb not null default '{}'::jsonb,
  quotas jsonb not null default '{}'::jsonb,
  max_installations int not null default 1,
  is_public boolean not null default true,
  status text not null default 'active' check (status in ('draft','active','archived')),
  sort_order int not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(product_id, plan_key)
);

create index if not exists plans_product_status_idx on public.plans(product_id, status, is_public);

drop trigger if exists trg_plans_updated_at on public.plans;
create trigger trg_plans_updated_at
before update on public.plans
for each row execute function public.set_updated_at();

-- =========================
-- 4. Checkout, billing, subscriptions
-- =========================

create table if not exists public.checkout_sessions (
  id uuid primary key default gen_random_uuid(),
  local_order_id text not null unique,
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.products(id),
  plan_id uuid not null references public.plans(id),
  installation_id text,
  source text not null default 'web' check (source in ('web','chrome_extension','admin')),
  mode text not null default 'test' check (mode in ('test','prod')),
  currency text not null default 'USD',
  amount numeric(12,2),
  waffo_session_id text unique,
  checkout_url text,
  expires_at timestamptz,
  status text not null default 'created' check (status in ('created','opened','completed','expired','failed','canceled')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists checkout_sessions_user_idx on public.checkout_sessions(user_id, created_at desc);
create index if not exists checkout_sessions_status_idx on public.checkout_sessions(status);

drop trigger if exists trg_checkout_sessions_updated_at on public.checkout_sessions;
create trigger trg_checkout_sessions_updated_at
before update on public.checkout_sessions
for each row execute function public.set_updated_at();

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.products(id),
  plan_id uuid references public.plans(id),
  checkout_session_id uuid references public.checkout_sessions(id),
  mode text not null check (mode in ('test','prod')),
  waffo_order_id text not null,
  order_type text not null check (order_type in ('one_time','subscription')),
  order_status text not null,
  buyer_email text,
  buyer_identity jsonb,
  merchant_provided_buyer_identity text,
  currency text not null,
  amount numeric(12,2),
  tax_amount numeric(12,2),
  subtotal numeric(12,2),
  total numeric(12,2),
  product_name text,
  waffo_plan_id text,
  waffo_price_id text,
  order_metadata jsonb not null default '{}'::jsonb,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(mode, waffo_order_id)
);

create index if not exists orders_user_idx on public.orders(user_id, created_at desc);

drop trigger if exists trg_orders_updated_at on public.orders;
create trigger trg_orders_updated_at
before update on public.orders
for each row execute function public.set_updated_at();

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  order_id uuid references public.orders(id) on delete set null,
  product_id uuid not null references public.products(id),
  plan_id uuid references public.plans(id),
  mode text not null check (mode in ('test','prod')),
  waffo_payment_id text not null,
  waffo_order_id text,
  payment_status text not null,
  payment_method text,
  payment_last4 text,
  payment_date date,
  currency text not null,
  amount numeric(12,2),
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(mode, waffo_payment_id)
);

create index if not exists payments_user_idx on public.payments(user_id, created_at desc);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.products(id),
  plan_id uuid not null references public.plans(id),
  order_id uuid references public.orders(id) on delete set null,
  mode text not null check (mode in ('test','prod')),
  waffo_order_id text not null,
  status text not null check (status in ('active','canceling','past_due','canceled','revoked')),
  billing_period text check (billing_period in ('weekly','monthly','quarterly','yearly')),
  current_period_start date,
  current_period_end date,
  canceled_at timestamptz,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(mode, waffo_order_id)
);

create index if not exists subscriptions_user_product_idx on public.subscriptions(user_id, product_id, status);

drop trigger if exists trg_subscriptions_updated_at on public.subscriptions;
create trigger trg_subscriptions_updated_at
before update on public.subscriptions
for each row execute function public.set_updated_at();

-- =========================
-- 5. Entitlements, usage and installations
-- =========================

create table if not exists public.entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.products(id),
  plan_id uuid references public.plans(id),
  subscription_id uuid references public.subscriptions(id) on delete set null,
  order_id uuid references public.orders(id) on delete set null,
  source_type text not null check (source_type in ('free','purchase','subscription','manual')),
  status text not null default 'active' check (status in ('active','canceling','past_due','expired','revoked')),
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  features_override jsonb,
  quotas_override jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, product_id, source_type)
);

create index if not exists entitlements_lookup_idx on public.entitlements(user_id, product_id, status, expires_at);

drop trigger if exists trg_entitlements_updated_at on public.entitlements;
create trigger trg_entitlements_updated_at
before update on public.entitlements
for each row execute function public.set_updated_at();

create table if not exists public.usage_counters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  feature_key text not null,
  period_type text not null check (period_type in ('day','month','lifetime')),
  period_start timestamptz not null,
  used_count int not null default 0,
  limit_value int not null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(user_id, product_id, feature_key, period_type, period_start)
);

create index if not exists usage_counters_lookup_idx on public.usage_counters(user_id, product_id, feature_key, period_start desc);

create table if not exists public.installations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  installation_id text not null,
  extension_id text,
  browser text,
  version text,
  device_label text,
  status text not null default 'active' check (status in ('active','revoked')),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  unique(user_id, product_id, installation_id)
);

create index if not exists installations_user_product_idx on public.installations(user_id, product_id, status);

-- =========================
-- 6. Webhook events and audit
-- =========================

create table if not exists public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  mode text not null check (mode in ('test','prod')),
  event_type text not null,
  event_id text not null,
  entity_id text,
  signature_valid boolean not null default false,
  raw_payload jsonb not null,
  raw_body text,
  processing_error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique(mode, event_type, event_id)
);

create index if not exists webhook_events_received_idx on public.webhook_events(received_at desc);
create index if not exists webhook_events_unprocessed_idx on public.webhook_events(processed_at) where processed_at is null;

create table if not exists public.processed_webhooks (
  id uuid primary key default gen_random_uuid(),
  mode text not null check (mode in ('test','prod')),
  event_type text not null,
  event_id text not null,
  entity_id text,
  signature_valid boolean not null default false,
  raw_payload jsonb not null,
  raw_body text,
  processing_error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique(mode, event_type, event_id)
);

create index if not exists processed_webhooks_received_idx on public.processed_webhooks(received_at desc);
create index if not exists processed_webhooks_unprocessed_idx on public.processed_webhooks(processed_at) where processed_at is null;

create table if not exists public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  target_table text,
  target_id uuid,
  before_value jsonb,
  after_value jsonb,
  created_at timestamptz not null default now()
);

-- =========================
-- 7. Effective plan helpers
-- =========================

create or replace function public.get_effective_plan(p_user_id uuid, p_product_key text)
returns table (
  product_id uuid,
  plan_id uuid,
  entitlement_id uuid,
  product_key text,
  plan_key text,
  entitlement_status text,
  billing_type text,
  features jsonb,
  quotas jsonb,
  max_installations int,
  expires_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  with product_row as (
    select * from public.products where product_key = p_product_key and status = 'active' limit 1
  ), active_entitlement as (
    select e.*
    from public.entitlements e
    join product_row p on p.id = e.product_id
    where e.user_id = p_user_id
      and e.status in ('active','canceling','past_due')
      and (e.expires_at is null or e.expires_at > now())
    order by
      case e.source_type when 'subscription' then 1 when 'purchase' then 2 when 'manual' then 3 when 'free' then 4 else 9 end,
      e.created_at desc
    limit 1
  ), chosen_plan as (
    select
      p.id as product_id,
      pl.id as plan_id,
      ae.id as entitlement_id,
      p.product_key,
      pl.plan_key,
      coalesce(ae.status, 'active') as entitlement_status,
      pl.billing_type,
      coalesce(ae.features_override, pl.features) as features,
      coalesce(ae.quotas_override, pl.quotas) as quotas,
      pl.max_installations,
      ae.expires_at
    from product_row p
    left join active_entitlement ae on true
    join public.plans pl on pl.id = coalesce(ae.plan_id, (
      select fp.id from public.plans fp
      where fp.product_id = p.id and fp.plan_key = 'free' and fp.status = 'active'
      limit 1
    ))
  )
  select * from chosen_plan;
$$;

-- =========================
-- 8. Atomic quota consumption
-- =========================

create or replace function public.consume_feature_usage(
  p_user_id uuid,
  p_product_key text,
  p_feature_key text,
  p_amount int default 1
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  ep record;
  quota jsonb;
  quota_period text;
  quota_limit int;
  period_start_value timestamptz;
  current_used int;
begin
  if p_amount is null or p_amount <= 0 then
    return jsonb_build_object('allowed', false, 'errorCode', 'INVALID_AMOUNT');
  end if;

  select * into ep from public.get_effective_plan(p_user_id, p_product_key) limit 1;

  if ep.product_id is null then
    return jsonb_build_object('allowed', false, 'errorCode', 'PRODUCT_NOT_FOUND');
  end if;

  if coalesce((ep.features ->> p_feature_key)::boolean, false) is not true then
    return jsonb_build_object('allowed', false, 'errorCode', 'FEATURE_NOT_ENABLED');
  end if;

  quota := ep.quotas -> p_feature_key;

  if quota is null then
    -- Feature exists but no quota means unlimited.
    return jsonb_build_object('allowed', true, 'remaining', -1, 'planKey', ep.plan_key);
  end if;

  quota_period := coalesce(quota ->> 'period', 'lifetime');
  quota_limit := coalesce((quota ->> 'limit')::int, -1);

  if quota_limit = -1 then
    return jsonb_build_object('allowed', true, 'remaining', -1, 'planKey', ep.plan_key);
  end if;

  if quota_period = 'day' then
    period_start_value := date_trunc('day', now());
  elsif quota_period = 'month' then
    period_start_value := date_trunc('month', now());
  else
    period_start_value := '1970-01-01 00:00:00+00'::timestamptz;
    quota_period := 'lifetime';
  end if;

  insert into public.usage_counters (
    user_id, product_id, feature_key, period_type, period_start, used_count, limit_value
  ) values (
    p_user_id, ep.product_id, p_feature_key, quota_period, period_start_value, p_amount, quota_limit
  )
  on conflict (user_id, product_id, feature_key, period_type, period_start)
  do update set
    used_count = public.usage_counters.used_count + p_amount,
    limit_value = excluded.limit_value,
    updated_at = now()
  where public.usage_counters.used_count + p_amount <= excluded.limit_value
  returning used_count into current_used;

  if current_used is null then
    select used_count into current_used
    from public.usage_counters
    where user_id = p_user_id
      and product_id = ep.product_id
      and feature_key = p_feature_key
      and period_type = quota_period
      and period_start = period_start_value;

    return jsonb_build_object(
      'allowed', false,
      'errorCode', 'QUOTA_EXCEEDED',
      'used', coalesce(current_used, 0),
      'limit', quota_limit,
      'remaining', greatest(quota_limit - coalesce(current_used, 0), 0),
      'planKey', ep.plan_key
    );
  end if;

  return jsonb_build_object(
    'allowed', true,
    'used', current_used,
    'limit', quota_limit,
    'remaining', greatest(quota_limit - current_used, 0),
    'planKey', ep.plan_key
  );
end;
$$;

-- =========================
-- 9. RLS policies
-- =========================

alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.plans enable row level security;
alter table public.checkout_sessions enable row level security;
alter table public.orders enable row level security;
alter table public.payments enable row level security;
alter table public.subscriptions enable row level security;
alter table public.entitlements enable row level security;
alter table public.usage_counters enable row level security;
alter table public.installations enable row level security;
alter table public.webhook_events enable row level security;
alter table public.processed_webhooks enable row level security;
alter table public.admin_audit_logs enable row level security;

-- Drop existing policies by known names for idempotency.
drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_select_own" on public.profiles for select using (auth.uid() = id);
create policy "profiles_update_own" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "products_select_active" on public.products;
create policy "products_select_active" on public.products for select using (status = 'active');

drop policy if exists "plans_select_public_active" on public.plans;
create policy "plans_select_public_active" on public.plans for select using (status = 'active' and is_public = true);

drop policy if exists "checkout_sessions_select_own" on public.checkout_sessions;
create policy "checkout_sessions_select_own" on public.checkout_sessions for select using (auth.uid() = user_id);

drop policy if exists "orders_select_own" on public.orders;
create policy "orders_select_own" on public.orders for select using (auth.uid() = user_id);

drop policy if exists "payments_select_own" on public.payments;
create policy "payments_select_own" on public.payments for select using (auth.uid() = user_id);

drop policy if exists "subscriptions_select_own" on public.subscriptions;
create policy "subscriptions_select_own" on public.subscriptions for select using (auth.uid() = user_id);

drop policy if exists "entitlements_select_own" on public.entitlements;
create policy "entitlements_select_own" on public.entitlements for select using (auth.uid() = user_id);

drop policy if exists "usage_counters_select_own" on public.usage_counters;
create policy "usage_counters_select_own" on public.usage_counters for select using (auth.uid() = user_id);

drop policy if exists "installations_select_own" on public.installations;
create policy "installations_select_own" on public.installations for select using (auth.uid() = user_id);

-- No public policies for webhook_events/admin_audit_logs. Service role bypasses RLS.

-- =========================
-- 10. Seed MVP product and plans
-- =========================

insert into public.products (
  product_key,
  slug,
  name,
  description,
  status,
  metadata
)
values (
  'chatgpt2obsidian',
  'chatgpt2obsidian',
  'ChatGPT to Obsidian Exporter',
  'Legacy test-only product retained for backward compatibility during the hwh cutover.',
  'draft',
  jsonb_build_object(
    'lifecycle', 'legacy_test_only',
    'replacementProductKey', 'leadfill-one-profile'
  )
)
on conflict (product_key) do update set
  name = excluded.name,
  description = excluded.description,
  status = excluded.status,
  metadata = excluded.metadata,
  updated_at = now();

with p as (
  select id from public.products where product_key = 'chatgpt2obsidian'
)
insert into public.plans (
  product_id, plan_key, name, description, billing_type, currency, amount,
  features, quotas, max_installations, sort_order, status, is_public, metadata
)
select p.id, 'free', 'Free', 'Legacy test-only free plan', 'free', 'USD', 0,
  '{"single_export": true, "batch_export": false, "image_download": false}'::jsonb,
  '{"single_export": {"period": "day", "limit": 5}}'::jsonb,
  1, 0, 'draft', false,
  '{"lifecycle":"legacy_test_only"}'::jsonb
from p
on conflict (product_id, plan_key) do update set
  features = excluded.features,
  quotas = excluded.quotas,
  max_installations = excluded.max_installations,
  status = excluded.status,
  is_public = excluded.is_public,
  metadata = excluded.metadata,
  updated_at = now();

with p as (
  select id from public.products where product_key = 'chatgpt2obsidian'
)
insert into public.plans (
  product_id, plan_key, name, description, billing_type, currency, amount,
  features, quotas, max_installations, sort_order, status, is_public, metadata
)
select p.id, 'pro_monthly', 'Pro Monthly', 'Legacy monthly membership', 'monthly', 'USD', 9.99,
  '{"single_export": true, "batch_export": true, "image_download": true}'::jsonb,
  '{"single_export": {"period": "day", "limit": -1}, "batch_export": {"period": "month", "limit": -1}, "image_download": {"period": "month", "limit": -1}}'::jsonb,
  3, 10, 'draft', false,
  '{"lifecycle":"legacy_test_only"}'::jsonb
from p
on conflict (product_id, plan_key) do update set
  features = excluded.features,
  quotas = excluded.quotas,
  max_installations = excluded.max_installations,
  status = excluded.status,
  is_public = excluded.is_public,
  metadata = excluded.metadata,
  updated_at = now();

with p as (
  select id from public.products where product_key = 'chatgpt2obsidian'
)
insert into public.plans (
  product_id, plan_key, name, description, billing_type, currency, amount,
  waffo_product_id_test, waffo_product_type_test,
  features, quotas, max_installations, sort_order, status, is_public, metadata
)
select p.id, 'lifetime', 'Lifetime', 'Legacy one-time lifetime membership', 'onetime', 'USD', 49.00,
  'PROD_1LTEolO39KqxFSQLCXeAgR', 'onetime',
  '{"single_export": true, "batch_export": true, "image_download": true}'::jsonb,
  '{"single_export": {"period": "day", "limit": -1}, "batch_export": {"period": "month", "limit": -1}, "image_download": {"period": "month", "limit": -1}}'::jsonb,
  5, 20, 'draft', false,
  '{"lifecycle":"legacy_test_only"}'::jsonb
from p
on conflict (product_id, plan_key) do update set
  billing_type = excluded.billing_type,
  currency = excluded.currency,
  amount = excluded.amount,
  waffo_product_id_test = excluded.waffo_product_id_test,
  waffo_product_type_test = excluded.waffo_product_type_test,
  features = excluded.features,
  quotas = excluded.quotas,
  max_installations = excluded.max_installations,
  status = excluded.status,
  is_public = excluded.is_public,
  metadata = excluded.metadata,
  updated_at = now();

with p as (
  select id from public.products where product_key = 'chatgpt2obsidian'
)
insert into public.plans (
  product_id, plan_key, name, description, billing_type, currency, amount,
  waffo_product_id_test, waffo_product_type_test,
  features, quotas, max_installations, sort_order, status, is_public, metadata
)
select p.id, 'one_time_test', 'One-time Test', 'Legacy Waffo Pancake test checkout plan.', 'onetime', 'USD', 49.00,
  'PROD_1LTEolO39KqxFSQLCXeAgR', 'onetime',
  '{"single_export": true, "batch_export": true, "image_download": true}'::jsonb,
  '{"single_export": {"period": "day", "limit": -1}, "batch_export": {"period": "month", "limit": -1}, "image_download": {"period": "month", "limit": -1}}'::jsonb,
  5, 15, 'draft', false,
  '{"lifecycle":"legacy_test_only"}'::jsonb
from p
on conflict (product_id, plan_key) do update set
  name = excluded.name,
  description = excluded.description,
  billing_type = excluded.billing_type,
  currency = excluded.currency,
  amount = excluded.amount,
  waffo_product_id_test = excluded.waffo_product_id_test,
  waffo_product_type_test = excluded.waffo_product_type_test,
  features = excluded.features,
  quotas = excluded.quotas,
  max_installations = excluded.max_installations,
  status = excluded.status,
  is_public = excluded.is_public,
  metadata = excluded.metadata,
  updated_at = now();

insert into public.products (
  product_key,
  slug,
  name,
  description,
  website_url,
  status,
  metadata
)
values (
  'leadfill-one-profile',
  'leadfill-one-profile',
  'LeadFill One Profile',
  'Local-only Chrome extension membership for filling forms from one saved profile.',
  'https://hwh.915500.xyz/products/leadfill-one-profile',
  'active',
  jsonb_build_object(
    'priceLabel', '$19 lifetime',
    'freeLimit', 10,
    'featureKey', 'leadfill_fill_action',
    'paymentProvider', 'hwh_waffo',
    'checkoutMode', 'test'
  )
)
on conflict (product_key) do update set
  slug = excluded.slug,
  name = excluded.name,
  description = excluded.description,
  website_url = excluded.website_url,
  status = excluded.status,
  metadata = excluded.metadata,
  updated_at = now();

with p as (
  select id from public.products where product_key = 'leadfill-one-profile'
)
insert into public.plans (
  product_id, plan_key, name, description, billing_type, currency, amount,
  features, quotas, max_installations, sort_order, status, is_public, metadata
)
select p.id, 'free', 'Free', '10 free local fills with one saved profile.', 'free', 'USD', 0,
  '{"leadfill_fill_action": true, "saved_profile": true, "profile_edit": false, "profile_delete": false, "advanced_field_support": false}'::jsonb,
  '{"leadfill_fill_action": {"period": "lifetime", "limit": 10}}'::jsonb,
  1, 0, 'active', true,
  '{"priceLabel":"Free","freeLimit":10,"featureKey":"leadfill_fill_action"}'::jsonb
from p
on conflict (product_id, plan_key) do update set
  name = excluded.name,
  description = excluded.description,
  billing_type = excluded.billing_type,
  currency = excluded.currency,
  amount = excluded.amount,
  features = excluded.features,
  quotas = excluded.quotas,
  max_installations = excluded.max_installations,
  status = excluded.status,
  is_public = excluded.is_public,
  metadata = excluded.metadata,
  updated_at = now();

with p as (
  select id from public.products where product_key = 'leadfill-one-profile'
)
insert into public.plans (
  product_id, plan_key, name, description, billing_type, currency, amount,
  waffo_product_id_test, waffo_product_type_test,
  features, quotas, max_installations, sort_order, status, is_public, metadata
)
select p.id, 'lifetime', 'Lifetime Unlock', '$19 one-time unlock for unlimited LeadFill fills.', 'onetime', 'USD', 19.00,
  'PROD_1LTEolO39KqxFSQLCXeAgR', 'onetime',
  '{"leadfill_fill_action": true, "saved_profile": true, "profile_edit": true, "profile_delete": true, "advanced_field_support": true}'::jsonb,
  '{"leadfill_fill_action": {"period": "lifetime", "limit": -1}}'::jsonb,
  3, 10, 'active', true,
  '{"priceLabel":"$19 lifetime","featureKey":"leadfill_fill_action","waffoMapping":"shared_test_onetime_product"}'::jsonb
from p
on conflict (product_id, plan_key) do update set
  name = excluded.name,
  description = excluded.description,
  billing_type = excluded.billing_type,
  currency = excluded.currency,
  amount = excluded.amount,
  waffo_product_id_test = excluded.waffo_product_id_test,
  waffo_product_type_test = excluded.waffo_product_type_test,
  features = excluded.features,
  quotas = excluded.quotas,
  max_installations = excluded.max_installations,
  status = excluded.status,
  is_public = excluded.is_public,
  metadata = excluded.metadata,
  updated_at = now();
