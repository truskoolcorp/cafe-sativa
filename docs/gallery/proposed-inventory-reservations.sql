-- Proposed only. Integrate with existing cs_record_gallery_payment before activation.
begin;
create table public.gallery_inventory_holds (
 id uuid primary key default gen_random_uuid(),
 product_id uuid not null references public.products(id) on delete restrict,
 user_id uuid not null,
 quantity integer not null check(quantity between 1 and 10),
 state text not null default 'held' check(state in ('held','consumed','released','attention')),
 stripe_session_id text unique,
 created_at timestamptz not null default now(),
 expires_at timestamptz not null
);
alter table public.gallery_inventory_holds enable row level security;
revoke all on public.gallery_inventory_holds from public,anon,authenticated;
grant select,insert,update on public.gallery_inventory_holds to service_role;
create index gallery_inventory_active on public.gallery_inventory_holds(product_id) where state in ('held','attention');
create function public.cs_hold_gallery_inventory(p_product uuid,p_user uuid,p_quantity integer)
returns uuid language plpgsql security invoker set search_path='' as $$
declare p public.products%rowtype; held bigint; result uuid;
begin
 if p_quantity is null or p_quantity not between 1 and 10 or p_user is null then return null; end if;
 select * into p from public.products where id=p_product for update;
 if not found or p.status is distinct from 'published' then return null; end if;
 select coalesce(sum(quantity),0) into held from public.gallery_inventory_holds where product_id=p_product and state in ('held','attention');
 if p.stock_count is not null and p.stock_count-held<p_quantity then return null; end if;
 insert into public.gallery_inventory_holds(product_id,user_id,quantity,expires_at)
 values(p_product,p_user,p_quantity,now()+interval '45 minutes') returning id into result;
 return result;
end;
$$;
revoke all on function public.cs_hold_gallery_inventory(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.cs_hold_gallery_inventory(uuid,uuid,integer) to service_role;
commit;
-- Expiration is a reconciliation deadline, NOT permission to release stock.
-- Release only after Stripe confirms expiration/nonpayment and no pending payment.
-- Consume hold and decrement stock in the same transaction as paid order recording.
-- All stock mutation paths must serialize on the same product lock.
-- Do not enable checkout holds before those integrations and concurrency tests.
