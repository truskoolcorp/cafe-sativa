-- Draft only. No cron, trigger, automatic historical sweep, or provider calls.
-- Apply after private delivery, house checkout, refund ledger and settlement observations.
begin;
create table public.gallery_settlement_queue (
 order_id uuid primary key references public.orders(id) on delete restrict,
 stripe_payment_intent_id text not null check(stripe_payment_intent_id ~ '^pi_[A-Za-z0-9_]+$'),
 livemode boolean not null,
 sale_kind text not null check(sale_kind in ('house','consigned')),
 currency text not null check(currency ~ '^[a-z]{3}$'),
 captured_cents bigint not null check(captured_cents>0),
 refund_floor_cents bigint not null check(refund_floor_cents between 0 and captured_cents),
 generation bigint not null default 1 check(generation>0),
 attempts integer not null default 0 check(attempts between 0 and 5),
 state text not null default 'queued' check(state in ('queued','leased','observed','review')),
 due_at timestamptz not null default clock_timestamp(),
 lease_token uuid, lease_expires_at timestamptz,
 accepted_observation_id uuid references public.gallery_settlement_observations(id) on delete restrict,
 reason text check(reason is null or reason in ('provider_retry','evidence_retry','invalid_evidence','attempt_limit')),
 check ((state='leased' and lease_token is not null and lease_expires_at is not null)
    or (state<>'leased' and lease_token is null and lease_expires_at is null))
);
create index gallery_settlement_queue_due on public.gallery_settlement_queue(livemode,state,due_at,order_id);
create table public.gallery_settlement_queue_events (
 livemode boolean not null,
 event_id text not null check(event_id ~ '^evt_[A-Za-z0-9_]{1,120}$'),
 order_id uuid not null references public.orders(id) on delete restrict,
 signed_refund_floor_cents bigint not null check(signed_refund_floor_cents>=0),
 primary key(livemode,event_id)
);
alter table public.gallery_settlement_queue enable row level security;
alter table public.gallery_settlement_queue_events enable row level security;
revoke all on public.gallery_settlement_queue,public.gallery_settlement_queue_events
 from public,anon,authenticated,service_role;

-- Caller must already verify webhook signature, event, Stripe account and mode.
-- For atomicity this must later be called WITH the authoritative payment/refund
-- mutation in one DB transaction, not as an independent HTTP/PostgREST request.
create function public.cs_enqueue_gallery_settlement(p_order uuid,p_live boolean,p_kind text,p_event text,p_signed_refund_floor bigint)
returns bigint language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare o record; g bigint; n integer;
begin
 if p_order is null or p_live is null or p_kind is null or p_kind not in ('house','consigned')
    or p_event is null or p_event !~ '^evt_[A-Za-z0-9_]{1,120}$'
    or p_signed_refund_floor is null or p_signed_refund_floor<0 then
  raise exception 'Invalid Gallery settlement event';
 end if;
 select x.id,x.stripe_payment_intent_id,x.currency,x.total_cents,
  case when x.fulfillment_state::text='refunded' then x.total_cents else
   coalesce((select sum(f.amount_cents) from public.gallery_refund_receipts f
     where f.order_id=x.id and f.stripe_payment_intent_id=x.stripe_payment_intent_id
       and f.currency=x.currency and f.provider_status='succeeded'),0) end as refund_floor_cents into strict o
 from public.orders x join public.order_items i on i.order_id=x.id
 join public.gallery_private_deliveries d on d.order_id=x.id and d.product_id=i.product_id
 where x.id=p_order and x.paid_at is not null and x.user_id is not null
   and starts_with(x.stripe_checkout_session_id,case when p_live then 'cs_live_' else 'cs_test_' end)
   and x.total_cents=x.subtotal_cents and x.total_cents>0
   and x.shipping_cents=0 and x.tax_cents=0
   and i.product_id is not null and i.artist_id is not null and i.quantity>0
   and i.price_cents::bigint*i.quantity=i.line_total_cents and i.line_total_cents=x.total_cents
   and ((p_kind='house' and i.gallery_sale_kind='house' and i.application_fee_cents=0 and i.transfer_destination is null)
     or (p_kind='consigned' and i.gallery_sale_kind is null and i.transfer_destination ~ '^acct_[A-Za-z0-9]+$'
       and i.application_fee_cents=floor(i.line_total_cents::numeric/10)))
   and (select count(*) from public.order_items j where j.order_id=x.id)=1;
 if p_signed_refund_floor>o.total_cents then raise exception 'Invalid Gallery signed refund floor'; end if;
 -- Caller supplies the authenticated event refund total (zero for paid events).
 insert into public.gallery_settlement_queue_events(livemode,event_id,order_id,signed_refund_floor_cents)
 values(p_live,p_event,p_order,p_signed_refund_floor)
 on conflict do nothing;
 get diagnostics n=row_count;
 if n=0 then
  if not exists(select 1 from public.gallery_settlement_queue_events e
        where e.livemode=p_live and e.event_id=p_event and e.order_id=p_order
          and e.signed_refund_floor_cents=p_signed_refund_floor) then
   raise exception 'Gallery settlement event already bound';
  end if;
  select q.generation into strict g from public.gallery_settlement_queue q
    where q.order_id=p_order and q.livemode=p_live and q.sale_kind=p_kind;
  return g;
 end if;
 insert into public.gallery_settlement_queue as q(order_id,stripe_payment_intent_id,livemode,sale_kind,currency,captured_cents,refund_floor_cents)
 values(p_order,o.stripe_payment_intent_id,p_live,p_kind,o.currency,o.total_cents,greatest(o.refund_floor_cents,p_signed_refund_floor))
 on conflict(order_id) do update set generation=q.generation+1,attempts=0,state='queued',due_at=clock_timestamp(),
   lease_token=null,lease_expires_at=null,reason=null,accepted_observation_id=null,
   refund_floor_cents=greatest(q.refund_floor_cents,excluded.refund_floor_cents)
 where q.stripe_payment_intent_id=excluded.stripe_payment_intent_id and q.livemode=excluded.livemode
   and q.sale_kind=excluded.sale_kind and q.currency=excluded.currency and q.captured_cents=excluded.captured_cents
 returning q.generation into g;
 if g is null then raise exception 'Gallery settlement order identity mismatch'; end if;
 return g;
end $$;

-- Draft ordinary private-edition entry points. Caller authenticates the
-- Stripe signature, provider account, mode, payment intent and metadata.
-- Do not route legacy, physical, NFT, ticket or membership events here.
create function public.cs_record_gallery_payment_with_settlement(
 p_hold uuid,p_asset uuid,p_product uuid,p_artist uuid,p_quantity integer,
 p_receipt jsonb,p_live boolean,p_kind text,p_event text)
returns jsonb language plpgsql security invoker set search_path='' as $payment$
declare recorded jsonb; g bigint;
begin
 if p_live is null or p_kind is null or p_kind not in ('house','consigned')
  or p_event is null or p_event !~ '^evt_[A-Za-z0-9_]{1,120}$'
  or jsonb_typeof(p_receipt) is distinct from 'object'
  or not coalesce(starts_with(p_receipt->>'session_id',case when p_live then 'cs_live_' else 'cs_test_' end),false)
  or coalesce((p_receipt->>'shipping_cents')::bigint,0)<>0
  or coalesce((p_receipt->>'tax_cents')::bigint,0)<>0
 then raise exception 'Invalid Gallery queued payment event'; end if;
 if p_kind='house' then
  recorded:=public.cs_record_house_gallery_payment(p_hold,p_asset,p_product,p_artist,p_quantity,p_receipt);
 else
  recorded:=public.cs_record_consigned_private_gallery_payment(p_hold,p_asset,p_product,p_artist,p_quantity,p_receipt);
 end if;
 -- Queue failure must roll back the order, hold and entitlement mutation.
 g:=public.cs_enqueue_gallery_settlement((recorded->>'id')::uuid,p_live,p_kind,p_event,0);
 return recorded||jsonb_build_object('settlement_generation',g);
end $payment$;

create function public.cs_record_gallery_refund_event_with_settlement(
 p_order uuid,p_live boolean,p_kind text,p_event text,p_intent text,p_currency text,
 p_captured bigint,p_refunded bigint,p_full boolean)
returns bigint language plpgsql security invoker set search_path='' as $refund$
declare o public.orders%rowtype; g bigint;
begin
 if p_order is null or p_live is null or p_full is null or p_kind is null
  or p_kind not in ('house','consigned') or p_event is null or p_event !~ '^evt_[A-Za-z0-9_]{1,120}$'
  or p_intent is null or p_intent !~ '^pi_[A-Za-z0-9_]+$'
  or p_currency is null or p_currency !~ '^[a-z]{3}$'
  or p_captured is null or p_refunded is null or p_captured<=0
  or p_refunded not between 1 and p_captured or p_full is distinct from (p_refunded=p_captured)
 then raise exception 'Invalid Gallery queued refund event'; end if;
 select * into strict o from public.orders where id=p_order for update;
 if o.stripe_payment_intent_id is distinct from p_intent or o.currency is distinct from p_currency
  or o.total_cents::bigint is distinct from p_captured
 then raise exception 'Gallery queued refund order mismatch'; end if;
 -- Validate ordinary paid scope and persist the signed floor before any
 -- later provider evidence read. Full refunds revoke access in this same
 -- transaction; an older partial replay can never restore access.
 g:=public.cs_enqueue_gallery_settlement(p_order,p_live,p_kind,p_event,p_refunded);
 if p_full then
  update public.orders set fulfillment_state='refunded',updated_at=now()
   where id=p_order and fulfillment_state::text is distinct from 'refunded';
  insert into public.gallery_restock_reviews(order_id,reason)
   values(p_order,'full_refund_requires_review') on conflict(order_id) do nothing;
 end if;
 return g;
end $refund$;
revoke all on function public.cs_record_gallery_payment_with_settlement(uuid,uuid,uuid,uuid,integer,jsonb,boolean,text,text),
 public.cs_record_gallery_refund_event_with_settlement(uuid,boolean,text,text,text,text,bigint,bigint,boolean)
 from public,anon,authenticated,service_role;
grant execute on function public.cs_record_gallery_payment_with_settlement(uuid,uuid,uuid,uuid,integer,jsonb,boolean,text,text),
 public.cs_record_gallery_refund_event_with_settlement(uuid,boolean,text,text,text,text,bigint,bigint,boolean)
 to service_role;

create function public.cs_claim_gallery_settlement(p_live boolean,p_limit integer default 3)
returns table(order_id uuid,generation bigint,lease_token uuid)
language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare t timestamptz:=clock_timestamp();
begin
 if p_live is null or p_limit is null or p_limit not between 1 and 5 then
  raise exception 'Invalid Gallery settlement claim';
 end if;
 -- Bound expired-terminal reclamation independently of new work.
 with terminal as (
  select q.order_id from public.gallery_settlement_queue q
   where q.livemode=p_live and q.state='leased' and q.attempts=5 and q.lease_expires_at<=t
   order by q.lease_expires_at,q.order_id limit p_limit for update skip locked
 )
 update public.gallery_settlement_queue q set state='review',reason='attempt_limit',lease_token=null,lease_expires_at=null
 from terminal x where q.order_id=x.order_id;
 return query with eligible as (
  select q.order_id from public.gallery_settlement_queue q
   where q.livemode=p_live and q.attempts<5 and
    ((q.state='queued' and q.due_at<=t) or (q.state='leased' and q.lease_expires_at<=t))
   order by case when q.state='leased' then q.lease_expires_at else q.due_at end,q.order_id
   limit p_limit for update skip locked
 )
 update public.gallery_settlement_queue q set state='leased',attempts=q.attempts+1,lease_token=gen_random_uuid(),
   lease_expires_at=t+interval '2 minutes'
 from eligible e where q.order_id=e.order_id
 returning q.order_id,q.generation,q.lease_token;
end $$;

create function public.cs_finish_gallery_settlement(p_order uuid,p_live boolean,p_generation bigint,p_lease uuid,p_snapshot jsonb)
returns boolean language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare q public.gallery_settlement_queue%rowtype; is_review boolean; observation_id uuid;
 c jsonb; bal jsonb; r jsonb; rb jsonb; refund_ids text[]:=array[]::text[];
 refunded numeric; succeeded_total numeric:=0; provider_fee numeric; original_fee numeric;
 remaining_fee numeric; remaining_artist numeric; platform_net numeric; fee_reversal numeric;
begin
 select * into q from public.gallery_settlement_queue j where j.order_id=p_order for update;
 if not found or q.livemode is distinct from p_live or q.generation is distinct from p_generation
    or q.state<>'leased' or q.lease_token is distinct from p_lease or q.lease_expires_at<=clock_timestamp() then
  return false;
 end if;
 if pg_column_size(p_snapshot)>131072 or jsonb_typeof(p_snapshot) is distinct from 'object'
    or p_snapshot->'livemode' is distinct from to_jsonb(q.livemode)
    or p_snapshot->>'payment_intent_id' is distinct from q.stripe_payment_intent_id
    or p_snapshot->>'sale_kind' is distinct from q.sale_kind
    or p_snapshot->>'currency' is distinct from q.currency
    or p_snapshot->'captured_cents' is distinct from to_jsonb(q.captured_cents)
    or jsonb_typeof(p_snapshot->'refunded_cents') is distinct from 'number'
    or jsonb_typeof(p_snapshot#>'{order_comparison,attention}') is distinct from 'array' then
  raise exception 'Gallery settlement observation identity mismatch';
 end if;
 if (p_snapshot->>'refunded_cents')::numeric not between q.refund_floor_cents and q.captured_cents
    or (p_snapshot->>'refunded_cents')::numeric<>trunc((p_snapshot->>'refunded_cents')::numeric) then
  raise exception 'Invalid Gallery settlement refund total';
 end if;
 -- A sparse or internally contradictory snapshot must never establish a settled generation.
 -- Unknown provider data may be retained for review only, with explicit attention.
 c:=p_snapshot->'order_comparison';
 if not (p_snapshot ?& array['charge_id','expected_original_fee_cents','transfer_id','transfer_cents',
  'transfer_reversed_cents','application_fee_id','application_fee_cents','application_fee_refunded_cents',
  'observed_artist_connect_allocation_cents','observed_platform_application_fee_cents',
  'observed_charge_refund_balance_fee_cents','charge_balance','refunds','attention'])
  or not (c ?& array['sale_kind','order_subtotal_cents','order_total_cents',
   'expected_original_commission_cents','expected_remaining_commission_cents',
   'expected_remaining_artist_cents','observed_platform_after_charge_refund_fees_cents','attention'])
  or jsonb_typeof(p_snapshot->'attention') is distinct from 'array'
  or jsonb_typeof(p_snapshot->'refunds') is distinct from 'array'
  or c->>'sale_kind' is distinct from q.sale_kind
  or c->'order_subtotal_cents' is distinct from to_jsonb(q.captured_cents)
  or c->'order_total_cents' is distinct from to_jsonb(q.captured_cents) then
  raise exception 'Incomplete Gallery settlement evidence';
 end if;
 if jsonb_array_length(p_snapshot->'refunds')>10 then
  raise exception 'Incomplete Gallery settlement evidence';
 end if;
 is_review:=jsonb_array_length(c->'attention')>0 or jsonb_array_length(p_snapshot->'attention')>0;
 if not is_review then
  refunded:=(p_snapshot->>'refunded_cents')::numeric;
  bal:=p_snapshot->'charge_balance';
  if coalesce(p_snapshot->>'charge_id','') !~ '^ch_[A-Za-z0-9_]+$'
   or jsonb_typeof(bal) is distinct from 'object'
   or coalesce(bal->>'id','') !~ '^txn_[A-Za-z0-9_]+$'
   or bal->'amount_cents' is distinct from to_jsonb(q.captured_cents)
   or jsonb_typeof(bal->'fee_cents') is distinct from 'number'
   or jsonb_typeof(bal->'net_cents') is distinct from 'number'
   or coalesce(bal->>'status','') not in ('pending','available') then
   raise exception 'Incomplete Gallery charge balance evidence';
  end if;
  provider_fee:=(bal->>'fee_cents')::numeric;
  if provider_fee<>trunc(provider_fee) or (bal->>'net_cents')::numeric<>q.captured_cents-provider_fee then
   raise exception 'Invalid Gallery charge balance arithmetic';
  end if;
  for r in select value from jsonb_array_elements(p_snapshot->'refunds') loop
   if jsonb_typeof(r) is distinct from 'object' or not (r ?& array['id','amount_cents','status','balance'])
    or coalesce(r->>'id','') !~ '^re_[A-Za-z0-9_]+$' or (r->>'id')=any(refund_ids)
    or jsonb_typeof(r->'amount_cents') is distinct from 'number'
    or coalesce(r->>'status','') not in ('succeeded','failed','canceled') then
    raise exception 'Incomplete Gallery refund evidence';
   end if;
   refund_ids:=array_append(refund_ids,r->>'id');
   if (r->>'amount_cents')::numeric<=0 or (r->>'amount_cents')::numeric>q.captured_cents
     or (r->>'amount_cents')::numeric<>trunc((r->>'amount_cents')::numeric) then
    raise exception 'Invalid Gallery refund evidence';
   end if;
   if r->>'status'='succeeded' then
    rb:=r->'balance';
    if jsonb_typeof(rb) is distinct from 'object' or coalesce(rb->>'id','') !~ '^txn_[A-Za-z0-9_]+$'
      or rb->'amount_cents' is distinct from to_jsonb(-(r->>'amount_cents')::numeric)
      or jsonb_typeof(rb->'fee_cents') is distinct from 'number'
      or jsonb_typeof(rb->'net_cents') is distinct from 'number'
      or coalesce(rb->>'status','') not in ('pending','available') then
     raise exception 'Incomplete Gallery refund balance evidence';
    end if;
    if (rb->>'fee_cents')::numeric<>trunc((rb->>'fee_cents')::numeric)
      or (rb->>'net_cents')::numeric<>(rb->>'amount_cents')::numeric-(rb->>'fee_cents')::numeric then
     raise exception 'Invalid Gallery refund balance arithmetic';
    end if;
    succeeded_total:=succeeded_total+(r->>'amount_cents')::numeric;
    provider_fee:=provider_fee+(rb->>'fee_cents')::numeric;
   elsif r->'balance' is distinct from 'null'::jsonb then
    raise exception 'Invalid Gallery unsuccessful refund balance';
   end if;
  end loop;
  if succeeded_total<>refunded
   or p_snapshot->'observed_charge_refund_balance_fee_cents' is distinct from to_jsonb(provider_fee) then
   raise exception 'Invalid Gallery refund or processing fee total';
  end if;
  original_fee:=case when q.sale_kind='house' then 0 else floor(q.captured_cents::numeric/10) end;
  fee_reversal:=floor(original_fee*refunded/q.captured_cents);
  remaining_fee:=original_fee-fee_reversal;
  remaining_artist:=case when q.sale_kind='house' then 0 else q.captured_cents-refunded-remaining_fee end;
  if q.sale_kind='house' then
   if p_snapshot->'expected_original_fee_cents' not in ('null'::jsonb,'0'::jsonb)
    or exists(select 1 from unnest(array['transfer_id','transfer_cents','transfer_reversed_cents',
      'application_fee_id','application_fee_cents','application_fee_refunded_cents',
      'observed_artist_connect_allocation_cents','observed_platform_application_fee_cents']) as keys(k)
      where p_snapshot->k is distinct from 'null'::jsonb) then
    raise exception 'Unexpected Gallery house Connect evidence';
   end if;
   platform_net:=q.captured_cents-refunded-provider_fee;
  else
   if coalesce(p_snapshot->>'transfer_id','') !~ '^tr_[A-Za-z0-9_]+$'
    or coalesce(p_snapshot->>'application_fee_id','') !~ '^fee_[A-Za-z0-9_]+$'
    or p_snapshot->'expected_original_fee_cents' is distinct from to_jsonb(original_fee)
    or p_snapshot->'application_fee_cents' is distinct from to_jsonb(original_fee)
    or p_snapshot->'transfer_cents' is distinct from to_jsonb(q.captured_cents)
    or p_snapshot->'transfer_reversed_cents' is distinct from to_jsonb(refunded)
    or p_snapshot->'application_fee_refunded_cents' is distinct from to_jsonb(fee_reversal)
    or p_snapshot->'observed_platform_application_fee_cents' is distinct from to_jsonb(remaining_fee)
    or p_snapshot->'observed_artist_connect_allocation_cents' is distinct from to_jsonb(remaining_artist) then
    raise exception 'Invalid Gallery consigned Connect evidence';
   end if;
   platform_net:=remaining_fee-provider_fee;
  end if;
  if c->'expected_original_commission_cents' is distinct from to_jsonb(original_fee)
   or c->'expected_remaining_commission_cents' is distinct from to_jsonb(remaining_fee)
   or c->'expected_remaining_artist_cents' is distinct from to_jsonb(remaining_artist)
   or c->'observed_platform_after_charge_refund_fees_cents' is distinct from to_jsonb(platform_net) then
   raise exception 'Invalid Gallery order settlement comparison';
  end if;
 end if;
 insert into public.gallery_settlement_observations(order_id,stripe_payment_intent_id,provider_snapshot)
 values(q.order_id,q.stripe_payment_intent_id,p_snapshot||jsonb_build_object('queue_generation',q.generation)) returning id into observation_id;
 update public.gallery_settlement_queue set state=case when is_review then 'review' else 'observed' end,
   lease_token=null,lease_expires_at=null,accepted_observation_id=case when is_review then null else observation_id end,
   reason=case when is_review then 'invalid_evidence' else null end
 where order_id=q.order_id;
 return true;
end $$;

create function public.cs_retry_gallery_settlement(p_order uuid,p_live boolean,p_generation bigint,p_lease uuid,p_reason text)
returns boolean language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
begin
 if p_reason is null or p_reason not in ('provider_retry','evidence_retry') then
  raise exception 'Invalid Gallery settlement retry reason';
 end if;
 update public.gallery_settlement_queue q
 set state=case when q.attempts>=5 then 'review' else 'queued' end,
   due_at=clock_timestamp()+make_interval(mins=>5 * (1 << (q.attempts-1))),
   reason=case when q.attempts>=5 then 'attempt_limit' else p_reason end,lease_token=null,lease_expires_at=null
 where q.order_id=p_order and q.livemode=p_live and q.generation=p_generation and q.state='leased'
   and q.lease_token=p_lease and q.lease_expires_at>clock_timestamp();
 return found;
end $$;

-- Service-only, single-order report source. The caller must separately authorize
-- the owner/artist and choose mode from trusted server configuration, not input.
-- Never choose the newest observation by timestamp: only the exact observation
-- accepted by the current lease can establish settled evidence.
create function public.cs_read_gallery_settlement(p_order uuid,p_live boolean)
returns jsonb language sql stable security definer set search_path=pg_catalog,public,pg_temp as $$
 select jsonb_build_object(
  'state',case when q.state='observed' and s.id is null then 'review' else q.state end,
  'generation',q.generation,'refund_floor_cents',q.refund_floor_cents,
  'observed_at',case when q.state='observed' then s.observed_at else null end,
  'evidence',case when q.state='observed' then s.provider_snapshot else null end)
 from public.gallery_settlement_queue q
 left join public.gallery_settlement_observations s on s.id=q.accepted_observation_id
  and s.order_id=q.order_id and s.stripe_payment_intent_id=q.stripe_payment_intent_id
  and s.provider_snapshot->'livemode'=to_jsonb(q.livemode)
  and s.provider_snapshot->'queue_generation'=to_jsonb(q.generation)
  and s.provider_snapshot->>'currency'=q.currency
  and s.provider_snapshot->>'sale_kind'=q.sale_kind
  and s.provider_snapshot->'captured_cents'=to_jsonb(q.captured_cents)
  and case when jsonb_typeof(s.provider_snapshot->'refunded_cents')='number'
      then (s.provider_snapshot->>'refunded_cents')::numeric between q.refund_floor_cents and q.captured_cents
      else false end
 where p_order is not null and p_live is not null and q.order_id=p_order and q.livemode=p_live
$$;
revoke all on function public.cs_read_gallery_settlement(uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function public.cs_read_gallery_settlement(uuid,boolean) to service_role;

revoke all on function public.cs_enqueue_gallery_settlement(uuid,boolean,text,text,bigint),
 public.cs_claim_gallery_settlement(boolean,integer),
 public.cs_finish_gallery_settlement(uuid,boolean,bigint,uuid,jsonb),
 public.cs_retry_gallery_settlement(uuid,boolean,bigint,uuid,text)
 from public,anon,authenticated,service_role;
grant execute on function public.cs_enqueue_gallery_settlement(uuid,boolean,text,text,bigint),
 public.cs_claim_gallery_settlement(boolean,integer),
 public.cs_finish_gallery_settlement(uuid,boolean,bigint,uuid,jsonb),
 public.cs_retry_gallery_settlement(uuid,boolean,bigint,uuid,text) to service_role;

-- Service-only report projection of accepted queue evidence. Session mode is
-- derived from the recorded Checkout session, never from unaccepted observations.
create view public.gallery_order_accepted_financial_review with (security_invoker=true) as
select o.id as order_id, i.artist_id, i.product_id, i.title_snapshot, o.currency,
 o.paid_at, o.fulfillment_state, i.quantity, i.line_total_cents,
 case when i.gallery_sale_kind='house' then 'house' else 'consigned' end as sale_kind,
 i.application_fee_cents as recorded_commission_cents,
 s.observed_at, to_jsonb(starts_with(o.stripe_checkout_session_id,'cs_live_')) as provider_livemode,
 case when s.queue_state='review' then 'attention'
      when s.queue_state in ('queued','leased') then 'incomplete'
      when s.provider_snapshot is null then 'unobserved'
      when ((o.fulfillment_state::text='refunded' and
         s.provider_snapshot->'refunded_cents' is distinct from to_jsonb(o.total_cents))
       or (refund_totals.succeeded_cents is not null and
         s.provider_snapshot->'refunded_cents' is distinct from to_jsonb(refund_totals.succeeded_cents))) then 'attention'
      when jsonb_typeof(s.provider_snapshot#>'{order_comparison,attention}') is distinct from 'array' then 'incomplete'
      when jsonb_array_length(s.provider_snapshot#>'{order_comparison,attention}')>0 then 'attention'
      else 'observed' end as evidence_state,
 jsonb_build_object(
 -- Original expectation is derived from the recorded artwork line, even before provider observation.
 'expected_original_commission_cents',case when i.line_total_cents>0 then
   case when i.gallery_sale_kind='house' then 0 else floor(i.line_total_cents::numeric/10)::bigint end end,
 'expected_original_artist_cents',case when i.line_total_cents>0 then
   case when i.gallery_sale_kind='house' then 0 else i.line_total_cents-floor(i.line_total_cents::numeric/10)::bigint end end,
 'captured_cents',s.provider_snapshot->'captured_cents',
 'refunded_cents',s.provider_snapshot->'refunded_cents',
 'expected_remaining_commission_cents',s.provider_snapshot#>'{order_comparison,expected_remaining_commission_cents}',
 'expected_remaining_artist_cents',s.provider_snapshot#>'{order_comparison,expected_remaining_artist_cents}',
 'gross_transfer_cents',s.provider_snapshot->'transfer_cents',
 'original_application_fee_cents',s.provider_snapshot->'application_fee_cents',
 'artist_connect_allocation_cents',s.provider_snapshot->'observed_artist_connect_allocation_cents',
 'platform_application_fee_cents',s.provider_snapshot->'observed_platform_application_fee_cents',
 'processing_fees_cents',s.provider_snapshot->'observed_charge_refund_balance_fee_cents',
 'transfer_reversed_cents',s.provider_snapshot->'transfer_reversed_cents',
 'application_fee_refunded_cents',s.provider_snapshot->'application_fee_refunded_cents',
 'platform_after_charge_refund_fees_cents',s.provider_snapshot#>'{order_comparison,observed_platform_after_charge_refund_fees_cents}',
 'refund_evidence_mismatch',case when s.provider_snapshot is not null then ((o.fulfillment_state::text='refunded' and
         s.provider_snapshot->'refunded_cents' is distinct from to_jsonb(o.total_cents))
       or (refund_totals.succeeded_cents is not null and
         s.provider_snapshot->'refunded_cents' is distinct from to_jsonb(refund_totals.succeeded_cents))) end,
 'attention',s.provider_snapshot#>'{order_comparison,attention}'
 ) as financial_evidence
from public.orders o
join public.order_items i on i.order_id=o.id
left join lateral (
 select q.result->>'state' as queue_state,
   case when q.result->>'state'='observed' then (q.result->>'observed_at')::timestamptz end as observed_at,
   case when q.result->>'state'='observed' and jsonb_typeof(q.result->'evidence')='object'
     then q.result->'evidence' end as provider_snapshot
 from (select public.cs_read_gallery_settlement(o.id,starts_with(o.stripe_checkout_session_id,'cs_live_')) as result) q
) s on true
left join lateral (
 select sum(f.amount_cents) as succeeded_cents from public.gallery_refund_receipts f
 where f.order_id=o.id and f.stripe_payment_intent_id=o.stripe_payment_intent_id
   and f.currency=o.currency and f.provider_status='succeeded'
) refund_totals on true
where o.paid_at is not null and i.artist_id is not null and i.product_id is not null
 and (starts_with(o.stripe_checkout_session_id,'cs_test_') or starts_with(o.stripe_checkout_session_id,'cs_live_'))
 and exists(select 1 from public.gallery_private_deliveries d where d.order_id=o.id and d.product_id=i.product_id)
 and (select count(*) from public.order_items oi where oi.order_id=o.id)=1;
revoke all on public.gallery_order_accepted_financial_review from public,anon,authenticated,service_role;
grant select on public.gallery_order_accepted_financial_review to service_role;

commit;
