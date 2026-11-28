-- Draft only: apply after the existing Gallery migrations in an isolated fixture.
-- Append provider evidence; do not overwrite historical observations or infer payouts.
begin;
create table public.gallery_settlement_observations (
 id uuid primary key default gen_random_uuid(),
 order_id uuid not null references public.orders(id) on delete restrict,
 stripe_payment_intent_id text not null check(stripe_payment_intent_id like 'pi_%'),
 provider_snapshot jsonb not null,
 observed_at timestamptz not null default clock_timestamp(),
 check(jsonb_typeof(provider_snapshot)='object'),
 check((provider_snapshot->>'payment_intent_id') is not distinct from stripe_payment_intent_id),
 check((provider_snapshot->>'currency') is not null and provider_snapshot->>'currency' ~ '^[a-z]{3}$'),
 check((provider_snapshot->>'livemode') is not null and jsonb_typeof(provider_snapshot->'livemode')='boolean')
);
create index gallery_settlement_observations_order_idx on public.gallery_settlement_observations(order_id,observed_at desc);
alter table public.gallery_settlement_observations enable row level security;
revoke all on public.gallery_settlement_observations from public,anon,authenticated,service_role;
grant select,insert on public.gallery_settlement_observations to service_role;
commit;
