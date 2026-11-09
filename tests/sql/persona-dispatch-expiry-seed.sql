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
update public.cs_character_promo_delivery_plans set scheduled_at=date_trunc('second',clock_timestamp())+interval '65 seconds' where id='00000000-0000-0000-0000-000000000020';
update public.cs_character_promo_delivery_plans set scheduled_at=date_trunc('second',scheduled_at);
select public.assert_ok(public.cs_begin_character_promo_review(id,public.content_for(id),repeat('c',64),public.expected_for(id),'00000000-0000-0000-0000-000000000001') is not null,'each plan explicitly begins') from public.cs_character_promo_delivery_plans;
do $$ declare gate text; p uuid; begin
 foreach gate in array array['voice','video','publication'] loop
  foreach p in array array['00000000-0000-0000-0000-000000000020'::uuid,'00000000-0000-0000-0000-000000000021'::uuid] loop
   perform public.assert_ok(public.cs_confirm_character_promo_gate(p,public.content_for(p),repeat('c',64),public.expected_for(p),gate,'00000000-0000-0000-0000-000000000001') is not null,'independent fixture gate');
  end loop;
 end loop;
end $$;
select public.assert_ok(public.cs_approve_character_promo(id,repeat('d',64),public.execution_for(id),clock_timestamp(),'00000000-0000-0000-0000-000000000001'),'independent fixture final approval') from public.cs_character_promo_delivery_plans;
commit;
