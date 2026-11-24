#!/usr/bin/env bash
# Disposable PostgreSQL only. No hosted credentials, Stripe, storage API or email.
set -euo pipefail
cd "$(dirname "$0")/.."
bin="$(pg_config --bindir)"
tmp="$(mktemp -d)"
trap '"$bin/pg_ctl" -D "$tmp/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$tmp"' EXIT
mkdir "$tmp/socket"
unset PGHOST PGHOSTADDR PGPORT PGUSER PGDATABASE PGPASSWORD PGSERVICE PGSERVICEFILE PGOPTIONS
"$bin/initdb" -D "$tmp/data" -A trust -U gallery_fixture --no-locale >/dev/null
"$bin/pg_ctl" -D "$tmp/data" -o "-h '' -k $tmp/socket -p 55439" -l "$tmp/log" -w start >/dev/null
psql() { "$bin/psql" -X -h "$tmp/socket" -p 55439 -U gallery_fixture -d postgres -v ON_ERROR_STOP=1 "$@"; }
psql <<'SQL'
create role anon;
create role authenticated;
create role service_role bypassrls;
create schema storage;
create table storage.buckets(id text primary key,name text,public boolean);
create table storage.objects(bucket_id text,name text,primary key(bucket_id,name));
alter table storage.objects enable row level security;
create table public.artists(id uuid primary key,is_approved boolean not null default false);
create table public.products(id uuid primary key,kind text,status text,stock_count integer,artist_id uuid,title text,price_cents integer,currency text);
create table public.orders(id uuid primary key default gen_random_uuid(),session_id text unique,user_id uuid,paid_at timestamptz,fulfillment_state text,updated_at timestamptz default now(),
 stripe_checkout_session_id text unique,stripe_payment_intent_id text unique,buyer_email text,subtotal_cents integer,shipping_cents integer,tax_cents integer,total_cents integer,currency text);
create table public.order_items(order_id uuid references orders(id),product_id uuid references products(id),
 artist_id uuid,title_snapshot text,price_cents integer,quantity integer,line_total_cents integer,application_fee_cents integer,transfer_destination text);
-- A synthetic base RPC with the previously inspected signature and locking/idempotency
-- contract. This is NOT the production function body or a production-schema clone.
create function public.cs_record_gallery_payment(receipt jsonb,product_uuid uuid,artist_uuid uuid,quantity integer)
returns jsonb language plpgsql set search_path=public,pg_catalog as $$
declare oid uuid;
begin
 perform 1 from products where id=product_uuid for update;
 select id into oid from orders where session_id=receipt->>'session_id';
 if oid is null then
  update products set stock_count=stock_count-quantity where id=product_uuid and stock_count>=quantity;
  if not found then raise exception 'fixture stock unavailable'; end if;
  insert into orders(session_id,user_id,paid_at,fulfillment_state)
  values(receipt->>'session_id',(receipt->>'user_id')::uuid,now(),'pending') returning id into oid;
  insert into order_items values(oid,product_uuid);
 end if;
 return jsonb_build_object('id',oid);
end; $$;
insert into products values('00000000-0000-4000-8000-000000000001','digital','published',1);
SQL
for file in proposed-private-delivery-migration proposed-approved-artwork-assets proposed-fulfillment-authorization proposed-delivery-outbox proposed-inventory-reservations proposed-inventory-consumption proposed-refund-ledger proposed-settlement-observations proposed-house-checkout; do
 psql -f "docs/gallery/$file.sql" >/dev/null
done
# Independent sessions contend for a single limited edition; only one may hold it.
psql -Atq -c "begin; select cs_hold_gallery_inventory('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000011',1); select pg_sleep(1); commit;" >"$tmp/a" &
a=$!
psql -Atq -c "begin; select cs_hold_gallery_inventory('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000012',1); commit;" >"$tmp/b" &
b=$!
wait "$a"; wait "$b"
psql <<'SQL'
do $$
declare h gallery_inventory_holds%rowtype; receipt jsonb; r jsonb; oid uuid; aid uuid;
begin
 if (select count(*) from gallery_inventory_holds)<>1 then raise exception 'duplicate reservation'; end if;
 select * into strict h from gallery_inventory_holds;
 begin
  perform cs_record_reserved_gallery_payment(h.id,h.product_id,'00000000-0000-4000-8000-000000000021',1,jsonb_build_object('user_id',h.user_id,'payment_status','paid'));
  raise exception 'unbound session accepted';
 exception when others then
  if sqlerrm<>'Reservation mismatch' then raise; end if;
 end;
 update gallery_inventory_holds set stripe_session_id='cs_test_fixture' where id=h.id;
 receipt:=jsonb_build_object('session_id','cs_test_fixture','user_id',h.user_id,'payment_status','paid');
 begin
  perform cs_record_reserved_gallery_payment(h.id,h.product_id,'00000000-0000-4000-8000-000000000021',1,receipt||'{"user_id":"00000000-0000-4000-8000-000000000099"}');
  raise exception 'mismatch accepted';
 exception when others then
  if sqlerrm<>'Reservation mismatch' then raise; end if;
 end;
 if (select stock_count from products where id=h.product_id)<>1 then raise exception 'mismatch changed stock'; end if;
 begin
  perform cs_record_reserved_gallery_payment(h.id,h.product_id,'00000000-0000-4000-8000-000000000021',null,receipt);
  raise exception 'null quantity accepted';
 exception when others then
  if sqlerrm<>'Reservation mismatch' then raise; end if;
 end;
 r:=cs_record_reserved_gallery_payment(h.id,h.product_id,'00000000-0000-4000-8000-000000000021',1,receipt);
 oid:=(r->>'id')::uuid;
 if cs_record_reserved_gallery_payment(h.id,h.product_id,'00000000-0000-4000-8000-000000000021',1,receipt)<>r then raise exception 'replay mismatch'; end if;
 if (select count(*) from orders)<>1 or (select stock_count from products where id=h.product_id)<>0 or (select state from gallery_inventory_holds where id=h.id)<>'consumed' then raise exception 'stock or idempotency failure'; end if;
 if cs_authorize_gallery_delivery(oid) then raise exception 'unmapped delivery allowed'; end if;
 insert into gallery_approved_assets(product_id,object_path,sha256,approved_by)
 values(h.product_id,h.product_id::text||'/fixture.bin',repeat('a',64),h.user_id) returning id into aid;
 insert into gallery_private_deliveries(order_id,product_id,object_path,approved_asset_id)
 values(oid,h.product_id,oid::text||'/fixture.bin',aid);
 if cs_authorize_gallery_delivery(oid) then raise exception 'missing storage object allowed'; end if;
 insert into storage.objects values('gallery-private',oid::text||'/fixture.bin');
 if not cs_authorize_gallery_delivery(oid) or not cs_authorize_gallery_delivery(oid) then raise exception 'delivery authorization failed'; end if;
 if (select count(*) from gallery_delivery_outbox where order_id=oid and state='pending')<>1 then raise exception 'outbox not idempotent'; end if;
 update gallery_approved_assets set revoked_at=now() where id=aid;
 if cs_authorize_gallery_delivery(oid) then raise exception 'revoked asset authorized'; end if;
 update gallery_approved_assets set revoked_at=null where id=aid;
 update orders set fulfillment_state='refunded' where id=oid;
 if cs_authorize_gallery_delivery(oid) then raise exception 'refunded delivery authorized'; end if;
 if (select state from gallery_delivery_outbox where order_id=oid)<>'canceled' then raise exception 'refund did not cancel pending notice'; end if;
 if (select stock_count from products where id=h.product_id)<>0 then raise exception 'refund automatically restocked'; end if;
 if has_function_privilege('authenticated','cs_gallery_house_ready(uuid,uuid,uuid)','EXECUTE') or has_function_privilege('anon','cs_record_house_gallery_payment(uuid,uuid,uuid,uuid,integer,jsonb)','EXECUTE') or has_function_privilege('authenticated','cs_record_house_gallery_payment(uuid,uuid,uuid,uuid,integer,jsonb)','EXECUTE') or has_function_privilege('authenticated','cs_authorize_gallery_delivery(uuid)','EXECUTE') or has_function_privilege('anon','cs_hold_gallery_inventory(uuid,uuid,integer)','EXECUTE') or has_function_privilege('authenticated','cs_record_reserved_gallery_payment(uuid,uuid,uuid,integer,jsonb)','EXECUTE') then raise exception 'public RPC permission'; end if;
 raise notice 'PASS: concurrent hold, mismatched receipt rejection, synthetic payment replay, approved mapping/object gate, outbox deduplication, refund access-state denial and no automatic restock';
end $$;
SQL
# A NULL publication state must not be treated as published.
psql -v ON_ERROR_STOP=1 <<'SQL'
insert into products values('00000000-0000-4000-8000-000000000002','digital',null,1);
do $$ begin
 if cs_hold_gallery_inventory('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000011',1) is not null then raise exception 'unpublished null state accepted'; end if;
end $$;
SQL
psql <<'SQL'
do $settlement$
declare oid uuid;
begin
 select id into strict oid from orders;
 insert into gallery_settlement_observations(order_id,stripe_payment_intent_id,provider_snapshot)
 values(oid,'pi_fixture','{"payment_intent_id":"pi_fixture","currency":"usd","livemode":false}');
 if has_table_privilege('authenticated','gallery_settlement_observations','SELECT') or
    has_table_privilege('anon','gallery_settlement_observations','INSERT') or
    has_table_privilege('service_role','gallery_settlement_observations','UPDATE') or
    not has_table_privilege('service_role','gallery_settlement_observations','INSERT') then
  raise exception 'settlement observation privileges invalid';
 end if;
 begin
  insert into gallery_settlement_observations(order_id,stripe_payment_intent_id,provider_snapshot)
  values(oid,'pi_fixture','{"payment_intent_id":"pi_other","currency":"usd","livemode":false}');
  raise exception 'mismatched provider identifier accepted';
 exception when check_violation then null;
 end;
end $settlement$;
SQL
echo 'Synthetic PostgreSQL migration/RPC fixture passed; not actual Stripe, Supabase storage, or production RPC proof.'

psql <<'SQL'
do $house$
declare pid uuid:='00000000-0000-4000-8000-000000000003'; artist uuid:='00000000-0000-4000-8000-000000000023';
 buyer uuid:='00000000-0000-4000-8000-000000000013'; hold uuid; asset uuid; oid uuid; r jsonb; receipt jsonb;
begin
 insert into artists(id,is_approved) values(artist,true);
 insert into products(id,kind,status,stock_count,artist_id,title,price_cents,currency) values(pid,'digital','published',1,artist,'House fixture',1200,'usd');
 hold:=cs_hold_gallery_inventory(pid,buyer,1);
 update gallery_inventory_holds set stripe_session_id='cs_test_house' where id=hold;
 insert into gallery_approved_assets(product_id,object_path,sha256,approved_by)
 values(pid,pid::text||'/house.bin',repeat('b',64),buyer) returning id into asset;
 if cs_gallery_house_ready(pid,artist,asset) then raise exception 'house checkout readiness allowed missing private source'; end if;
 insert into storage.objects values('gallery-approved',pid::text||'/house.bin');
 if not cs_gallery_house_ready(pid,artist,asset) or cs_gallery_house_ready(pid,buyer,asset) then raise exception 'house checkout readiness misclassified'; end if;
 receipt:=jsonb_build_object('session_id','cs_test_house','payment_intent_id','pi_test_house','payment_status','paid',
  'user_id',buyer,'subtotal_cents',1200,'total_cents',1200,'currency','usd','application_fee_cents',0);
 begin
  perform cs_record_house_gallery_payment(hold,asset,pid,artist,1,receipt||'{"application_fee_cents":120}');
  raise exception 'house accepted application fee';
 exception when others then
  if sqlerrm<>'Invalid house receipt' then raise; end if;
 end;
 begin
  perform cs_record_house_gallery_payment(hold,asset,pid,buyer,1,receipt);
  raise exception 'house accepted mismatched artist';
 exception when others then
  if sqlerrm<>'House product mismatch' then raise; end if;
 end;
 begin
  perform cs_record_house_gallery_payment(hold,buyer,pid,artist,1,receipt);
  raise exception 'house accepted mismatched approved edition';
 exception when others then
  if sqlerrm<>'House edition unavailable' then raise; end if;
 end;
 r:=cs_record_house_gallery_payment(hold,asset,pid,artist,1,receipt); oid:=(r->>'id')::uuid;
 if r->>'created'<>'true' or not exists(select 1 from order_items where order_id=oid and gallery_sale_kind='house'
    and application_fee_cents=0 and transfer_destination is null) or
    not exists(select 1 from gallery_private_deliveries where order_id=oid and approved_asset_id=asset) then
  raise exception 'house receipt not recorded with atomic edition mapping';
 end if;
 r:=cs_record_house_gallery_payment(hold,asset,pid,artist,1,receipt);
 if r->>'created'<>'false' or (r->>'id')::uuid<>oid or (select stock_count from products where id=pid)<>0 then
  raise exception 'invalid replay or stock';
 end if;
 insert into storage.objects values('gallery-private',oid::text||'/'||asset::text);
 if not cs_authorize_gallery_delivery(oid) then raise exception 'house entitlement not authorized'; end if;
 update orders set fulfillment_state='refunded' where id=oid;
 if cs_authorize_gallery_delivery(oid) or (select stock_count from products where id=pid)<>0 then raise exception 'house refund handling failed'; end if;
 raise notice 'PASS: house route no fee or transfer, edition mapping, idempotent stock and refund denial';
end $house$;
SQL

# Second isolated database: exercise the exact thin local developer schema against
# Auth/Storage table stand-ins. Does not run Supabase Auth or Storage services.
psql -c 'create database gallery_house_local_schema' >/dev/null
psql_house() { "$bin/psql" -X -h "$tmp/socket" -p 55439 -U gallery_fixture -d gallery_house_local_schema -v ON_ERROR_STOP=1 "$@"; }
psql_house -q <<'SQL'
create schema auth;
create table auth.users(id uuid primary key);
create schema storage;
create table storage.buckets(id text primary key,name text,public boolean);
create table storage.objects(bucket_id text,name text,primary key(bucket_id,name));
alter table storage.objects enable row level security;
grant usage on schema storage to service_role;
grant select on storage.buckets,storage.objects to service_role;
SQL
if psql_house -f tests/fixtures/gallery-local-house-base.sql >/dev/null 2>&1; then
 echo 'Local house base accepted without explicit local marker' >&2
 exit 1
fi
psql_house -c "set gallery.local_sandbox='on'" -f tests/fixtures/gallery-local-house-base.sql >/dev/null
for file in proposed-private-delivery-migration proposed-approved-artwork-assets proposed-fulfillment-authorization proposed-delivery-outbox proposed-inventory-reservations proposed-inventory-consumption proposed-refund-ledger proposed-settlement-observations proposed-house-checkout; do
 psql_house -f "docs/gallery/$file.sql" >/dev/null
done
psql_house -q <<'SQL'
insert into auth.users(id) values ('00000000-0000-4000-8000-000000000001');
insert into artists(id,user_id,display_name,is_approved) values('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','Synthetic Gallery Studio',true);
insert into products(id,artist_id,slug,title,kind,status,price_cents,currency,stock_count)
 values('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000002','local-fixture','Synthetic House Art','digital','published',1200,'usd',1);
insert into storage.objects values('gallery-approved','00000000-0000-4000-8000-000000000003/synthetic.bin');
insert into gallery_approved_assets(id,product_id,object_path,sha256,approved_by)
 values('00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000003/synthetic.bin',repeat('c',64),'00000000-0000-4000-8000-000000000001');
set role service_role;
do $thin_shape$ begin
 if not cs_gallery_house_ready('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000004')
 then raise exception 'Thin local schema did not pass readiness'; end if;
 if has_table_privilege('anon','public.orders','SELECT') or has_table_privilege('authenticated','public.products','INSERT') then
  raise exception 'Thin fixture permits public order read or write'; end if;
end $thin_shape$;
SQL
echo 'Exact thin local house SQL and service-role readiness passed against synthetic Auth/Storage tables; real service integration not run.'
