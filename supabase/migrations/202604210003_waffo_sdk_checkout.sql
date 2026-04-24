alter table public.plans
  add column if not exists waffo_product_type_test text,
  add column if not exists waffo_product_type_prod text;

with p as (
  select id from public.products where product_key = 'chatgpt2obsidian'
)
update public.plans
set
  billing_type = 'onetime',
  currency = 'USD',
  waffo_product_id_test = 'PROD_1LTEolO39KqxFSQLCXeAgR',
  waffo_product_type_test = 'onetime',
  updated_at = now()
where product_id in (select id from p)
  and plan_key = 'lifetime';

with p as (
  select id from public.products where product_key = 'chatgpt2obsidian'
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
  is_public
)
select
  p.id,
  'one_time_test',
  'One-time Test',
  'Waffo Pancake test one-time checkout plan.',
  'onetime',
  'USD',
  49.00,
  'PROD_1LTEolO39KqxFSQLCXeAgR',
  'onetime',
  '{"single_export": true, "batch_export": true, "image_download": true}'::jsonb,
  '{"single_export": {"period": "day", "limit": -1}, "batch_export": {"period": "month", "limit": -1}, "image_download": {"period": "month", "limit": -1}}'::jsonb,
  5,
  15,
  'active',
  true
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
  sort_order = excluded.sort_order,
  status = excluded.status,
  is_public = excluded.is_public,
  updated_at = now();
