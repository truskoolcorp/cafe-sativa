-- Proposed only. No refunds, transfers or stock adjustments are initiated.
begin;
create table public.gallery_refund_receipts (
 stripe_refund_id text primary key,
 order_id uuid not null references public.orders(id) on delete restrict,
 stripe_payment_intent_id text not null,
 amount_cents bigint not null check(amount_cents>0),
 currency text not null check(currency ~ '^[a-z]{3}$'),
 provider_status text not null,
 transfer_reversal_id text,
 application_fee_refund_id text,
 reconciliation_state text not null default 'attention' check(reconciliation_state in ('attention','reconciled')),
 observed_at timestamptz not null default now()
);
alter table public.gallery_refund_receipts enable row level security;
revoke all on public.gallery_refund_receipts from public,anon,authenticated;
grant select,insert,update on public.gallery_refund_receipts to service_role;
create table public.gallery_restock_reviews (
 order_id uuid primary key references public.orders(id) on delete restrict,
 state text not null default 'pending' check(state in ('pending','approved','rejected','applied')),
 reason text not null,
 reviewed_by uuid,
 reviewed_at timestamptz,
 applied_at timestamptz,
 check(state='pending' or (reviewed_by is not null and reviewed_at is not null))
);
alter table public.gallery_restock_reviews enable row level security;
revoke all on public.gallery_restock_reviews from public,anon,authenticated;
grant select,insert,update on public.gallery_restock_reviews to service_role;
commit;
-- Partial refunds do not automatically restore stock or revoke all rights.
-- Full refunds require verified aggregate amounts; transfer and fee reversals
-- must be reconciled separately. Physical returns require condition review.
-- NFT restocking requires verified token custody and collection policy.
