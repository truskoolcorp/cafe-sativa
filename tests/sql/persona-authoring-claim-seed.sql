-- Synthetic fixture: establish genuine gate and final-approval evidence before races.
begin;
create function public.authoring_gate_expected() returns jsonb language sql as $$
 select jsonb_build_object('draftRevision',d.updated_at,'voiceApprovedAt',d.voice_approved_at,'videoApprovedAt',d.video_qa_approved_at,'publicationApprovedAt',d.publication_approved_at,'planStatus',p.status,'generationId',(select generation_id from cs_promo_private.review_heads where plan_id=p.id)) from public.cs_character_promo_drafts d join public.cs_character_promo_delivery_plans p on p.promo_id=d.id
$$;
create table public.authoring_gate_content as select s-array['approvals','draftRevision'] c from fixture_snapshot;
select assert_ok(public.cs_begin_character_promo_review('00000000-0000-0000-0000-000000000020',c,repeat('c',64),authoring_gate_expected(),'00000000-0000-0000-0000-000000000001') is not null,'genuine generation') from authoring_gate_content;
do $$ declare g text; begin
 foreach g in array array['voice','video','publication'] loop
  perform assert_ok(public.cs_confirm_character_promo_gate('00000000-0000-0000-0000-000000000020',c,repeat('c',64),authoring_gate_expected(),g,'00000000-0000-0000-0000-000000000001') is not null,'genuine gate '||g) from authoring_gate_content;
 end loop;
end $$;
create table public.authoring_execution as select c||jsonb_build_object('draftRevision',d.updated_at,'approvals',jsonb_build_object('voice',d.voice_approved_at,'video',d.video_qa_approved_at,'publication',d.publication_approved_at)) s from authoring_gate_content cross join public.cs_character_promo_drafts d;
select assert_ok(public.cs_approve_character_promo('00000000-0000-0000-0000-000000000020',repeat('d',64),s,clock_timestamp(),'00000000-0000-0000-0000-000000000001'),'genuine approval') from authoring_execution;
create function public.authoring_claim() returns uuid language sql as $$ select public.cs_claim_character_promo('00000000-0000-0000-0000-000000000020',repeat('d',64),s) from authoring_execution $$;
commit;
