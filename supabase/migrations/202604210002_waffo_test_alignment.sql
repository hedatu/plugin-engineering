alter table public.plans
  add column if not exists waffo_plan_id_test text,
  add column if not exists waffo_plan_id_prod text,
  add column if not exists waffo_price_id_test text,
  add column if not exists waffo_price_id_prod text;

alter table public.orders
  add column if not exists buyer_identity jsonb,
  add column if not exists merchant_provided_buyer_identity text,
  add column if not exists waffo_plan_id text,
  add column if not exists waffo_price_id text;

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

alter table public.processed_webhooks enable row level security;

insert into public.processed_webhooks (
  mode,
  event_type,
  event_id,
  entity_id,
  signature_valid,
  raw_payload,
  raw_body,
  processing_error,
  received_at,
  processed_at
)
select
  mode,
  event_type,
  event_id,
  entity_id,
  signature_valid,
  raw_payload,
  raw_body,
  processing_error,
  received_at,
  processed_at
from public.webhook_events
on conflict (mode, event_type, event_id) do nothing;
