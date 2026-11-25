-- Proposed only. Apply after the inventory, private-delivery, assets and house SQL on a disposable database first.
-- Keeps existing physical/legacy RPCs intact. No product master URL is read or written.
begin;
alter table public.gallery_inventory_holds
 add column consigned_private_asset_id uuid references public.gallery_approved_assets(id) on delete restrict,
 add column consigned_private_artist_id uuid references public.artists(id) on delete restrict,
 add column consigned_private_destination text,
 add column consigned_private_subtotal integer,
 add column consigned_private_currency text;

-- Called before requesting a Stripe session. Freeze exact privately reviewed edition and artist settlement.
create function public.cs_pin_consigned_private_gallery_hold(
 p_hold uuid,p_product uuid,p_artist uuid,p_asset uuid,p_user uuid,
 p_destination text,p_subtotal integer,p_currency text
) returns boolean language plpgsql security invoker set search_path='' as $pin$
declare p public.products%rowtype; h public.gallery_inventory_holds%rowtype; ar public.artists%rowtype;
begin
 if p_asset is null or p_artist is null or p_user is null or
    coalesce(p_destination,'') !~ '^acct_[A-Za-z0-9]+$' or
    coalesce(p_currency,'') !~ '^[a-z]{3}$' or coalesce(p_subtotal,0)<=0 then return false; end if;
 select * into p from public.products where id=p_product for update;
 if not found or p.artist_id is distinct from p_artist or p.status::text is distinct from 'published'
    or p.kind::text is distinct from 'digital' or coalesce(lower(p.currency),'usd') is distinct from p_currency
    then return false; end if;
 select * into h from public.gallery_inventory_holds where id=p_hold for update;
 if not found or h.product_id is distinct from p_product or h.user_id is distinct from p_user
    or h.state is distinct from 'held' or h.expires_at <= now() or h.stripe_session_id is not null
    or h.consigned_private_asset_id is not null or p.price_cents::bigint*h.quantity is distinct from p_subtotal::bigint
    then return false; end if;
 select * into ar from public.artists where id=p_artist for share;
 if not found or ar.stripe_account_id is distinct from p_destination or ar.is_approved is not true
    or ar.charges_enabled is not true or ar.payouts_enabled is not true then return false; end if;
 perform 1 from public.gallery_approved_assets a
   join storage.buckets b on b.id='gallery-approved' and b.public=false
   join storage.objects o on o.bucket_id=b.id and o.name=a.object_path
   where a.id=p_asset and a.product_id=p_product and a.revoked_at is null for share of a;
 if not found then return false; end if;
 update public.gallery_inventory_holds set consigned_private_asset_id=p_asset,consigned_private_artist_id=p_artist,
    consigned_private_destination=p_destination,consigned_private_subtotal=p_subtotal,
    consigned_private_currency=p_currency where id=p_hold;
 return true;
end;
$pin$;
revoke all on function public.cs_pin_consigned_private_gallery_hold(uuid,uuid,uuid,uuid,uuid,text,integer,text) from public,anon,authenticated;
grant execute on function public.cs_pin_consigned_private_gallery_hold(uuid,uuid,uuid,uuid,uuid,text,integer,text) to service_role;

create function public.cs_record_consigned_private_gallery_payment(
 p_hold uuid, p_asset uuid, product_uuid uuid, artist_uuid uuid, quantity integer, receipt jsonb
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare
 p public.products%rowtype; h public.gallery_inventory_holds%rowtype;
 existing public.orders%rowtype; new_id uuid; subtotal integer; total integer; tax integer; fee integer; destination text;
begin
 if p_hold is null or p_asset is null or quantity is null or quantity not between 1 and 10
  or receipt->>'payment_status' is distinct from 'paid'
  or coalesce(btrim(receipt->>'session_id'),'')=''
  or coalesce(btrim(receipt->>'payment_intent_id'),'')=''
  or coalesce(receipt->>'currency','') !~ '^[a-z]{3}$'
 then
  raise exception 'Invalid consigned private receipt';
 end if;
 select * into p from public.products where id=product_uuid for update;
 if not found or p.artist_id is distinct from artist_uuid or artist_uuid is null or p.kind::text is distinct from 'digital' then
  raise exception 'Consigned private product mismatch';
 end if;
 select * into h from public.gallery_inventory_holds where id=p_hold for update;
 if not found or h.product_id is distinct from product_uuid or h.quantity is distinct from quantity
  or h.user_id::text is distinct from receipt->>'user_id'
  or h.stripe_session_id is distinct from receipt->>'session_id'
  or h.state not in ('held','attention','consumed') then
  raise exception 'Consigned private reservation mismatch';
 end if;
 subtotal=(receipt->>'subtotal_cents')::integer;
 fee=(receipt->>'application_fee_cents')::integer;
 destination=receipt->>'transfer_destination';
 total=(receipt->>'total_cents')::integer;
 tax=coalesce((receipt->>'tax_cents')::integer,0);
 if h.consigned_private_asset_id is distinct from p_asset or h.consigned_private_artist_id is distinct from artist_uuid
  or h.consigned_private_destination is distinct from destination or destination is null
  or destination !~ '^acct_[A-Za-z0-9]+$' or h.consigned_private_subtotal is distinct from subtotal
  or h.consigned_private_currency is distinct from receipt->>'currency' or fee is distinct from subtotal/10 then
  raise exception 'Consigned private settlement mismatch';
 end if;
 if subtotal is null or total is null or subtotal<=0 or subtotal%quantity<>0 or tax<0
  or total::bigint<>subtotal::bigint+tax or coalesce((receipt->>'shipping_cents')::integer,0)<>0 then
  raise exception 'Invalid consigned private amounts';
 end if;
 select * into existing from public.orders where stripe_checkout_session_id=receipt->>'session_id';
 if found then
  if existing.user_id is distinct from h.user_id or existing.stripe_payment_intent_id is distinct from receipt->>'payment_intent_id'
   or existing.subtotal_cents is distinct from subtotal or existing.tax_cents is distinct from tax
   or existing.total_cents is distinct from total or existing.currency is distinct from receipt->>'currency'
   or not exists (select 1 from public.order_items i where i.order_id=existing.id
       and i.product_id=product_uuid and i.artist_id=artist_uuid and i.quantity=cs_record_consigned_private_gallery_payment.quantity
       and i.gallery_sale_kind is null and i.application_fee_cents=fee and i.transfer_destination=destination)
   or not exists (select 1 from public.gallery_private_deliveries d where d.order_id=existing.id
       and d.product_id=product_uuid and d.approved_asset_id=p_asset) then
   raise exception 'Consigned private replay mismatch';
  end if;
  return jsonb_build_object('id',existing.id,'created',false);
 end if;
 if h.state='consumed' or (p.stock_count is not null and p.stock_count<quantity) then
  raise exception 'Consigned private stock requires reconciliation';
 end if;
 perform 1 from public.gallery_approved_assets a where a.id=p_asset and a.product_id=product_uuid and a.revoked_at is null for share;
 if not found then raise exception 'Consigned private edition unavailable'; end if;
 insert into public.orders(user_id,buyer_email,stripe_checkout_session_id,stripe_payment_intent_id,subtotal_cents,
   shipping_cents,tax_cents,total_cents,currency,fulfillment_state,paid_at)
 values(h.user_id,coalesce(receipt->>'email',''),receipt->>'session_id',receipt->>'payment_intent_id',subtotal,
   0,tax,total,receipt->>'currency','pending',now()) returning id into new_id;
 insert into public.order_items(order_id,product_id,artist_id,title_snapshot,price_cents,quantity,line_total_cents,
   application_fee_cents,transfer_destination,gallery_sale_kind)
 values(new_id,product_uuid,artist_uuid,coalesce(receipt->>'title',p.title),subtotal/quantity,quantity,subtotal,fee,destination,null);
 insert into public.gallery_private_deliveries(order_id,product_id,approved_asset_id,object_path)
 values(new_id,product_uuid,p_asset,new_id::text||'/'||p_asset::text);
 if p.stock_count is not null then update public.products set stock_count=stock_count-quantity where id=product_uuid; end if;
 update public.gallery_inventory_holds set state='consumed' where id=p_hold;
 return jsonb_build_object('id',new_id,'created',true);
end;
$$;
revoke all on function public.cs_record_consigned_private_gallery_payment(uuid,uuid,uuid,uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.cs_record_consigned_private_gallery_payment(uuid,uuid,uuid,uuid,integer,jsonb) to service_role;
commit;
