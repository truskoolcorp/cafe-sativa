#!/usr/bin/env bash
# Fresh disposable PostgreSQL only; source the existing isolated setup, never a hosted DB.
set -euo pipefail
source "$(dirname "$0")/gallery-postgres-fixture.sh"
psql -f docs/gallery/proposed-consigned-private-checkout.sql >/dev/null
psql <<'SQL'
alter table public.artists add column stripe_account_id text, add column charges_enabled boolean, add column payouts_enabled boolean;
grant select,update on public.artists to service_role;
grant select,insert on public.orders,public.order_items to service_role;
insert into public.artists (id,is_approved,stripe_account_id,charges_enabled,payouts_enabled)
values('00000000-0000-4000-8000-000000000080',true,'acct_ConsignedFixture',true,true);
insert into public.products(id,kind,status,stock_count,artist_id,title,price_cents,currency)
values('00000000-0000-4000-8000-000000000081','digital','published',1,
'00000000-0000-4000-8000-000000000080','Fixture',1249,'usd');
insert into public.gallery_approved_assets(id,product_id,object_path,sha256,approved_by)
values('00000000-0000-4000-8000-000000000082','00000000-0000-4000-8000-000000000081',
'00000000-0000-4000-8000-000000000081/fixture.bin',repeat('0',64),'00000000-0000-4000-8000-000000000080');
do $privileges$
begin
 if has_function_privilege('anon','public.cs_record_consigned_private_gallery_payment(uuid,uuid,uuid,uuid,integer,jsonb)','EXECUTE') or
 has_function_privilege('authenticated','public.cs_pin_consigned_private_gallery_hold(uuid,uuid,uuid,uuid,uuid,text,integer,text)','EXECUTE')
 then raise exception 'Private consignment RPC visible to untrusted role'; end if;
end $privileges$;
set role service_role;
do $proof$
declare ar uuid='00000000-0000-4000-8000-000000000080'; p uuid='00000000-0000-4000-8000-000000000081';
edition uuid='00000000-0000-4000-8000-000000000082'; buyer uuid='00000000-0000-4000-8000-000000000083';
h uuid; r jsonb; o uuid; receipt jsonb; bad jsonb;
begin
 h:=public.cs_hold_gallery_inventory(p,buyer,1);
 if h is null or public.cs_hold_gallery_inventory(p,'00000000-0000-4000-8000-000000000084',1) is not null
 then raise exception 'Limited stock not blocked'; end if;
 if public.cs_pin_consigned_private_gallery_hold(h,p,ar,edition,buyer,'acct_ConsignedFixture',1249,'usd') then
 raise exception 'No private object was accepted'; end if;
end $proof$;
reset role;
insert into storage.objects values('gallery-approved','00000000-0000-4000-8000-000000000081/fixture.bin');
set role service_role;
do $proof$
declare ar uuid='00000000-0000-4000-8000-000000000080'; p uuid='00000000-0000-4000-8000-000000000081';
edition uuid='00000000-0000-4000-8000-000000000082'; buyer uuid='00000000-0000-4000-8000-000000000083';
h uuid; r jsonb; o uuid; receipt jsonb; bad jsonb;
begin
 select id into strict h from public.gallery_inventory_holds where product_id=p;
 if public.cs_pin_consigned_private_gallery_hold(h,p,ar,edition,buyer,'acct_Other',1249,'usd') or
    public.cs_pin_consigned_private_gallery_hold(h,p,ar,edition,buyer,'acct_ConsignedFixture',1250,'usd') or
    not public.cs_pin_consigned_private_gallery_hold(h,p,ar,edition,buyer,'acct_ConsignedFixture',1249,'usd')
 then raise exception 'Private hold pin rejected or accepted an invalid quote'; end if;
 if public.cs_pin_consigned_private_gallery_hold(h,p,ar,edition,buyer,'acct_ConsignedFixture',1249,'usd')
 then raise exception 'Pinned hold could be rewritten'; end if;
 update public.gallery_inventory_holds set stripe_session_id='cs_test_consigned_private_fixture' where id=h;
 receipt=jsonb_build_object('session_id','cs_test_consigned_private_fixture','payment_intent_id','pi_test_consigned_private_fixture',
   'payment_status','paid','user_id',buyer,'subtotal_cents',1249,'total_cents',1249,'currency','usd',
   'application_fee_cents',124,'transfer_destination','acct_ConsignedFixture');
 for bad in select x from jsonb_array_elements(jsonb_build_array(
    receipt||'{"application_fee_cents":125}',receipt||'{"transfer_destination":"acct_Other"}',
    receipt||'{"subtotal_cents":1250}',receipt||'{"currency":"eur"}')) x
 loop
  begin
   perform public.cs_record_consigned_private_gallery_payment(h,edition,p,ar,1,bad);
   raise exception 'Mismatched settlement accepted';
  exception when others then
   if sqlerrm<>'Consigned private settlement mismatch' then raise; end if;
  end;
 end loop;
 if exists(select 1 from public.orders where stripe_checkout_session_id=receipt->>'session_id') or
    (select stock_count from public.products where id=p)<>1 or
    (select state from public.gallery_inventory_holds where id=h)<>'held'
 then raise exception 'Rejections wrote order or inventory'; end if;
 r:=public.cs_record_consigned_private_gallery_payment(h,edition,p,ar,1,receipt);
 o:=(r->>'id')::uuid;
 if r->>'created'<>'true' or
    public.cs_record_consigned_private_gallery_payment(h,edition,p,ar,1,receipt) is distinct from jsonb_build_object('id',o,'created',false)
 then raise exception 'Paid order or replay invalid'; end if;
 if (select stock_count from public.products where id=p)<>0 or
    (select state from public.gallery_inventory_holds where id=h)<>'consumed' or
    not exists(select 1 from public.order_items where order_id=o and artist_id=ar and application_fee_cents=124
         and (line_total_cents-application_fee_cents)=1125 and transfer_destination='acct_ConsignedFixture' and gallery_sale_kind is null) or
    not exists(select 1 from public.gallery_private_deliveries where order_id=o and approved_asset_id=edition and product_id=p)
 then raise exception 'Settlement/edition/stock failed'; end if;
end $proof$;
reset role;
SQL
echo 'PASS: private consigned pinned settlement; no legacy URL column, service-only; limited stock, 10% floor, matching artist and private edition, idempotent.'
