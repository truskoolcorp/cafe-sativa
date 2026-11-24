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
create table public.products(id uuid primary key,kind text,status text,stock_count integer);
create table public.orders(id uuid primary key default gen_random_uuid(),session_id text unique,user_id uuid,paid_at timestamptz,fulfillment_state text,updated_at timestamptz default now());
create table public.order_items(order_id uuid references orders(id),product_id uuid references products(id));
-- A synthetic base RPC with the previously inspected signature and locking/idempotency
-- contract. This is NOT the production function body or a production-schema clone.
create function public.cs_record_gallery_payment(receipt jsonb,product_uuid uuid,artist_uuid uuid,quantity integer)
returns jsonb language plpgsql set search_path=public,pg_catalog as $
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
for file in proposed-private-delivery-migration proposed-approved-artwork-assets proposed-fulfillment-authorization proposed-delivery-outbox proposed-inventory-reservations proposed-inventory-consumption proposed-refund-ledger; do
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
 update gallery_inventory_holds set stripe_session_id='cs_test_fixture' where id=h.id;
 receipt:=jsonb_build_object('session_id','cs_test_fixture','user_id',h.user_id,'payment_status','paid');
 begin
  perform cs_record_reserved_gallery_payment(h.id,h.product_id,'00000000-0000-4000-8000-000000000021',1,receipt||'{"user_id":"00000000-0000-4000-8000-000000000099"}');
  raise exception 'mismatch accepted';
 exception when others then
  if sqlerrm<>'Reservation mismatch' then raise; end if;
 end;
 if (select stock_count from products where id=h.product_id)<>1 then raise exception 'mismatch changed stock'; end if;
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
 update orders set fulfillment_state='refunded' where id=oid;
 if cs_authorize_gallery_delivery(oid) then raise exception 'refunded delivery authorized'; end if;
 if (select state from gallery_delivery_outbox where order_id=oid)<>'canceled' then raise exception 'refund did not cancel pending notice'; end if;
 if (select stock_count from products where id=h.product_id)<>0 then raise exception 'refund automatically restocked'; end if;
 if has_function_privilege('authenticated','cs_authorize_gallery_delivery(uuid)','EXECUTE') or has_function_privilege('anon','cs_hold_gallery_inventory(uuid,uuid,integer)','EXECUTE') then raise exception 'public RPC permission'; end if;
 raise notice 'PASS: concurrent hold, mismatched receipt rejection, synthetic payment replay, approved mapping/object gate, outbox deduplication, refund access-state denial and no automatic restock';
end $$;
SQL
echo 'Synthetic PostgreSQL migration/RPC fixture passed; not actual Stripe, Supabase storage, or production RPC proof.'
