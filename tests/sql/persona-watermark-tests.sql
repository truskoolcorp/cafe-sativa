-- Disposable synthetic observations only, no actual media approval.
select public.assert_ok(not cs_promo_private.validate_snapshot('00000000-0000-0000-0000-000000000020',s),'old eight-check approval cannot pass') from fixture_snapshot;
select public.assert_ok(not cs_promo_private.validate_gate_content('00000000-0000-0000-0000-000000000020',s-array['approvals','draftRevision']),'old eight-check gates cannot pass') from fixture_snapshot;
select public.assert_ok(public.cs_record_character_promo_qa_observation(d.id,repeat('a',64),d.updated_at,'third_party_watermark','needs_review','Uncertain full clip coverage',null,'00000000-0000-0000-0000-000000000001') is not null,'new named observation accepted with explicit actor') from public.cs_character_promo_drafts d;
select public.assert_ok(not cs_promo_private.watermark_valid('00000000-0000-0000-0000-000000000010',repeat('a',64)),'unknown stays held');
select public.assert_ok(public.cs_record_character_promo_qa_observation(d.id,repeat('a',64),d.updated_at,'third_party_watermark','pass','Complete synthetic clip reviewed; authorized ecosystem logo only',to_jsonb(q),'00000000-0000-0000-0000-000000000001') is not null,'explicit exact-hash reviewer pass') from public.cs_character_promo_drafts d join public.cs_character_promo_qa_checks q on q.promo_id=d.id and q.check_name='third_party_watermark';
update fixture_snapshot set s=jsonb_set(s,'{qa}',(select jsonb_agg(to_jsonb(q) order by check_name) from public.cs_character_promo_qa_checks q));
select public.assert_ok(cs_promo_private.validate_gate_content('00000000-0000-0000-0000-000000000020',s-array['approvals','draftRevision']),'ninth exact evidence supports review, not final approval') from fixture_snapshot;
select public.assert_ok(not cs_promo_private.watermark_valid('00000000-0000-0000-0000-000000000010',repeat('b',64)),'replacement hash does not inherit review');
-- Marked bytes must fail even when a privileged erroneous observation says pass.
insert into public.cs_character_promo_qa_checks(promo_id,video_sha256,check_name,result,evidence,reviewer_id)
values('00000000-0000-0000-0000-000000000010','a20bd6a7f813370991031840a105a6b3bbac66d28dddbe13dd6dedf920a4903d','third_party_watermark','pass','Mistaken historical pass','00000000-0000-0000-0000-000000000001');
select public.assert_ok(not cs_promo_private.watermark_valid('00000000-0000-0000-0000-000000000010','a20bd6a7f813370991031840a105a6b3bbac66d28dddbe13dd6dedf920a4903d'),'known marked byte denial overrides mistaken pass');
select public.assert_ok(not has_function_privilege('service_role','cs_promo_private.watermark_valid(uuid,text)','EXECUTE'),'helper no runtime grant');
update auth.users set raw_app_meta_data='{}';
do $$ begin begin perform public.cs_record_character_promo_qa_observation(d.id,repeat('a',64),d.updated_at,'third_party_watermark','pass','Attempt after revocation',null,'00000000-0000-0000-0000-000000000001') from public.cs_character_promo_drafts d; raise exception 'unexpected authority'; exception when others then if sqlerrm<>'Verified content admin required' then raise; end if; end; end $$;
