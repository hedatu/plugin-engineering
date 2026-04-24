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
