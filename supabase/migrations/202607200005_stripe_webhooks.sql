alter table public.stores
  add column if not exists stripe_account_id text unique,
  add column if not exists stripe_account_charges_enabled boolean not null default false,
  add column if not exists stripe_account_payouts_enabled boolean not null default false,
  add column if not exists stripe_customer_id text unique,
  add column if not exists stripe_subscription_id text unique,
  add column if not exists stripe_subscription_status text;

create table if not exists public.stripe_webhook_events (
  event_id text primary key,
  source text not null check (source in ('account', 'connect')),
  event_type text not null,
  livemode boolean not null,
  connected_account_id text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

alter table public.stripe_webhook_events enable row level security;
revoke all on table public.stripe_webhook_events from anon, authenticated;

create index if not exists stripe_webhook_events_received_at_idx
  on public.stripe_webhook_events(received_at desc);
