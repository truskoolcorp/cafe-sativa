begin;
create function public.assert_ok(ok boolean, message text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'ASSERT: %',message; end if; end $$;
insert into auth.users values('00000000-0000-0000-0000-000000000001','{"cafe_sativa_admin":true}');
insert into cs_promo_private.owners(actor) values('00000000-0000-0000-0000-000000000001');
insert into public.cs_character_promo_drafts(id,character_id,promo_key,specialty,title,spoken_script,visual_brief,intended_channel,duration_seconds,status,actual_social_account,video_asset_path,voice_approved_at,video_qa_approved_at,publication_approved_at)
values('00000000-0000-0000-0000-000000000010','keith','test','test','test','Exact approved words','Exact scene','truskoolcorp_metricool_brand_5373515',15,'script_approved','metricool-brand:5373515','character-promos/keith/00000000-0000-0000-0000-000000000010/'||repeat('a',64)||'.mp4',now(),now(),now());
insert into public.cs_character_promo_delivery_plans(id,promo_id,character_id,network,account_id,scheduled_at,status,caption)
values('00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000010','keith','threads','truskoolcorp',now()+interval '1 day','ready_for_delivery','Exact caption');
insert into public.cs_character_promo_qa_checks(promo_id,video_sha256,check_name,result,evidence,reviewer_id)
select '00000000-0000-0000-0000-000000000010',repeat('a',64),c,'pass','Fixture reviewed evidence','00000000-0000-0000-0000-000000000001' from unnest(array['mp4_integrity','canonical_likeness','canonical_speech','lip_sync','visual_text','rights','duration','brand_safety']) c;
create table public.fixture_snapshot(s jsonb);
insert into public.fixture_snapshot select jsonb_build_object('version',1,'planId',p.id,'promoId',d.id,'characterId',d.character_id,'draftRevision',d.updated_at,'script',d.spoken_script,'visualBrief',d.visual_brief,'durationSeconds',d.duration_seconds,'audioPath',d.audio_asset_path,'videoPath',d.video_asset_path,'videoSha256',repeat('a',64),'videoBytes',1024,'canon',jsonb_build_object('revisionSha256',repeat('e',64),'assetId','canonical-asset','portraitSha256',repeat('b',64),'voiceId','canonical-voice','rightsStatus','approved','voiceStatus','canonical','productionReady',true),'approvals',jsonb_build_object('voice',d.voice_approved_at,'video',d.video_qa_approved_at,'publication',d.publication_approved_at),'caption',p.caption,'scheduledAt',p.scheduled_at,'network',p.network,'accountId',p.account_id,'brandId','5373515','userId','4174093','timezone','UTC','qa',(select jsonb_agg(to_jsonb(q) order by check_name) from public.cs_character_promo_qa_checks q where q.promo_id=d.id)) from public.cs_character_promo_drafts d join public.cs_character_promo_delivery_plans p on p.promo_id=d.id;
select public.assert_ok(cs_promo_private.validate_snapshot('00000000-0000-0000-0000-000000000020',s),'valid snapshot') from fixture_snapshot;
select public.assert_ok(not has_function_privilege('anon','public.cs_claim_character_promo(uuid,text,jsonb)','EXECUTE'),'anon cannot claim');
select public.assert_ok(not has_function_privilege('authenticated','public.cs_approve_character_promo(uuid,text,jsonb,timestamptz,uuid)','EXECUTE'),'browser cannot approve');
select public.assert_ok(not has_table_privilege('service_role','cs_promo_private.attempts','DELETE'),'service cannot erase attempts');
select public.assert_ok(has_function_privilege('service_role','public.cs_claim_character_promo(uuid,text,jsonb)','EXECUTE'),'service can claim');
select public.assert_ok((select proconfig @> array['search_path=pg_catalog'] from pg_proc where oid='public.cs_claim_character_promo(uuid,text,jsonb)'::regprocedure),'fixed search path');
select public.assert_ok((select pg_get_userbyid(relowner)<> 'service_role' from pg_class where oid='cs_promo_private.attempts'::regclass),'service is not owner');
select public.assert_ok(public.cs_claim_character_promo('00000000-0000-0000-0000-000000000020',repeat('c',64),s) is null,'no implicit approval') from fixture_snapshot;
select public.assert_ok(public.cs_approve_character_promo('00000000-0000-0000-0000-000000000020',repeat('c',64),s,clock_timestamp(),'00000000-0000-0000-0000-000000000001'),'explicit approval') from fixture_snapshot;
select public.assert_ok(not public.cs_approve_character_promo('00000000-0000-0000-0000-000000000020',repeat('d',64),s,clock_timestamp(),'00000000-0000-0000-0000-000000000001'),'immutable approval') from fixture_snapshot;
select public.assert_ok(public.cs_claim_character_promo('00000000-0000-0000-0000-000000000020',repeat('d',64),s) is null,'conflicting digest') from fixture_snapshot;
select public.assert_ok(public.cs_claim_character_promo('00000000-0000-0000-0000-000000000020',repeat('c',64),jsonb_set(s,'{accountId}','"other-account"')) is null,'wrong exact destination') from fixture_snapshot;
select public.assert_ok(public.cs_read_character_promo_approval('00000000-0000-0000-0000-000000000020')->>'approvedBy'='00000000-0000-0000-0000-000000000001','service reader exact actor');
commit;
-- Transactional edit/revert still invalidates approval. Rollback isolates fixture for later cases.
begin;
update public.cs_character_promo_drafts set spoken_script='changed' where id='00000000-0000-0000-0000-000000000010';
update public.cs_character_promo_drafts set spoken_script='Exact approved words' where id='00000000-0000-0000-0000-000000000010';
select public.assert_ok(public.cs_claim_character_promo('00000000-0000-0000-0000-000000000020',repeat('c',64),s) is null,'edit revert invalidates') from fixture_snapshot;
rollback;
begin;
update public.cs_character_promo_qa_checks set evidence='changed evidence' where check_name='rights';
select public.assert_ok(public.cs_claim_character_promo('00000000-0000-0000-0000-000000000020',repeat('c',64),s) is null,'QA edit invalidates') from fixture_snapshot;
rollback;
begin;
update auth.users set raw_app_meta_data='{}';
select public.assert_ok(public.cs_claim_character_promo('00000000-0000-0000-0000-000000000020',repeat('c',64),s) is null,'removed admin approval rejected') from fixture_snapshot;
rollback;
do $$ begin begin perform public.cs_approve_character_promo('00000000-0000-0000-0000-000000000020',repeat('c',64),'{}',clock_timestamp(),'00000000-0000-0000-0000-000000000099'); raise exception 'actor check failed'; exception when others then if sqlerrm <> 'Verified owner required' then raise; end if; end; end $$;
-- Leave unclaimed for the separate multi-session race fixture.


begin;
update cs_promo_private.owners set enabled=false;
select public.assert_ok(public.cs_read_character_promo_approval('00000000-0000-0000-0000-000000000020') is null,'disabled owner cannot read approval');
select public.assert_ok(public.cs_claim_character_promo('00000000-0000-0000-0000-000000000020',repeat('c',64),s) is null,'disabled owner cannot claim') from fixture_snapshot;
do $$ begin begin perform public.cs_approve_character_promo('00000000-0000-0000-0000-000000000020',repeat('c',64),'{}',clock_timestamp(),'00000000-0000-0000-0000-000000000001'); raise exception 'disabled owner check failed'; exception when others then if sqlerrm <> 'Verified owner required' then raise; end if; end; end $$;
rollback;
select public.assert_ok(not cs_promo_private.validate_snapshot('00000000-0000-0000-0000-000000000020',s #- '{canon,revisionSha256}'),'canon revision required') from fixture_snapshot;
select public.assert_ok(public.cs_claim_character_promo('00000000-0000-0000-0000-000000000020',repeat('c',64),jsonb_set(s,'{canon,revisionSha256}',to_jsonb(repeat('f',64)))) is null,'canon revision change invalidates approved snapshot') from fixture_snapshot;
