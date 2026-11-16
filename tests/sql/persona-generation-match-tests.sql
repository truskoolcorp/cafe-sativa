begin;
update public.cs_character_promo_drafts set voice_approved_at=null,video_qa_approved_at=null,publication_approved_at=null;
update public.cs_character_promo_delivery_plans set status='blocked_assets';
insert into public.cs_character_promo_delivery_plans(id,promo_id,character_id,network,account_id,scheduled_at,status,caption)
select '00000000-0000-0000-0000-000000000021',promo_id,character_id,'facebook','146219355471397',scheduled_at,'blocked_assets','Facebook exact caption' from public.cs_character_promo_delivery_plans where id='00000000-0000-0000-0000-000000000020';
create function public.content_for(plan uuid) returns jsonb language sql as $$
select (s-array['approvals','draftRevision'])||jsonb_build_object('planId',p.id,'network',p.network,'accountId',p.account_id,'caption',p.caption,'scheduledAt',p.scheduled_at) from fixture_snapshot cross join public.cs_character_promo_delivery_plans p where p.id=plan
$$;
create function public.expected_for(plan uuid) returns jsonb language sql as $$
select jsonb_build_object('draftRevision',d.updated_at,'voiceApprovedAt',d.voice_approved_at,'videoApprovedAt',d.video_qa_approved_at,'publicationApprovedAt',d.publication_approved_at,'planStatus',p.status,'generationId',(select generation_id from cs_promo_private.review_heads where plan_id=p.id)) from public.cs_character_promo_drafts d join public.cs_character_promo_delivery_plans p on p.promo_id=d.id where p.id=plan
$$;
create function public.execution_for(plan uuid) returns jsonb language sql as $$
select public.content_for(plan)||jsonb_build_object('draftRevision',d.updated_at,'approvals',jsonb_build_object('voice',d.voice_approved_at,'video',d.video_qa_approved_at,'publication',d.publication_approved_at)) from public.cs_character_promo_drafts d join public.cs_character_promo_delivery_plans p on p.promo_id=d.id where p.id=plan
$$;
commit;
begin;
do $$ declare p uuid:='00000000-0000-0000-0000-000000000020'; actor uuid:='00000000-0000-0000-0000-000000000001'; prior jsonb; replaced jsonb; changed jsonb; begin
 perform public.assert_ok(public.cs_read_character_promo_gates(p)->'generationContentDigest'='null'::jsonb,'no generation has null digest');
 prior:=public.cs_begin_character_promo_review(p,public.content_for(p),repeat('c',64),public.expected_for(p),actor);
 perform public.assert_ok(prior->>'generationContentDigest'=repeat('c',64) and prior->'gates'='[]'::jsonb,'begin exposes digest before any gate');
 changed:=jsonb_set(public.content_for(p),'{canon,revisionSha256}',to_jsonb(repeat('f',64)));
 perform public.assert_ok(public.cs_confirm_character_promo_gate(p,changed,repeat('f',64),public.expected_for(p),'voice',actor) is null,'canon drift refuses first voice');
 perform public.assert_ok(public.cs_read_character_promo_gates(p)->>'generationContentDigest'=repeat('c',64),'read still exposes original content digest');
 perform public.assert_ok((select count(*)=0 from cs_promo_private.gates),'failed drift creates no gate');
 replaced:=public.cs_begin_character_promo_review(p,changed,repeat('f',64),public.expected_for(p),actor);
 perform public.assert_ok(replaced->>'generationId'<>prior->>'generationId' and replaced->>'generationContentDigest'=repeat('f',64) and replaced->'gates'='[]'::jsonb,'explicit replacement exposes new digest and zero gates');
 perform public.assert_ok((select count(*)=2 from cs_promo_private.review_versions where plan_id=p),'original generation preserved');
 perform public.assert_ok(public.cs_confirm_character_promo_gate(p,changed,repeat('f',64),public.expected_for(p),'voice',actor) is not null,'fresh explicit voice succeeds');
 perform public.assert_ok(public.cs_read_character_promo_gates(p)->>'generationContentDigest'=repeat('f',64),'confirmed generation digest remains new');
end $$;
select public.assert_ok((select count(*)=1 from cs_promo_private.gates),'one explicit voice gate after canon replacement');
rollback;
begin;
do $$ declare p uuid:='00000000-0000-0000-0000-000000000020'; actor uuid:='00000000-0000-0000-0000-000000000001'; prior jsonb; replaced jsonb; changed jsonb; begin
 perform public.assert_ok(public.cs_read_character_promo_gates(p)->'generationContentDigest'='null'::jsonb,'no generation has null digest');
 prior:=public.cs_begin_character_promo_review(p,public.content_for(p),repeat('c',64),public.expected_for(p),actor);
 perform public.assert_ok(prior->>'generationContentDigest'=repeat('c',64) and prior->'gates'='[]'::jsonb,'begin exposes digest before any gate');
 changed:=jsonb_set(public.content_for(p),'{timezone}','"America/Chicago"'::jsonb);
 perform public.assert_ok(public.cs_confirm_character_promo_gate(p,changed,repeat('f',64),public.expected_for(p),'voice',actor) is null,'timezone drift refuses first voice');
 perform public.assert_ok(public.cs_read_character_promo_gates(p)->>'generationContentDigest'=repeat('c',64),'read still exposes original content digest');
 perform public.assert_ok((select count(*)=0 from cs_promo_private.gates),'failed drift creates no gate');
 replaced:=public.cs_begin_character_promo_review(p,changed,repeat('f',64),public.expected_for(p),actor);
 perform public.assert_ok(replaced->>'generationId'<>prior->>'generationId' and replaced->>'generationContentDigest'=repeat('f',64) and replaced->'gates'='[]'::jsonb,'explicit replacement exposes new digest and zero gates');
 perform public.assert_ok((select count(*)=2 from cs_promo_private.review_versions where plan_id=p),'original generation preserved');
 perform public.assert_ok(public.cs_confirm_character_promo_gate(p,changed,repeat('f',64),public.expected_for(p),'voice',actor) is not null,'fresh explicit voice succeeds');
 perform public.assert_ok(public.cs_read_character_promo_gates(p)->>'generationContentDigest'=repeat('f',64),'confirmed generation digest remains new');
end $$;
select public.assert_ok((select count(*)=1 from cs_promo_private.gates),'one explicit voice gate after timezone replacement');
rollback;
