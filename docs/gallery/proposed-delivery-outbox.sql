-- Proposed migration; apply only after fulfillment schema validation.
begin;
create table public.gallery_delivery_outbox (
 order_id uuid primary key references public.orders(id) on delete restrict,
 created_at timestamptz not null default now(),
 state text not null default 'pending' check(state in ('pending','sending','sent','canceled','attention')),
 attempts integer not null default 0 check(attempts>=0),
 next_attempt_at timestamptz not null default now(),
 lease_until timestamptz,
 sent_at timestamptz,
 last_error_code text
);
alter table public.gallery_delivery_outbox enable row level security;
revoke all on public.gallery_delivery_outbox from public,anon,authenticated;
grant select,insert,update on public.gallery_delivery_outbox to service_role;
create index gallery_delivery_outbox_due on public.gallery_delivery_outbox(next_attempt_at) where state='pending';
create function public.cs_queue_gallery_delivery_notice() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.fulfillment_state='delivered' and old.fulfillment_state is distinct from new.fulfillment_state
 and new.paid_at is not null and exists(select 1 from public.gallery_private_deliveries d where d.order_id=new.id) then
 insert into public.gallery_delivery_outbox(order_id) values(new.id) on conflict(order_id) do nothing;
 elsif new.fulfillment_state='refunded' then
 update public.gallery_delivery_outbox set state='canceled' where order_id=new.id and state='pending';
 end if;
 return new;
end;
$$;
revoke all on function public.cs_queue_gallery_delivery_notice() from public,anon,authenticated;
create trigger gallery_delivery_notice after update of fulfillment_state on public.orders
for each row execute function public.cs_queue_gallery_delivery_notice();
commit;
-- Sender must atomically claim a row, recheck entitlement, use a stable provider
-- idempotency key, and handle ambiguous delivery outcomes without blind retries.
-- No email sending or migration application is performed here.
