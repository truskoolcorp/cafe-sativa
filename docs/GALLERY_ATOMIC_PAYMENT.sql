create or replace function public.cs_record_gallery_payment(receipt jsonb, product_uuid uuid, artist_uuid uuid, quantity integer)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
 p public.products%rowtype; a public.artists%rowtype;
 existing_id uuid; new_id uuid;
 subtotal integer; unit_price integer; fee integer;
begin
 if receipt->>'session_id' is null or receipt->>'payment_status' <> 'paid' or quantity is null or quantity < 1 or quantity > 10 then
  raise exception 'Invalid paid receipt';
 end if;
 select * into p from public.products where id=product_uuid for update;
 if not found or p.artist_id<>artist_uuid then raise exception 'Product or artist mismatch'; end if;
 select id into existing_id from public.orders where stripe_checkout_session_id=receipt->>'session_id';
 if existing_id is not null then return jsonb_build_object('id',existing_id,'created',false); end if;
 subtotal=(receipt->>'subtotal_cents')::integer;
 if subtotal is null or subtotal<=0 or subtotal%quantity<>0 or (receipt->>'total_cents')::integer<0 then raise exception 'Invalid checkout amounts'; end if;
 unit_price=subtotal/quantity;
 fee=(receipt->>'application_fee_cents')::integer;
 if fee is null or fee<0 or fee>subtotal then raise exception 'Invalid application fee'; end if;
 if p.stock_count is not null and p.stock_count<quantity then raise exception 'Paid order requires inventory reconciliation'; end if;
 if p.kind::text<>'physical' and nullif(p.digital_delivery_url,'') is null then raise exception 'Digital delivery asset unavailable'; end if;
 select * into a from public.artists where id=artist_uuid;
 insert into public.orders(user_id,buyer_email,stripe_checkout_session_id,stripe_payment_intent_id,
 subtotal_cents,shipping_cents,tax_cents,total_cents,currency,shipping_name,shipping_line1,shipping_line2,
 shipping_city,shipping_state,shipping_postal_code,shipping_country,fulfillment_state,paid_at)
 values((receipt->>'user_id')::uuid,coalesce(receipt->>'email',''),receipt->>'session_id',receipt->>'payment_intent_id',
 subtotal,coalesce((receipt->>'shipping_cents')::integer,0),coalesce((receipt->>'tax_cents')::integer,0),
 (receipt->>'total_cents')::integer,receipt->>'currency',receipt->>'shipping_name',receipt->>'shipping_line1',receipt->>'shipping_line2',
 receipt->>'shipping_city',receipt->>'shipping_state',receipt->>'shipping_postal_code',receipt->>'shipping_country',
 'pending',now()) returning id into new_id;
 insert into public.order_items(order_id,product_id,artist_id,title_snapshot,price_cents,quantity,line_total_cents,application_fee_cents,transfer_destination)
 values(new_id,p.id,a.id,coalesce(receipt->>'title',p.title),unit_price,quantity,subtotal,fee,a.stripe_account_id);
 if p.stock_count is not null then update public.products set stock_count=stock_count-quantity where id=p.id; end if;
 return jsonb_build_object('id',new_id,'created',true);
end $$;
revoke all on function public.cs_record_gallery_payment(jsonb,uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.cs_record_gallery_payment(jsonb,uuid,uuid,integer) to service_role;

