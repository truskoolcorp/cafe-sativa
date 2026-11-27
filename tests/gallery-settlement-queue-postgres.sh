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
SQL
echo 'PASS: Gallery settlement queue transaction rollback, dedupe, scope, stale refund/lease rejection, delay, idempotency and terminal review.'
