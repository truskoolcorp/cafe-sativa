begin;
update public.cs_character_promo_drafts set voice_approved_at=null,video_qa_approved_at=null,publication_approved_at=null;
update public.cs_character_promo_delivery_plans set status='blocked_assets';
create function public.gate_expected() returns jsonb language sql as $$
select jsonb_build_object('draftRevision',d.updated_at,'voiceApprovedAt',d.voice_approved_at,'videoApprovedAt',d.video_qa_approved_at,'publicationApprovedAt',d.publication_approved_at,'planStatus',p.status,'generationId',(select generation_id from cs_promo_private.review_heads where plan_id=p.id)) from public.cs_character_promo_drafts d join public.cs_character_promo_delivery_plans p on p.promo_id=d.id where p.id='00000000-0000-0000-0000-000000000020'
$$;
create table public.gate_content as select s-array['approvals','draftRevision'] c from fixture_snapshot;
create table public.saved_state(expected jsonb);
insert into saved_state select public.gate_expected();
select public.cs_begin_character_promo_review('00000000-0000-0000-0000-000000000020',c,repeat('c',64),public.gate_expected(),'00000000-0000-0000-0000-000000000001') from gate_content;
commit;
