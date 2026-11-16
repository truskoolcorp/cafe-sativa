-- Inventory and receipt writes are service-only; event row locks serialize all grants.
create table public.cs_ticket_reservations (
 id uuid primary key default gen_random_uuid(),
 event_id uuid not null references public.events(id),
 user_id uuid not null references public.profiles(id),
 amount_cents integer not null check(amount_cents>0),
 state text not null default 'held' check(state in ('held','fulfilled','payment_attention')),
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '40 minutes',
 checkout_expires_at timestamptz not null default now()+interval '35 minutes',
 stripe_session_id text unique,
 stripe_payment_intent_id text unique,
 attention_reason text,
 ticket_id uuid references public.tickets(id)
);
create index cs_ticket_reservations_inventory on public.cs_ticket_reservations(event_id,state,expires_at);
alter table public.cs_ticket_reservations enable row level security;
revoke all on public.cs_ticket_reservations from anon,authenticated;
grant all on public.cs_ticket_reservations to service_role;

create function public.cs_reserve_ticket(event_uuid uuid, user_uuid uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
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
end $$;

create function public.cs_record_ticket_payment(reservation_uuid uuid, receipt jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
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
end $$;
revoke all on function public.cs_reserve_ticket(uuid,uuid) from public,anon,authenticated;
revoke all on function public.cs_record_ticket_payment(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.cs_reserve_ticket(uuid,uuid) to service_role;
grant execute on function public.cs_record_ticket_payment(uuid,jsonb) to service_role;
