-- Disposable LOCAL STACK ONLY. This is a deliberately partial synthetic business schema,
-- not a production clone. The caller first verifies a literal-loopback connection and
-- explicitly sets gallery.local_sandbox=on, in a brand-new unlinked local Supabase DB.
begin;
do $local_only$ begin
 if current_setting('gallery.local_sandbox', true) is distinct from 'on' or
    to_regclass('auth.users') is null or to_regclass('storage.objects') is null or
    to_regclass('public.artists') is not null or to_regclass('public.products') is not null or
    to_regclass('public.orders') is not null or to_regclass('public.order_items') is not null then
  raise exception 'Requires a fresh explicitly isolated local stack with Auth and Storage';
 end if;
end $local_only$;
create table public.artists (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
 display_name text not null, is_approved boolean not null default false,
 stripe_account_id text, charges_enabled boolean not null default false, payouts_enabled boolean not null default false
);
create table public.products (
 id uuid primary key default gen_random_uuid(), artist_id uuid not null references public.artists(id),
 slug text not null unique, title text not null, description text, kind text not null, status text not null,
 price_cents integer not null, currency text not null, stock_count integer,
 primary_image_url text, digital_delivery_url text
);
create table public.orders (
 id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id),
 buyer_email text not null, stripe_checkout_session_id text unique, stripe_payment_intent_id text unique,
 subtotal_cents integer not null, shipping_cents integer not null, tax_cents integer not null,
 total_cents integer not null, currency text not null, fulfillment_state text not null, paid_at timestamptz,
 updated_at timestamptz not null default now()
);
create table public.order_items (
 order_id uuid not null references public.orders(id), product_id uuid not null references public.products(id),
 artist_id uuid not null references public.artists(id), title_snapshot text not null,
 price_cents integer not null, quantity integer not null, line_total_cents integer not null,
 application_fee_cents integer not null, transfer_destination text
);
create function public.cs_record_gallery_payment(receipt jsonb,product_uuid uuid,artist_uuid uuid,quantity integer)
returns jsonb language plpgsql security invoker set search_path='' as $consigned_disabled$ begin
 raise exception 'This local fixture supports house checkout only';
end $consigned_disabled$;
revoke all on function public.cs_record_gallery_payment(jsonb,uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.cs_record_gallery_payment(jsonb,uuid,uuid,integer) to service_role;
alter table public.artists enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
revoke all on public.artists,public.products,public.orders,public.order_items from public,anon,authenticated;
grant select,insert,update on public.artists,public.products,public.orders,public.order_items to service_role;
commit;
