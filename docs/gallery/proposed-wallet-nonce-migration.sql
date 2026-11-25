-- Proposed migration: apply only after preview database review.
-- Nonces are single-use across all application instances.
create table if not exists public.gallery_consumed_wallet_nonces (
  nonce text primary key check (nonce ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  consumed_at timestamptz not null default now()
);
alter table public.gallery_consumed_wallet_nonces enable row level security;
revoke all on public.gallery_consumed_wallet_nonces from public, anon, authenticated;
grant insert on public.gallery_consumed_wallet_nonces to service_role;
