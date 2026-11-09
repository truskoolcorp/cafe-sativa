begin;
update public.cs_character_promo_drafts set voice_approved_at=null,video_qa_approved_at=null,publication_approved_at=null;
update public.cs_character_promo_delivery_plans set status='blocked_assets';
create function public.gate_expected() returns jsonb language sql as $$
select jsonb_build_object('draftRevision',d.updated_at,'voiceApprovedAt',d.voice_approved_at,'videoApprovedAt',d.video_qa_approved_at,'publicationApprovedAt',d.publication_approved_at,'planStatus',p.status,'generationId',(select generation_id from cs_promo_private.review_heads where plan_id=p.id)) from public.cs_character_promo_drafts d join public.cs_character_promo_delivery_plans p on p.promo_id=d.id where p.id='00000000-0000-0000-0000-000000000020'
$$;
create table public.gate_content as select s-array['approvals','draftRevision'] c from fixture_snapshot;
create table public.saved_state(expected jsonb);
insert into saved_state select public.gate_expected();
select public.assert_ok(public.cs_read_character_promo_gates('00000000-0000-0000-0000-000000000020')='{"generationId":null,"invalidated":false,"gates":[],"hasSharedAttempt":false,"pendingSiblingGatePlans":0,"pendingSiblingDeliveryApprovals":0,"ownDeliveryApprovalCurrent":false}'::jsonb,'no generation inferred');
select public.assert_ok(public.cs_confirm_character_promo_gate('00000000-0000-0000-0000-000000000020',c,repeat('c',64),public.gate_expected(),'voice','00000000-0000-0000-0000-000000000001') is null,'explicit begin required') from gate_content;
select public.assert_ok(public.cs_begin_character_promo_review('00000000-0000-0000-0000-000000000020',c,repeat('c',64),public.gate_expected(),'00000000-0000-0000-0000-000000000001')->>'generationId' is not null,'explicit begin') from gate_content;
select public.assert_ok(public.cs_confirm_character_promo_gate('00000000-0000-0000-0000-000000000020',c,repeat('c',64),expected,'voice','00000000-0000-0000-0000-000000000001') is null,'old generation token rejected') from gate_content cross join saved_state;
select public.assert_ok(public.cs_confirm_character_promo_gate('00000000-0000-0000-0000-000000000020',c,repeat('c',64),public.gate_expected(),'publication','00000000-0000-0000-0000-000000000001') is null,'publication cannot infer prior gates') from gate_content;
select public.assert_ok(public.cs_confirm_character_promo_gate('00000000-0000-0000-0000-000000000020',c,repeat('c',64),public.gate_expected(),'voice','00000000-0000-0000-0000-000000000001')->>'gate'='voice','voice exact confirmation') from gate_content;
select public.assert_ok((select voice_approved_at is not null and video_qa_approved_at is null and publication_approved_at is null from public.cs_character_promo_drafts),'voice changes only own gate');
select public.assert_ok((select status='blocked_assets' from public.cs_character_promo_delivery_plans),'voice does not ready plan');
select public.assert_ok(public.cs_confirm_character_promo_gate('00000000-0000-0000-0000-000000000020',c,repeat('c',64),public.gate_expected(),'voice','00000000-0000-0000-0000-000000000001') is null,'duplicate gate cannot overwrite') from gate_content;
select public.assert_ok(public.cs_confirm_character_promo_gate('00000000-0000-0000-0000-000000000020',c,repeat('c',64),public.gate_expected(),'video','00000000-0000-0000-0000-000000000001')->>'gate'='video','video exact confirmation') from gate_content;
select public.assert_ok(public.cs_confirm_character_promo_gate('00000000-0000-0000-0000-000000000020',c,repeat('c',64),public.gate_expected(),'publication','00000000-0000-0000-0000-000000000001')->>'gate'='publication','publication exact confirmation') from gate_content;
select public.assert_ok((select count(*)=3 from cs_promo_private.gates where not invalidated and draft_applied and plan_applied),'three durable gates');
select public.assert_ok((select status='ready_for_delivery' from public.cs_character_promo_delivery_plans),'publication sets ready');
create function public.execution_snapshot() returns jsonb language sql as $$
select c||jsonb_build_object('draftRevision',d.updated_at,'approvals',jsonb_build_object('voice',d.voice_approved_at,'video',d.video_qa_approved_at,'publication',d.publication_approved_at)) from gate_content cross join public.cs_character_promo_drafts d
$$;
select public.assert_ok(public.cs_approve_character_promo('00000000-0000-0000-0000-000000000020',repeat('d',64),public.execution_snapshot(),clock_timestamp(),'00000000-0000-0000-0000-000000000001'),'separate delivery confirmation');
create table public.old_evidence as select to_jsonb(a) a from cs_promo_private.approvals a;
update saved_state set expected=public.gate_expected();
-- Explicit replacement archives prior immutable final approval and starts empty, even
-- when legacy stamps remain. This is not an attempt reset and never calls a provider.
select public.assert_ok(public.cs_begin_character_promo_review('00000000-0000-0000-0000-000000000020',c,repeat('c',64),public.gate_expected(),'00000000-0000-0000-0000-000000000001')->'gates'='[]'::jsonb,'explicit replacement starts no gates') from gate_content;
select public.assert_ok((select count(*)=1 from cs_promo_private.approval_history h join old_evidence o on h.approval=o.a),'exact old approval archived');
select public.assert_ok((select count(*)=3 from cs_promo_private.gates),'old gate evidence preserved');
select public.assert_ok(not public.cs_approve_character_promo('00000000-0000-0000-0000-000000000020',repeat('d',64),public.execution_snapshot(),clock_timestamp(),'00000000-0000-0000-0000-000000000001'),'legacy stamps cannot bypass new generation');
select public.assert_ok(public.cs_confirm_character_promo_gate('00000000-0000-0000-0000-000000000020',c,repeat('c',64),expected,'voice','00000000-0000-0000-0000-000000000001') is null,'old displayed generation cannot transfer consent') from gate_content cross join saved_state;
update public.cs_character_promo_drafts set spoken_script='edited';
update public.cs_character_promo_drafts set spoken_script='Exact approved words';
select public.assert_ok((public.cs_read_character_promo_gates('00000000-0000-0000-0000-000000000020')->>'invalidated')::boolean,'edit revert remains invalidated');
select public.assert_ok(public.cs_confirm_character_promo_gate('00000000-0000-0000-0000-000000000020',c,repeat('c',64),public.gate_expected(),'voice','00000000-0000-0000-0000-000000000001') is null,'invalid generation cannot confirm') from gate_content;
select public.assert_ok(public.cs_begin_character_promo_review('00000000-0000-0000-0000-000000000020',c,repeat('c',64),public.gate_expected(),'00000000-0000-0000-0000-000000000001')->>'generationId' is not null,'explicit recovery starts fresh version') from gate_content;
select public.assert_ok(public.cs_confirm_character_promo_gate('00000000-0000-0000-0000-000000000020',c,repeat('c',64),public.gate_expected(),'voice','00000000-0000-0000-0000-000000000001') is not null,'reconfirm voice') from gate_content;
select public.assert_ok(public.cs_confirm_character_promo_gate('00000000-0000-0000-0000-000000000020',c,repeat('c',64),public.gate_expected(),'video','00000000-0000-0000-0000-000000000001') is not null,'reconfirm video') from gate_content;
select public.assert_ok(public.cs_confirm_character_promo_gate('00000000-0000-0000-0000-000000000020',c,repeat('c',64),public.gate_expected(),'publication','00000000-0000-0000-0000-000000000001') is not null,'reconfirm publication') from gate_content;
select public.assert_ok(public.cs_approve_character_promo('00000000-0000-0000-0000-000000000020',repeat('e',64),public.execution_snapshot(),clock_timestamp(),'00000000-0000-0000-0000-000000000001'),'reconfirmed exact final approval');
select public.assert_ok(public.cs_claim_character_promo('00000000-0000-0000-0000-000000000020',repeat('e',64),public.execution_snapshot()) is not null,'one actual durable claim');
select public.assert_ok(public.cs_begin_character_promo_review('00000000-0000-0000-0000-000000000020',c,repeat('c',64),public.gate_expected(),'00000000-0000-0000-0000-000000000001') is null,'claimed review can never reset') from gate_content;
select public.assert_ok((select count(*)=1 from cs_promo_private.attempts),'attempt preserved');
select public.assert_ok(not has_function_privilege('authenticated','public.cs_begin_character_promo_review(uuid,jsonb,text,jsonb,uuid)','EXECUTE'),'browser cannot start generation');
select public.assert_ok(not has_table_privilege('service_role','cs_promo_private.gates','INSERT'),'service cannot forge pending gate bypass');
commit;
