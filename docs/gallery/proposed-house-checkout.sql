-- Proposed only. Apply only after existing Gallery inventory and approved-asset migrations.
-- Independent artist RPC and old orders are unchanged; null on older rows is not a house sale.
begin;
alter table public.order_items add column gallery_sale_kind text
 check (gallery_sale_kind is null or (gallery_sale_kind='house' and application_fee_cents=0 and transfer_destination is null));

-- Prevent starting Stripe Checkout before both this migration and a private approved edition are ready.
create function public.cs_gallery_house_ready(p_product uuid,p_artist uuid,p_asset uuid)
returns boolean language sql stable security invoker set search_path='' as $ready$
 select exists(select 1 from public.products p
  join public.artists ar on ar.id=p.artist_id
  join public.gallery_approved_assets a on a.product_id=p.id
  join storage.buckets b on b.id='gallery-approved' and b.public=false
  join storage.objects o on o.bucket_id=b.id and o.name=a.object_path
  where p.id=p_product and p.artist_id=p_artist and p.status::text='published'
   and p.kind::text='digital' and p.price_cents>0 and lower(p.currency)='usd'
   and ar.is_approved and a.id=p_asset and a.revoked_at is null);
$ready$;
revoke all on function public.cs_gallery_house_ready(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.cs_gallery_house_ready(uuid,uuid,uuid) to service_role;

create function public.cs_record_house_gallery_payment(
 p_hold uuid, p_asset uuid, product_uuid uuid, artist_uuid uuid, quantity integer, receipt jsonb
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare
 p public.products%rowtype; h public.gallery_inventory_holds%rowtype;
 existing public.orders%rowtype; new_id uuid; subtotal integer; total integer; tax integer;
begin
 if p_hold is null or p_asset is null or quantity is null or quantity not between 1 and 10
  or receipt->>'payment_status' is distinct from 'paid'
  or coalesce(btrim(receipt->>'session_id'),'')=''
  or coalesce(btrim(receipt->>'payment_intent_id'),'')=''
  or coalesce(receipt->>'currency','') !~ '^[a-z]{3}$'
  or (receipt->>'application_fee_cents')::integer is distinct from 0 then
  raise exception 'Invalid house receipt';
 end if;
 select * into p from public.products where id=product_uuid for update;
 if not found or p.artist_id is distinct from artist_uuid or artist_uuid is null or p.kind::text is distinct from 'digital' then
  raise exception 'House product mismatch';
 end if;
 select * into h from public.gallery_inventory_holds where id=p_hold for update;
 if not found or h.product_id is distinct from product_uuid or h.quantity is distinct from quantity
  or h.user_id::text is distinct from receipt->>'user_id'
  or h.stripe_session_id is distinct from receipt->>'session_id'
  or h.state not in ('held','attention','consumed') then
  raise exception 'House reservation mismatch';
 end if;
 subtotal=(receipt->>'subtotal_cents')::integer;
 total=(receipt->>'total_cents')::integer;
 tax=coalesce((receipt->>'tax_cents')::integer,0);
 if subtotal is null or total is null or subtotal<=0 or subtotal%quantity<>0 or tax<0
  or total::bigint<>subtotal::bigint+tax or coalesce((receipt->>'shipping_cents')::integer,0)<>0 then
  raise exception 'Invalid house amounts';
 end if;
 select * into existing from public.orders where stripe_checkout_session_id=receipt->>'session_id';
 if found then
  if existing.user_id is distinct from h.user_id or existing.stripe_payment_intent_id is distinct from receipt->>'payment_intent_id'
   or existing.subtotal_cents is distinct from subtotal or existing.tax_cents is distinct from tax
   or existing.total_cents is distinct from total or existing.currency is distinct from receipt->>'currency'
   or not exists (select 1 from public.order_items i where i.order_id=existing.id
       and i.product_id=product_uuid and i.artist_id=artist_uuid and i.quantity=cs_record_house_gallery_payment.quantity
       and i.gallery_sale_kind='house')
   or not exists (select 1 from public.gallery_private_deliveries d where d.order_id=existing.id
       and d.product_id=product_uuid and d.approved_asset_id=p_asset) then
   raise exception 'House replay mismatch';
  end if;
  return jsonb_build_object('id',existing.id,'created',false);
 end if;
 if h.state='consumed' or (p.stock_count is not null and p.stock_count<quantity) then
  raise exception 'House stock requires reconciliation';
 end if;
 perform 1 from public.gallery_approved_assets a where a.id=p_asset and a.product_id=product_uuid and a.revoked_at is null for share;
 if not found then raise exception 'House edition unavailable'; end if;
 insert into public.orders(user_id,buyer_email,stripe_checkout_session_id,stripe_payment_intent_id,subtotal_cents,
   shipping_cents,tax_cents,total_cents,currency,fulfillment_state,paid_at)
 values(h.user_id,coalesce(receipt->>'email',''),receipt->>'session_id',receipt->>'payment_intent_id',subtotal,
   0,tax,total,receipt->>'currency','pending',now()) returning id into new_id;
 insert into public.order_items(order_id,product_id,artist_id,title_snapshot,price_cents,quantity,line_total_cents,
   application_fee_cents,transfer_destination,gallery_sale_kind)
 values(new_id,product_uuid,artist_uuid,coalesce(receipt->>'title',p.title),subtotal/quantity,quantity,subtotal,0,null,'house');
 insert into public.gallery_private_deliveries(order_id,product_id,approved_asset_id,object_path)
 values(new_id,product_uuid,p_asset,new_id::text||'/'||p_asset::text);
 if p.stock_count is not null then update public.products set stock_count=stock_count-quantity where id=product_uuid; end if;
 update public.gallery_inventory_holds set state='consumed' where id=p_hold;
 return jsonb_build_object('id',new_id,'created',true);
end;
$$;
revoke all on function public.cs_record_house_gallery_payment(uuid,uuid,uuid,uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.cs_record_house_gallery_payment(uuid,uuid,uuid,uuid,integer,jsonb) to service_role;
commit;
