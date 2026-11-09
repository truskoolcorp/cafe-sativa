begin;
update public.cs_character_promo_drafts set voice_approved_at=null,video_qa_approved_at=null,publication_approved_at=null;
update public.cs_character_promo_delivery_plans set status='blocked_assets';
insert into public.cs_character_promo_delivery_plans(id,promo_id,character_id,network,account_id,scheduled_at,status,caption)
select '00000000-0000-0000-0000-000000000021',promo_id,character_id,'facebook','146219355471397',scheduled_at,'blocked_assets','Facebook exact caption' from public.cs_character_promo_delivery_plans where id='00000000-0000-0000-0000-000000000020';
-- Genuine wall-clock expiry below: target1 starts just outside the 60-second margin.
update public.cs_character_promo_delivery_plans set scheduled_at=clock_timestamp()+interval '61 seconds' where id='00000000-0000-0000-0000-000000000020';
create function public.content_for(plan uuid) returns jsonb language sql as $$
select (s-array['approvals','draftRevision'])||jsonb_build_object('planId',p.id,'network',p.network,'accountId',p.account_id,'caption',p.caption,'scheduledAt',p.scheduled_at) from fixture_snapshot cross join public.cs_character_promo_delivery_plans p where p.id=plan
$$;
create function public.expected_for(plan uuid) returns jsonb language sql as $$
select jsonb_build_object('draftRevision',d.updated_at,'voiceApprovedAt',d.voice_approved_at,'videoApprovedAt',d.video_qa_approved_at,'publicationApprovedAt',d.publication_approved_at,'planStatus',p.status,'generationId',(select generation_id from cs_promo_private.review_heads where plan_id=p.id)) from public.cs_character_promo_drafts d join public.cs_character_promo_delivery_plans p on p.promo_id=d.id where p.id=plan
$$;
create function public.execution_for(plan uuid) returns jsonb language sql as $$
select public.content_for(plan)||jsonb_build_object('draftRevision',d.updated_at,'approvals',jsonb_build_object('voice',d.voice_approved_at,'video',d.video_qa_approved_at,'publication',d.publication_approved_at)) from public.cs_character_promo_drafts d join public.cs_character_promo_delivery_plans p on p.promo_id=d.id where p.id=plan
$$;
select public.assert_ok(public.cs_begin_character_promo_review(id,public.content_for(id),repeat('c',64),public.expected_for(id),'00000000-0000-0000-0000-000000000001') is not null,'each plan explicitly begins') from public.cs_character_promo_delivery_plans;
-- Fully confirm first plan and its delivery, then interleave second plan. A fresh
-- explicit delivery confirmation refreshes the stale first approval without gate resets.
do $$ declare gate text; begin
 foreach gate in array array['voice','video','publication'] loop
  perform public.assert_ok(public.cs_confirm_character_promo_gate('00000000-0000-0000-0000-000000000020',public.content_for('00000000-0000-0000-0000-000000000020'),repeat('c',64),public.expected_for('00000000-0000-0000-0000-000000000020'),gate,'00000000-0000-0000-0000-000000000001') is not null,'first independent gate '||gate);
 end loop;
end $$;
select public.assert_ok(public.cs_approve_character_promo('00000000-0000-0000-0000-000000000020',repeat('d',64),public.execution_for('00000000-0000-0000-0000-000000000020'),clock_timestamp(),'00000000-0000-0000-0000-000000000001'),'first final confirmation before sibling review');
select public.assert_ok(public.cs_claim_character_promo('00000000-0000-0000-0000-000000000020',repeat('d',64),public.execution_for('00000000-0000-0000-0000-000000000020')) is null,'unfinished sibling blocks first claim');
select public.assert_ok((public.cs_read_character_promo_gates('00000000-0000-0000-0000-000000000020')->>'pendingSiblingGatePlans')::int=1,'pending sibling gate work disclosed');
create table public.first_approval as select to_jsonb(a) a from cs_promo_private.approvals a;
do $$ declare gate text; begin
 foreach gate in array array['voice','video','publication'] loop
  perform public.assert_ok(public.cs_confirm_character_promo_gate('00000000-0000-0000-0000-000000000021',public.content_for('00000000-0000-0000-0000-000000000021'),repeat('c',64),public.expected_for('00000000-0000-0000-0000-000000000021'),gate,'00000000-0000-0000-0000-000000000001') is not null,'second independent gate '||gate);
  perform public.assert_ok(cs_promo_private.gate_valid('00000000-0000-0000-0000-000000000020',gate,public.content_for('00000000-0000-0000-0000-000000000020'),repeat('c',64)),'second plan did not invalidate first gate');
 end loop;
end $$;
select public.assert_ok(public.cs_read_character_promo_approval('00000000-0000-0000-0000-000000000020') is null,'first final snapshot correctly stale');
select public.assert_ok((select count(*)=6 from cs_promo_private.gates where not invalidated),'six independently scoped gate records');
select public.assert_ok(public.cs_approve_character_promo(id,repeat('d',64),public.execution_for(id),clock_timestamp(),'00000000-0000-0000-0000-000000000001'),'independent final delivery approval') from public.cs_character_promo_delivery_plans;
select public.assert_ok((select count(*)=2 from cs_promo_private.approvals where not invalidated),'two independent final approvals');
select public.assert_ok((select count(*)=1 from cs_promo_private.approval_history h join first_approval f on h.approval-'invalidated'=f.a-'invalidated'),'stale final evidence archived exactly except explicit invalidation flag');
select public.assert_ok((select count(*)=6 from cs_promo_private.gates),'refresh did not reset or rewrite gates');
select public.assert_ok(public.cs_claim_character_promo('00000000-0000-0000-0000-000000000020',repeat('d',64),public.execution_for('00000000-0000-0000-0000-000000000020')) is not null,'first plan claims');
select public.assert_ok(public.cs_begin_character_promo_review('00000000-0000-0000-0000-000000000021',public.content_for('00000000-0000-0000-0000-000000000021'),repeat('c',64),public.expected_for('00000000-0000-0000-0000-000000000021'),'00000000-0000-0000-0000-000000000001') is null,'sibling cannot replace after shared attempt');
select public.assert_ok(public.cs_confirm_character_promo_gate('00000000-0000-0000-0000-000000000021',public.content_for('00000000-0000-0000-0000-000000000021'),repeat('c',64),public.expected_for('00000000-0000-0000-0000-000000000021'),'voice','00000000-0000-0000-0000-000000000001') is null,'sibling cannot modify gates after shared attempt');
select public.assert_ok(public.cs_finish_character_promo(plan_id,token,'submission_unknown',null),'first uncertain outcome permanently held') from cs_promo_private.attempts where plan_id='00000000-0000-0000-0000-000000000020';
select pg_sleep(62);
select public.assert_ok((select scheduled_at<clock_timestamp() from public.cs_character_promo_delivery_plans where id='00000000-0000-0000-0000-000000000020'),'first attempted slot actually passed');
select public.assert_ok(not cs_promo_private.plan_delivery_ready('00000000-0000-0000-0000-000000000020'),'expired sibling no longer schedulable');
select public.assert_ok((public.cs_read_character_promo_gates('00000000-0000-0000-0000-000000000021')->>'pendingSiblingDeliveryApprovals')::int=0,'already-attempted expired sibling not pending work');
select public.assert_ok(public.cs_claim_character_promo('00000000-0000-0000-0000-000000000020',repeat('d',64),public.execution_for('00000000-0000-0000-0000-000000000020')) is null,'unknown expired attempt is never retried');
select public.assert_ok(public.cs_claim_character_promo('00000000-0000-0000-0000-000000000021',repeat('d',64),public.execution_for('00000000-0000-0000-0000-000000000021')) is not null,'already-approved sibling may independently claim unchanged bytes');
select public.assert_ok((select count(*)=2 from cs_promo_private.attempts),'both unique attempts persist');
commit;
