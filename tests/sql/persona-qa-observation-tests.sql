-- Synthetic observations only: these fixtures do not claim a human reviewed media.
begin;
insert into auth.users values('00000000-0000-0000-0000-000000000002','{"cafe_sativa_admin":true}');
create table qa_saved as select to_jsonb(d) draft,to_jsonb(q) observation from public.cs_character_promo_drafts d join public.cs_character_promo_qa_checks q on q.promo_id=d.id where q.check_name='lip_sync';
create function public.qa_test_save(expected jsonb,sha text default repeat('a',64),revision timestamptz default null,evidence text default 'Synthetic assertion only') returns jsonb language sql as $$
 select public.cs_record_character_promo_qa_observation('00000000-0000-0000-0000-000000000010',sha,coalesce(revision,(draft->>'updated_at')::timestamptz),'lip_sync','needs_review',evidence,expected,'00000000-0000-0000-0000-000000000002') from qa_saved
$$;
select assert_ok(qa_test_save(null) is null,'absent expectation cannot replace present');
select assert_ok(qa_test_save(observation,repeat('b',64)) is null,'stale media cannot attach to current bytes') from qa_saved;
select assert_ok(qa_test_save(observation,repeat('a',64),'2000-01-01') is null,'stale revision denied') from qa_saved;
select assert_ok(qa_test_save(observation||'{"extra":true}') is null,'extra CAS fields denied') from qa_saved;
select assert_ok(qa_test_save(observation-'reviewer_id') is null,'missing CAS fields denied') from qa_saved;
select assert_ok(qa_test_save(jsonb_set(observation,array[k],v)) is null,'every typed observation field participates: '||k) from qa_saved cross join (values
 ('id','"00000000-0000-0000-0000-000000000099"'::jsonb),('promo_id','"00000000-0000-0000-0000-000000000099"'),('video_sha256',to_jsonb(repeat('b',64))),('check_name','"rights"'),('result','"fail"'),('evidence','"Changed"'),('reviewer_id','"00000000-0000-0000-0000-000000000099"'),('created_at','"2000-01-01T00:00:00Z"')) x(k,v);
select assert_ok(qa_test_save(observation,repeat('a',64),null,' ') is null,'written evidence required') from qa_saved;
insert into cs_promo_private.approvals(plan_id,snapshot,digest,approved_by,approved_at,source_state) values('00000000-0000-0000-0000-000000000020','{}',repeat('a',64),'00000000-0000-0000-0000-000000000001',now(),'{}');
select assert_ok(qa_test_save(observation) is not null,'fresh content admin without owner membership can record explicit needs_review') from qa_saved;
select assert_ok((select bool_and(invalidated) from cs_promo_private.approvals),'existing consent invalidated');
select assert_ok(qa_test_save(observation) is null,'second contender with same prior state loses') from qa_saved;
select assert_ok(to_jsonb(d)=s.draft,'all draft fields and approval stamps unchanged') from public.cs_character_promo_drafts d cross join qa_saved s;
delete from public.cs_character_promo_qa_checks where check_name='lip_sync';
select assert_ok(qa_test_save(observation) is null,'present expectation cannot recreate deleted observation') from qa_saved;
select assert_ok(qa_test_save(null) is not null,'explicit absent CAS inserts observation');
select assert_ok(qa_test_save(null) is null,'absent CAS replay cannot overwrite');
update auth.users set raw_app_meta_data='{"cafe_sativa_admin":"true"}' where id='00000000-0000-0000-0000-000000000002';
do $$ begin begin perform qa_test_save(null); raise exception 'unexpected authority'; exception when others then if sqlerrm<>'Verified content admin required' then raise; end if; end; end $$;
rollback;

begin;
create table qa_saved as select to_jsonb(d) draft,to_jsonb(q) observation from public.cs_character_promo_drafts d join public.cs_character_promo_qa_checks q on q.promo_id=d.id where q.check_name='lip_sync';
update public.cs_character_promo_drafts set video_asset_path=replace(video_asset_path,repeat('a',64),repeat('b',64));
select assert_ok(public.cs_record_character_promo_qa_observation((draft->>'id')::uuid,repeat('a',64),(draft->>'updated_at')::timestamptz,'lip_sync','fail','Synthetic stale media',observation,'00000000-0000-0000-0000-000000000001') is null,'replaced media rejects old explicit viewed SHA') from qa_saved;
rollback;

begin;
insert into public.cs_character_promo_delivery_plans(id,promo_id,character_id,network,account_id,scheduled_at,status,caption) select '00000000-0000-0000-0000-000000000021',promo_id,character_id,'facebook','146219355471397',scheduled_at,status,caption from public.cs_character_promo_delivery_plans;
insert into cs_promo_private.approvals(plan_id,snapshot,digest,approved_by,approved_at,source_state) values('00000000-0000-0000-0000-000000000021','{}',repeat('a',64),'00000000-0000-0000-0000-000000000001',now(),'{}');
insert into cs_promo_private.attempts(plan_id,state) values('00000000-0000-0000-0000-000000000021','submission_unknown');
select assert_ok(public.cs_record_character_promo_qa_observation(d.id,repeat('a',64),d.updated_at,'lip_sync','fail','Synthetic claim assertion',to_jsonb(q),'00000000-0000-0000-0000-000000000001') is null,'shared draft sibling attempt blocks QA') from public.cs_character_promo_drafts d join public.cs_character_promo_qa_checks q on q.promo_id=d.id where q.check_name='lip_sync';
rollback;

select assert_ok(not has_function_privilege('authenticated','public.cs_record_character_promo_qa_observation(uuid,text,timestamptz,text,text,text,jsonb,uuid)','execute'),'authenticated cannot forge reviewer');
select assert_ok(has_function_privilege('service_role','public.cs_record_character_promo_qa_observation(uuid,text,timestamptz,text,text,text,jsonb,uuid)','execute'),'server RPC permitted');
