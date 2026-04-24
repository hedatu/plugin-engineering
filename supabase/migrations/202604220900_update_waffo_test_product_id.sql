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
  and plan_key in ('lifetime', 'one_time_test');
