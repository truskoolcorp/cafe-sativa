-- Exact read-only catalog definitions from November 8, 2026. Disposable DB only.
-- These are the ORIGINAL RPCs so migration source-drift checks stay meaningful.

-- Original prosrc md5: 6e645c410e554e71065ad72c5e522f97
CREATE OR REPLACE FUNCTION public.cs_record_gallery_payment(receipt jsonb, product_uuid uuid, artist_uuid uuid, quantity integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
end $function$;
REVOKE ALL ON FUNCTION public.cs_record_gallery_payment(jsonb,uuid,uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cs_record_gallery_payment(jsonb,uuid,uuid,integer) TO service_role;

-- Original prosrc md5: 8a93216663ce84586ccc100544dfe6c4
CREATE OR REPLACE FUNCTION public.cs_record_ticket_payment(reservation_uuid uuid, receipt jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare hold public.cs_ticket_reservations%rowtype; ev public.events%rowtype; ticket public.tickets%rowtype; used_count bigint; new_id uuid; reason text;
begin
 -- Find event before acquiring locks in the same order as reservation.
 select * into hold from public.cs_ticket_reservations where id=reservation_uuid;
 if not found then raise exception 'Reservation missing'; end if;
 select * into ev from public.events where id=hold.event_id for update;
 select * into hold from public.cs_ticket_reservations where id=reservation_uuid for update;
 if coalesce(receipt->>'site','')<>'cafe-sativa' or coalesce(receipt->>'payment_status','')<>'paid' or coalesce(receipt->>'currency','')<>'usd' or coalesce(receipt->>'user_id','')<>hold.user_id::text or coalesce(receipt->>'event_id','')<>hold.event_id::text or coalesce((receipt->>'amount_cents')::integer,-1)<>hold.amount_cents or coalesce(receipt->>'session_id','')='' or coalesce(receipt->>'payment_intent_id','')='' then raise exception 'Receipt mismatch'; end if;
 if hold.stripe_session_id is not null and hold.stripe_session_id<>receipt->>'session_id' then raise exception 'Session mismatch'; end if;
 if hold.stripe_payment_intent_id is not null and hold.stripe_payment_intent_id<>receipt->>'payment_intent_id' then raise exception 'Payment mismatch'; end if;
 if hold.state<>'held' then return jsonb_build_object('created',false,'state',hold.state,'ticket_id',hold.ticket_id); end if;
 select * into ticket from public.tickets where event_id=hold.event_id and user_id=hold.user_id;
 select (select count(*) from public.tickets where event_id=hold.event_id and state::text in ('pending','valid','used'))+(select count(*) from public.cs_ticket_reservations where event_id=hold.event_id and id<>hold.id and state='held' and expires_at>now()) into used_count;
 if ticket.id is not null and ticket.state::text<>'refunded' then reason:='Existing ticket requires payment reconciliation';
 elsif ev.status::text not in ('scheduled','live') or ev.starts_at<=now() then reason:='Payment settled after ticket sales closed';
 elsif ev.capacity is not null and used_count>=ev.capacity then reason:='Expired reservation settled after capacity filled'; end if;
 if reason is not null then
  update public.cs_ticket_reservations set state='payment_attention',stripe_session_id=receipt->>'session_id',stripe_payment_intent_id=receipt->>'payment_intent_id',attention_reason=reason where id=hold.id;
  return jsonb_build_object('created',false,'state','payment_attention');
 end if;
 insert into public.tickets(event_id,user_id,source,state,stripe_payment_intent_id,amount_paid_cents) values(hold.event_id,hold.user_id,'purchased','valid',receipt->>'payment_intent_id',hold.amount_cents)
 on conflict(event_id,user_id) do update set source='purchased',state='valid',stripe_payment_intent_id=excluded.stripe_payment_intent_id,amount_paid_cents=excluded.amount_paid_cents,redeemed_at=null,redemption_code=encode(extensions.gen_random_bytes(6),'hex') where tickets.state::text='refunded' returning id into new_id;
 if new_id is null then raise exception 'Ticket changed during fulfillment'; end if;
 update public.cs_ticket_reservations set state='fulfilled',stripe_session_id=receipt->>'session_id',stripe_payment_intent_id=receipt->>'payment_intent_id',ticket_id=new_id where id=hold.id;
 return jsonb_build_object('created',true,'state','fulfilled','ticket_id',new_id);
end $function$;
REVOKE ALL ON FUNCTION public.cs_record_ticket_payment(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cs_record_ticket_payment(uuid,jsonb) TO service_role;

-- Original prosrc md5: 21b88fa6e2545bcaa4c7cc785c1a34de
CREATE OR REPLACE FUNCTION public.cs_reserve_ticket(event_uuid uuid, user_uuid uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare ev public.events%rowtype; mem public.memberships%rowtype; old_ticket public.tickets%rowtype; hold public.cs_ticket_reservations%rowtype; included boolean; used_count bigint; granted_id uuid; source_value public.ticket_source;
begin
 select * into ev from public.events where id=event_uuid for update;
 if not found then return jsonb_build_object('error','not_found'); end if;
 if ev.status::text not in ('scheduled','live') or ev.starts_at<=now() then return jsonb_build_object('error','closed'); end if;
 select * into old_ticket from public.tickets where event_id=event_uuid and user_id=user_uuid;
 if found and old_ticket.state::text<>'refunded' then return jsonb_build_object('error','already_ticketed'); end if;
 select * into hold from public.cs_ticket_reservations where event_id=event_uuid and user_id=user_uuid and state='held' and expires_at>now() order by created_at desc limit 1;
 if found then return jsonb_build_object('granted',false,'reservation_id',hold.id,'amount_cents',hold.amount_cents,'session_id',hold.stripe_session_id,'checkout_expires_at',extract(epoch from hold.checkout_expires_at)::bigint,'title',ev.title,'slug',ev.slug); end if;
 select (select count(*) from public.tickets where event_id=event_uuid and state::text in ('pending','valid','used')) + (select count(*) from public.cs_ticket_reservations where event_id=event_uuid and state='held' and expires_at>now()) into used_count;
 if ev.capacity is not null and used_count>=ev.capacity then return jsonb_build_object('error','sold_out'); end if;
 select * into mem from public.memberships where user_id=user_uuid;
 included := (not found or (mem.status::text='active' and (mem.current_period_end is null or mem.current_period_end>now()))) and coalesce(mem.tier::text,'explorer')=any(ev.free_for_tiers::text[]);
 if ev.ticket_price_cents=0 or included then
  source_value := case when included then 'tier_included'::public.ticket_source else 'comp'::public.ticket_source end;
  insert into public.tickets(event_id,user_id,source,state,amount_paid_cents) values(event_uuid,user_uuid,source_value,'valid',0)
  on conflict(event_id,user_id) do update set source=excluded.source,state='valid',amount_paid_cents=0,stripe_payment_intent_id=null,redeemed_at=null,redemption_code=encode(extensions.gen_random_bytes(6),'hex') where tickets.state::text='refunded' returning id into granted_id;
  if granted_id is null then raise exception 'Ticket changed during grant'; end if;
  return jsonb_build_object('granted',true,'ticket_id',granted_id,'source',source_value);
 end if;
 if ev.ticket_price_cents<=0 then return jsonb_build_object('error','invalid_price'); end if;
 insert into public.cs_ticket_reservations(event_id,user_id,amount_cents) values(event_uuid,user_uuid,ev.ticket_price_cents) returning * into hold;
 return jsonb_build_object('granted',false,'reservation_id',hold.id,'amount_cents',hold.amount_cents,'session_id',null,'checkout_expires_at',extract(epoch from hold.checkout_expires_at)::bigint,'title',ev.title,'slug',ev.slug);
end $function$;
REVOKE ALL ON FUNCTION public.cs_reserve_ticket(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cs_reserve_ticket(uuid,uuid) TO service_role;

-- Original prosrc md5: d20c9b5f730626c2add771adc6dfcd4d
CREATE OR REPLACE FUNCTION public.soft_delete_lounge_message(p_message_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE actor uuid:=auth.uid(); target uuid;
BEGIN
  IF actor IS NULL THEN RAISE insufficient_privilege USING MESSAGE='Sign in to delete messages'; END IF;
  UPDATE public.lounge_messages m SET deleted_at=clock_timestamp(),deleted_by=actor
  WHERE m.id=p_message_id AND m.deleted_at IS NULL
  AND (m.user_id=actor OR EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=actor AND (p.is_staff OR p.is_admin)))
  RETURNING m.id INTO target;
  IF target IS NULL THEN RAISE insufficient_privilege USING MESSAGE='Message unavailable or not owned'; END IF;
  RETURN target;
END;
$function$;
REVOKE ALL ON FUNCTION public.soft_delete_lounge_message(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.soft_delete_lounge_message(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.soft_delete_lounge_message(uuid) TO authenticated;
