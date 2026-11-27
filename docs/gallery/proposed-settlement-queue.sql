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
    or p_event is null or p_event !~ '^evt_[A-Za-z0-9_]{1,120}
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
   lease_token=null,lease_expires_at=null,reason=null,
   refund_floor_cents=greatest(q.refund_floor_cents,excluded.refund_floor_cents)
 where q.stripe_payment_intent_id=excluded.stripe_payment_intent_id and q.livemode=excluded.livemode
   and q.sale_kind=excluded.sale_kind and q.currency=excluded.currency and q.captured_cents=excluded.captured_cents
 returning q.generation into g;
 if g is null then raise exception 'Gallery settlement order identity mismatch'; end if;
 return g;
end $$;

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
declare q public.gallery_settlement_queue%rowtype; is_review boolean;
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
 is_review:=jsonb_array_length(p_snapshot#>'{order_comparison,attention}')>0;
 insert into public.gallery_settlement_observations(order_id,stripe_payment_intent_id,provider_snapshot)
 values(q.order_id,q.stripe_payment_intent_id,p_snapshot||jsonb_build_object('queue_generation',q.generation));
 update public.gallery_settlement_queue set state=case when is_review then 'review' else 'observed' end,
   lease_token=null,lease_expires_at=null,reason=case when is_review then 'invalid_evidence' else null end
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

revoke all on function public.cs_enqueue_gallery_settlement(uuid,boolean,text,text,bigint),
 public.cs_claim_gallery_settlement(boolean,integer),
 public.cs_finish_gallery_settlement(uuid,boolean,bigint,uuid,jsonb),
 public.cs_retry_gallery_settlement(uuid,boolean,bigint,uuid,text)
 from public,anon,authenticated,service_role;
grant execute on function public.cs_enqueue_gallery_settlement(uuid,boolean,text,text,bigint),
 public.cs_claim_gallery_settlement(boolean,integer),
 public.cs_finish_gallery_settlement(uuid,boolean,bigint,uuid,jsonb),
 public.cs_retry_gallery_settlement(uuid,boolean,bigint,uuid,text) to service_role;
commit;

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
 insert into public.gallery_settlement_queue_events(livemode,event_id,order_id) values(p_live,p_event,p_order)
 on conflict do nothing;
 get diagnostics n=row_count;
 if n=0 then
  if not exists(select 1 from public.gallery_settlement_queue_events e
        where e.livemode=p_live and e.event_id=p_event and e.order_id=p_order) then
   raise exception 'Gallery settlement event already bound';
  end if;
  select q.generation into strict g from public.gallery_settlement_queue q
    where q.order_id=p_order and q.livemode=p_live and q.sale_kind=p_kind;
  return g;
 end if;
 insert into public.gallery_settlement_queue as q(order_id,stripe_payment_intent_id,livemode,sale_kind,currency,captured_cents,refund_floor_cents)
 values(p_order,o.stripe_payment_intent_id,p_live,p_kind,o.currency,o.total_cents,o.refund_floor_cents)
 on conflict(order_id) do update set generation=q.generation+1,attempts=0,state='queued',due_at=clock_timestamp(),
   lease_token=null,lease_expires_at=null,reason=null,
   refund_floor_cents=greatest(q.refund_floor_cents,excluded.refund_floor_cents)
 where q.stripe_payment_intent_id=excluded.stripe_payment_intent_id and q.livemode=excluded.livemode
   and q.sale_kind=excluded.sale_kind and q.currency=excluded.currency and q.captured_cents=excluded.captured_cents
 returning q.generation into g;
 if g is null then raise exception 'Gallery settlement order identity mismatch'; end if;
 return g;
end $$;

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
declare q public.gallery_settlement_queue%rowtype; is_review boolean;
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
 is_review:=jsonb_array_length(p_snapshot#>'{order_comparison,attention}')>0;
 insert into public.gallery_settlement_observations(order_id,stripe_payment_intent_id,provider_snapshot)
 values(q.order_id,q.stripe_payment_intent_id,p_snapshot||jsonb_build_object('queue_generation',q.generation));
 update public.gallery_settlement_queue set state=case when is_review then 'review' else 'observed' end,
   lease_token=null,lease_expires_at=null,reason=case when is_review then 'invalid_evidence' else null end
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

revoke all on function public.cs_enqueue_gallery_settlement(uuid,boolean,text,text,bigint),
 public.cs_claim_gallery_settlement(boolean,integer),
 public.cs_finish_gallery_settlement(uuid,boolean,bigint,uuid,jsonb),
 public.cs_retry_gallery_settlement(uuid,boolean,bigint,uuid,text)
 from public,anon,authenticated,service_role;
grant execute on function public.cs_enqueue_gallery_settlement(uuid,boolean,text,text,bigint),
 public.cs_claim_gallery_settlement(boolean,integer),
 public.cs_finish_gallery_settlement(uuid,boolean,bigint,uuid,jsonb),
 public.cs_retry_gallery_settlement(uuid,boolean,bigint,uuid,text) to service_role;
commit;
