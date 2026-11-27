#!/usr/bin/env bash
# Only the disposable PostgreSQL fixture; no network, provider, or credentials.
set -euo pipefail
source "$(dirname "$0")/gallery-consigned-private-postgres.sh"
psql -f docs/gallery/proposed-settlement-queue.sql >/dev/null
psql <<'SQL'
do $permissions$
begin
 if has_function_privilege('anon','public.cs_enqueue_gallery_settlement(uuid,boolean,text,text,bigint)','EXECUTE')
  or has_function_privilege('authenticated','public.cs_claim_gallery_settlement(boolean,integer)','EXECUTE')
  or has_function_privilege('authenticated','public.cs_finish_gallery_settlement(uuid,boolean,bigint,uuid,jsonb)','EXECUTE')
  or has_function_privilege('anon','public.cs_read_gallery_settlement(uuid,boolean)','EXECUTE')
  or has_function_privilege('authenticated','public.cs_read_gallery_settlement(uuid,boolean)','EXECUTE')
  or has_table_privilege('service_role','public.gallery_settlement_queue','UPDATE')
  or has_table_privilege('service_role','public.gallery_settlement_queue_events','SELECT') then
  raise exception 'Queue exposed beyond service-only RPC';
 end if;
end $permissions$;
set role service_role;
do $fixture$
declare o uuid; intent constant text:='pi_test_consigned_private_fixture'; q record; q2 record; snapshot jsonb;
begin
 select id into strict o from public.orders where stripe_payment_intent_id=intent;
 -- An enqueue rolled back with its parent mutation does not retain work or dedupe.
 begin
  if public.cs_enqueue_gallery_settlement(o,false,'consigned','evt_paid_fixture',0)<>1 then
   raise exception 'Unexpected generation inside rolled-back transaction'; end if;
  raise exception 'Fixture intentional rollback';
 exception when others then
  if sqlerrm<>'Fixture intentional rollback' then raise; end if;
 end;
 if exists(select 1 from public.cs_claim_gallery_settlement(false,3)) then raise exception 'Rollback leaked queue work'; end if;
 begin
  perform public.cs_enqueue_gallery_settlement(o,true,'consigned','evt_wrong_mode',0);
  raise exception 'Wrong mode accepted';
 exception when no_data_found then null; end;
 begin
  perform public.cs_enqueue_gallery_settlement(o,false,'house','evt_wrong_kind',0);
  raise exception 'Wrong kind accepted';
 exception when no_data_found then null; end;
 if public.cs_enqueue_gallery_settlement(o,false,'consigned','evt_paid_fixture',0)<>1 or
    public.cs_enqueue_gallery_settlement(o,false,'consigned','evt_paid_fixture',0)<>1 then
   raise exception 'Duplicate changed generation'; end if;
 if exists(select 1 from public.cs_claim_gallery_settlement(true,3)) then raise exception 'Test work leased to live worker'; end if;
 select * into strict q from public.cs_claim_gallery_settlement(false,3);
 if q.order_id<>o or q.generation<>1 or q.lease_token is null or
    exists(select 1 from public.cs_claim_gallery_settlement(false,3)) then raise exception 'Unexpected claim'; end if;
 snapshot:=jsonb_build_object('payment_intent_id',intent,'livemode',false,'sale_kind','consigned','currency','usd',
   'captured_cents',1249,'refunded_cents',0,'order_comparison',jsonb_build_object('attention','[]'::jsonb));
 -- Prove floor persistence before any provider ledger receipt exists.
 begin
  perform public.cs_enqueue_gallery_settlement(o,false,'consigned','evt_excess_floor',1250);
  raise exception 'Excess signed floor accepted';
 exception when others then
  if sqlerrm<>'Invalid Gallery signed refund floor' then raise; end if;
 end;
 if public.cs_enqueue_gallery_settlement(o,false,'consigned','evt_refund_fixture',200)<>2 or
    public.cs_finish_gallery_settlement(o,false,q.generation,q.lease_token,snapshot) or
    public.cs_retry_gallery_settlement(o,false,q.generation,q.lease_token,'evidence_retry') then
  raise exception 'New refund did not invalidate stale lease'; end if;
 if public.cs_enqueue_gallery_settlement(o,false,'consigned','evt_refund_fixture',200)<>2 then
  raise exception 'Signed refund replay changed generation'; end if;
 begin
  perform public.cs_enqueue_gallery_settlement(o,false,'consigned','evt_refund_fixture',0);
  raise exception 'Conflicting event floor accepted';
 exception when others then
  if sqlerrm<>'Gallery settlement event already bound' then raise; end if;
 end;
 select * into strict q2 from public.cs_claim_gallery_settlement(false,3);
 begin
  perform public.cs_finish_gallery_settlement(o,false,q2.generation,q2.lease_token,snapshot);
  raise exception 'Snapshot behind refund floor accepted';
 exception when others then
  if sqlerrm<>'Invalid Gallery settlement refund total' then raise; end if;
 end;
 if not public.cs_retry_gallery_settlement(o,false,q2.generation,q2.lease_token,'evidence_retry') or
  exists(select 1 from public.cs_claim_gallery_settlement(false,3)) then raise exception 'Retry was not delayed'; end if;
end $fixture$;
reset role;
do $proof$
declare o uuid;
begin
 select id into strict o from public.orders where stripe_payment_intent_id='pi_test_consigned_private_fixture';
 if exists(select 1 from public.gallery_refund_receipts where order_id=o) or
   not exists(select 1 from public.gallery_settlement_queue_events where order_id=o and event_id='evt_refund_fixture' and signed_refund_floor_cents=200) or
   exists(select 1 from public.gallery_settlement_observations where order_id=o) or
   not exists(select 1 from public.gallery_settlement_queue where order_id=o and generation=2 and refund_floor_cents=200
    and state='queued' and attempts=1 and reason='evidence_retry' and due_at>clock_timestamp()) then
  raise exception 'Stale evidence or retry proof mismatch'; end if;
 update public.gallery_settlement_queue set due_at=clock_timestamp()-interval '1 second' where order_id=o;
end $proof$;
set role service_role;
do $success$
declare q record; intent constant text:='pi_test_consigned_private_fixture'; evidence jsonb;
begin
 select * into strict q from public.cs_claim_gallery_settlement(false,3);
 evidence:=jsonb_build_object('payment_intent_id',intent,'livemode',false,'sale_kind','consigned','currency','usd',
 'captured_cents',1249,'refunded_cents',200,'order_comparison',jsonb_build_object('attention','[]'::jsonb));
 -- The existing minimal identity-only JSON must not settle even at the correct refund floor.
 begin
  perform public.cs_finish_gallery_settlement(q.order_id,false,q.generation,q.lease_token,evidence);
  raise exception 'Sparse snapshot accepted';
 exception when others then
  if sqlerrm<>'Incomplete Gallery settlement evidence' then raise; end if;
 end;
 -- Synthetic complete provider-shaped evidence; not an actual provider response.
 evidence:=evidence||jsonb_build_object(
  'charge_id','ch_fixture','expected_original_fee_cents',124,
  'transfer_id','tr_fixture','transfer_cents',1249,'transfer_reversed_cents',200,
  'application_fee_id','fee_fixture','application_fee_cents',124,'application_fee_refunded_cents',19,
  'observed_artist_connect_allocation_cents',944,'observed_platform_application_fee_cents',105,
  'observed_charge_refund_balance_fee_cents',66,
  'charge_balance',jsonb_build_object('id','txn_charge_fixture','amount_cents',1249,'fee_cents',66,'net_cents',1183,'status','available'),
  'refunds',jsonb_build_array(jsonb_build_object('id','re_fixture','amount_cents',200,'status','succeeded',
   'balance',jsonb_build_object('id','txn_refund_fixture','amount_cents',-200,'fee_cents',0,'net_cents',-200,'status','available'))),
  'attention','[]'::jsonb,
  'order_comparison',jsonb_build_object('sale_kind','consigned','order_subtotal_cents',1249,'order_total_cents',1249,
   'expected_original_commission_cents',124,'expected_remaining_commission_cents',105,
   'expected_remaining_artist_cents',944,'observed_platform_after_charge_refund_fees_cents',39,'attention','[]'::jsonb));
 begin
  perform public.cs_finish_gallery_settlement(q.order_id,false,q.generation,q.lease_token,
   jsonb_set(evidence,'{transfer_reversed_cents}','0'::jsonb));
  raise exception 'Contradictory transfer evidence accepted';
 exception when others then
  if sqlerrm<>'Invalid Gallery consigned Connect evidence' then raise; end if;
 end;
 begin
  perform public.cs_finish_gallery_settlement(q.order_id,false,q.generation,q.lease_token,
   jsonb_set(evidence,'{observed_charge_refund_balance_fee_cents}','0'::jsonb));
  raise exception 'Contradictory processing fee accepted';
 exception when others then
  if sqlerrm<>'Invalid Gallery refund or processing fee total' then raise; end if;
 end;
 if not public.cs_finish_gallery_settlement(q.order_id,false,q.generation,q.lease_token,evidence) then
  raise exception 'Current lease did not complete'; end if;
 if public.cs_finish_gallery_settlement(q.order_id,false,q.generation,q.lease_token,evidence) then
  raise exception 'Completed lease was accepted again'; end if;
 if (select count(*) from public.gallery_settlement_observations s
     where s.order_id=q.order_id and s.provider_snapshot->'queue_generation'='2'::jsonb)<>1 then
  raise exception 'Current evidence not recorded exactly once'; end if;
 if public.cs_read_gallery_settlement(q.order_id,true) is not null or
    public.cs_read_gallery_settlement(q.order_id,null) is not null or
    public.cs_read_gallery_settlement(q.order_id,false)->>'state' is distinct from 'observed' or
    public.cs_read_gallery_settlement(q.order_id,false)->'evidence' is distinct from (evidence||jsonb_build_object('queue_generation',2)) then
  raise exception 'Mode-scoped report did not return accepted evidence'; end if;
 -- Even a later direct observation claiming the same generation is not accepted by the lease.
 insert into public.gallery_settlement_observations(order_id,stripe_payment_intent_id,provider_snapshot)
 values(q.order_id,intent,jsonb_set(evidence||jsonb_build_object('queue_generation',2),'{refunded_cents}','0'::jsonb));
 if public.cs_read_gallery_settlement(q.order_id,false)->'evidence' is distinct from (evidence||jsonb_build_object('queue_generation',2)) then
  raise exception 'Unaccepted later observation displaced accepted evidence'; end if;
end $success$;
reset role;
-- Force an expired final lease as disposable fixture clock control.
update public.gallery_settlement_queue set state='leased',attempts=5,lease_token=gen_random_uuid(),
  lease_expires_at=clock_timestamp()-interval '1 second'
where stripe_payment_intent_id='pi_test_consigned_private_fixture';
set role service_role;
select count(*) from public.cs_claim_gallery_settlement(false,3);
reset role;
do $terminal$
begin
 if not exists(select 1 from public.gallery_settlement_queue
    where stripe_payment_intent_id='pi_test_consigned_private_fixture' and state='review'
     and reason='attempt_limit' and lease_token is null) then raise exception 'Expired terminal claim not quarantined'; end if;
end $terminal$;

-- Exercise the existing fully refunded house order, not a consigned approximation.
set role service_role;
do $house_queue_acceptance$
declare o uuid; q record; ev jsonb;
begin
 select id into strict o from public.orders where stripe_payment_intent_id='pi_test_house';
 if public.cs_enqueue_gallery_settlement(o,false,'house','evt_house_refunded_fixture',1200)<>1 then
  raise exception 'House refund did not enqueue'; end if;
 select * into strict q from public.cs_claim_gallery_settlement(false,1);
 if q.order_id<>o then raise exception 'House lease identity mismatch'; end if;
 ev:=jsonb_build_object('payment_intent_id','pi_test_house','livemode',false,'sale_kind','house','currency','usd',
  'captured_cents',1200,'refunded_cents',1200,'charge_id','ch_house_fixture','expected_original_fee_cents',null,
  'transfer_id',null,'transfer_cents',null,'transfer_reversed_cents',null,
  'application_fee_id',null,'application_fee_cents',null,'application_fee_refunded_cents',null,
  'observed_artist_connect_allocation_cents',null,'observed_platform_application_fee_cents',null,
  'observed_charge_refund_balance_fee_cents',65,
  'charge_balance',jsonb_build_object('id','txn_house_fixture','amount_cents',1200,'fee_cents',65,'net_cents',1135,'status','available'),
  'refunds',jsonb_build_array(jsonb_build_object('id','re_house_fixture','amount_cents',1200,'status','succeeded',
   'balance',jsonb_build_object('id','txn_house_refund_fixture','amount_cents',-1200,'fee_cents',0,'net_cents',-1200,'status','available'))),
  'attention','[]'::jsonb,
  'order_comparison',jsonb_build_object('sale_kind','house','order_subtotal_cents',1200,'order_total_cents',1200,
   'expected_original_commission_cents',0,'expected_remaining_commission_cents',0,
   'expected_remaining_artist_cents',0,'observed_platform_after_charge_refund_fees_cents',-65,'attention','[]'::jsonb));
 begin
  perform public.cs_finish_gallery_settlement(o,false,q.generation,q.lease_token,jsonb_set(ev,'{transfer_cents}','0'::jsonb));
  raise exception 'House accepted non-null Connect evidence';
 exception when others then
  if sqlerrm<>'Unexpected Gallery house Connect evidence' then raise; end if;
 end;
 begin
  perform public.cs_finish_gallery_settlement(o,false,q.generation,q.lease_token,jsonb_set(ev,'{order_comparison,observed_platform_after_charge_refund_fees_cents}','0'::jsonb));
  raise exception 'House accepted understated processing loss';
 exception when others then
  if sqlerrm<>'Invalid Gallery order settlement comparison' then raise; end if;
 end;
 if not public.cs_finish_gallery_settlement(o,false,q.generation,q.lease_token,ev) then
  raise exception 'House complete evidence not accepted'; end if;
 if public.cs_enqueue_gallery_settlement(o,false,'house','evt_house_review_fixture',1200)<>2 then
  raise exception 'House new event did not invalidate old evidence'; end if;
 if public.cs_read_gallery_settlement(o,false)->>'state' is distinct from 'queued' or
    public.cs_read_gallery_settlement(o,false)->'evidence' is distinct from 'null'::jsonb then
  raise exception 'Queued generation exposed stale settled evidence'; end if;
 select * into strict q from public.cs_claim_gallery_settlement(false,1);
 ev:=jsonb_set(ev,'{attention}','["balance_transactions_incomplete"]'::jsonb);
 ev:=jsonb_set(ev,'{charge_balance}','null'::jsonb);
 ev:=jsonb_set(ev,'{observed_charge_refund_balance_fee_cents}','null'::jsonb);
 ev:=jsonb_set(ev,'{order_comparison,observed_platform_after_charge_refund_fees_cents}','null'::jsonb);
 if not public.cs_finish_gallery_settlement(o,false,q.generation,q.lease_token,ev) then
  raise exception 'House incomplete evidence not retained for review'; end if;
 if public.cs_read_gallery_settlement(o,false)->>'state' is distinct from 'review' or
    public.cs_read_gallery_settlement(o,false)->'evidence' is distinct from 'null'::jsonb then
  raise exception 'Review evidence exposed as settled'; end if;
end $house_queue_acceptance$;
reset role;
do $house_queue_state$
declare o uuid;
begin
 select id into strict o from public.orders where stripe_payment_intent_id='pi_test_house';
 if not exists(select 1 from public.gallery_settlement_queue where order_id=o and generation=2
   and refund_floor_cents=1200 and state='review' and reason='invalid_evidence')
  or (select count(*) from public.gallery_settlement_observations where order_id=o
     and provider_snapshot->>'queue_generation' in ('1','2'))<>2 then
  raise exception 'House review generation or retained evidence mismatch'; end if;
end $house_queue_state$;

-- Fresh independent transactions, synthetic Stripe identities, both sale kinds.
grant update on public.orders to service_role;
insert into public.products(id,kind,status,stock_count,artist_id,title,price_cents,currency)
values('00000000-0000-4000-8000-000000000085','digital','published',1,'00000000-0000-4000-8000-000000000080','Atomic consigned fixture',1249,'usd'),
 ('00000000-0000-4000-8000-000000000087','digital','published',1,'00000000-0000-4000-8000-000000000080','Atomic house fixture',1200,'usd');
insert into public.gallery_approved_assets(id,product_id,object_path,sha256,approved_by)
values('00000000-0000-4000-8000-000000000086','00000000-0000-4000-8000-000000000085','00000000-0000-4000-8000-000000000085/fixture.bin',repeat('1',64),'00000000-0000-4000-8000-000000000080'),
 ('00000000-0000-4000-8000-000000000088','00000000-0000-4000-8000-000000000087','00000000-0000-4000-8000-000000000087/fixture.bin',repeat('2',64),'00000000-0000-4000-8000-000000000080');
insert into storage.objects values('gallery-approved','00000000-0000-4000-8000-000000000085/fixture.bin'),
 ('gallery-approved','00000000-0000-4000-8000-000000000087/fixture.bin');
do $atomic_permissions$
begin
 if has_function_privilege('anon','public.cs_record_gallery_payment_with_settlement(uuid,uuid,uuid,uuid,integer,jsonb,boolean,text,text)','EXECUTE')
 or has_function_privilege('authenticated','public.cs_record_gallery_refund_event_with_settlement(uuid,boolean,text,text,text,text,bigint,bigint,boolean)','EXECUTE')
 then raise exception 'Atomic event wrapper exposed'; end if;
end $atomic_permissions$;
set role service_role;
do $atomic_event$
declare ar uuid='00000000-0000-4000-8000-000000000080'; buyer uuid='00000000-0000-4000-8000-000000000083';
 p uuid; edition uuid; h uuid; r jsonb; o uuid; receipt jsonb; pi text; k text; total integer; g bigint;
begin
 for k,p,edition,total in select * from (values
 ('consigned','00000000-0000-4000-8000-000000000085'::uuid,'00000000-0000-4000-8000-000000000086'::uuid,1249),
 ('house','00000000-0000-4000-8000-000000000087'::uuid,'00000000-0000-4000-8000-000000000088'::uuid,1200)) as x(kind,product,asset,amount)
 loop
  pi:='pi_test_atomic_'||k;
  h:=public.cs_hold_gallery_inventory(p,buyer,1);
  if h is null then raise exception 'Atomic fixture hold unavailable'; end if;
  if k='consigned' and not public.cs_pin_consigned_private_gallery_hold(h,p,ar,edition,buyer,'acct_ConsignedFixture',total,'usd')
  then raise exception 'Atomic fixture pin unavailable'; end if;
  update public.gallery_inventory_holds set stripe_session_id='cs_test_atomic_'||k where id=h;
  receipt:=jsonb_build_object('session_id','cs_test_atomic_'||k,'payment_intent_id',pi,'payment_status','paid',
   'user_id',buyer,'subtotal_cents',total,'total_cents',total,'currency','usd',
   'application_fee_cents',case when k='house' then 0 else total/10 end);
  if k='consigned' then receipt:=receipt||jsonb_build_object('transfer_destination','acct_ConsignedFixture'); end if;
  begin
   perform public.cs_record_gallery_payment_with_settlement(h,edition,p,ar,1,receipt,false,k,'evt_paid_fixture');
   raise exception 'Conflicting queue event allowed a paid mutation';
  exception when others then
   if sqlerrm<>'Gallery settlement event already bound' then raise; end if;
  end;
  if exists(select 1 from public.orders where stripe_payment_intent_id=pi)
   or exists(select 1 from public.gallery_private_deliveries where product_id=p)
   or (select stock_count from public.products where id=p)<>1
   or (select state from public.gallery_inventory_holds where id=h)<>'held'
  then raise exception 'Failed enqueue leaked paid order, entitlement or stock mutation'; end if;
  r:=public.cs_record_gallery_payment_with_settlement(h,edition,p,ar,1,receipt,false,k,'evt_atomic_paid_'||k);
  o:=(r->>'id')::uuid;
  if r->>'created' is distinct from 'true' or r->>'settlement_generation' is distinct from '1'
  then raise exception 'Atomic payment not recorded'; end if;
  r:=public.cs_record_gallery_payment_with_settlement(h,edition,p,ar,1,receipt,false,k,'evt_atomic_paid_'||k);
  if r is distinct from jsonb_build_object('id',o,'created',false,'settlement_generation',1)
  then raise exception 'Atomic payment replay mismatch'; end if;
  g:=public.cs_record_gallery_refund_event_with_settlement(o,false,k,'evt_atomic_partial_'||k,pi,'usd',total,200,false);
  if g<>2 or (select fulfillment_state from public.orders where id=o)='refunded'
  then raise exception 'Partial refund incorrectly revoked access'; end if;
  begin
   perform public.cs_record_gallery_refund_event_with_settlement(o,false,k,'evt_atomic_paid_'||k,pi,'usd',total,total,true);
   raise exception 'Conflicting refund event accepted';
  exception when others then
   if sqlerrm<>'Gallery settlement event already bound' then raise; end if;
  end;
  if (select fulfillment_state from public.orders where id=o)='refunded'
   or exists(select 1 from public.gallery_restock_reviews where order_id=o)
  then raise exception 'Conflicting refund leaked mutation'; end if;
  g:=public.cs_record_gallery_refund_event_with_settlement(o,false,k,'evt_atomic_full_'||k,pi,'usd',total,total,true);
  if g<>3 then raise exception 'Full refund generation mismatch'; end if;
  g:=public.cs_record_gallery_refund_event_with_settlement(o,false,k,'evt_atomic_full_'||k,pi,'usd',total,total,true);
  if g<>3 then raise exception 'Full refund replay changed generation'; end if;
  g:=public.cs_record_gallery_refund_event_with_settlement(o,false,k,'evt_atomic_partial_'||k,pi,'usd',total,200,false);
  if g<>3 or (select fulfillment_state from public.orders where id=o)<>'refunded'
   or public.cs_authorize_gallery_delivery(o)
   or (select stock_count from public.products where id=p)<>0
   or not exists(select 1 from public.gallery_restock_reviews where order_id=o and state='pending')
  then raise exception 'Refund revocation or review-only restock failed'; end if;
 end loop;
end $atomic_event$;
reset role;
do $atomic_event_proof$
begin
 if (select count(*) from public.gallery_settlement_queue
  where stripe_payment_intent_id in ('pi_test_atomic_house','pi_test_atomic_consigned')
  and generation=3 and refund_floor_cents=captured_cents and state='queued')<>2
 then raise exception 'Atomic refund floor was not preserved'; end if;
end $atomic_event_proof$;

SQL
echo 'PASS: Gallery settlement queue transaction rollback, dedupe, scope, stale refund/lease rejection, delay, idempotency and terminal review.'
