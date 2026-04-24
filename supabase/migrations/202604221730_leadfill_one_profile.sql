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
  metadata = coalesce(public.products.metadata, '{}'::jsonb) || excluded.metadata,
  updated_at = now();

update public.products
set
  status = 'draft',
  metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
    'lifecycle', 'legacy_test_only',
    'replacementProductKey', 'leadfill-one-profile'
  ),
  updated_at = now()
where product_key = 'chatgpt2obsidian';

update public.plans
set
  status = 'draft',
  is_public = false,
  metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
    'lifecycle', 'legacy_test_only',
    'replacementProductKey', 'leadfill-one-profile'
  ),
  updated_at = now()
where product_id in (
  select id from public.products where product_key = 'chatgpt2obsidian'
);

with p as (
  select id from public.products where product_key = 'leadfill-one-profile'
)
insert into public.plans (
  product_id,
  plan_key,
  name,
  description,
  billing_type,
  currency,
  amount,
  features,
  quotas,
  max_installations,
  sort_order,
  status,
  is_public,
  metadata
)
select
  p.id,
  'free',
  'Free',
  '10 free local fills with one saved profile.',
  'free',
  'USD',
  0,
  '{"leadfill_fill_action": true, "saved_profile": true, "profile_edit": false, "profile_delete": false, "advanced_field_support": false}'::jsonb,
  '{"leadfill_fill_action": {"period": "lifetime", "limit": 10}}'::jsonb,
  1,
  0,
  'active',
  true,
  jsonb_build_object(
    'priceLabel', 'Free',
    'freeLimit', 10,
    'featureKey', 'leadfill_fill_action'
  )
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
  metadata = coalesce(public.plans.metadata, '{}'::jsonb) || excluded.metadata,
  updated_at = now();

with p as (
  select id from public.products where product_key = 'leadfill-one-profile'
)
insert into public.plans (
  product_id,
  plan_key,
  name,
  description,
  billing_type,
  currency,
  amount,
  waffo_product_id_test,
  waffo_product_type_test,
  features,
  quotas,
  max_installations,
  sort_order,
  status,
  is_public,
  metadata
)
select
  p.id,
  'lifetime',
  'Lifetime Unlock',
  '$19 one-time unlock for unlimited LeadFill fills.',
  'onetime',
  'USD',
  19.00,
  'PROD_1LTEolO39KqxFSQLCXeAgR',
  'onetime',
  '{"leadfill_fill_action": true, "saved_profile": true, "profile_edit": true, "profile_delete": true, "advanced_field_support": true}'::jsonb,
  '{"leadfill_fill_action": {"period": "lifetime", "limit": -1}}'::jsonb,
  3,
  10,
  'active',
  true,
  jsonb_build_object(
    'priceLabel', '$19 lifetime',
    'featureKey', 'leadfill_fill_action',
    'waffoMapping', 'shared_test_onetime_product'
  )
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
  metadata = coalesce(public.plans.metadata, '{}'::jsonb) || excluded.metadata,
  updated_at = now();
