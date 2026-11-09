-- Isolated fixture only. Intentionally incomplete existing plan, no external facts.
begin;
update public.cs_character_promo_delivery_plans set caption=null,scheduled_at='2020-01-01',status='blocked_assets';
delete from public.cs_character_promo_qa_checks;
update public.cs_character_promo_drafts set video_asset_path=null;
create table authoring_fixture(review jsonb);
insert into authoring_fixture select public.cs_review_character_promo_plan_edit('00000000-0000-0000-0000-000000000020','New caption','2099-01-01T12:00:00.000Z','00000000-0000-0000-0000-000000000001');
select assert_ok(review is not null,'null caption and past schedule can be authored without QA/video') from authoring_fixture;
select assert_ok(review->>'digest'=encode(sha256(convert_to((review->'snapshot')::text,'UTF8')),'hex'),'built-in SQL canonical digest') from authoring_fixture;
select assert_ok(public.cs_save_character_promo_plan_edit(review->'snapshot',repeat('0',64),'00000000-0000-0000-0000-000000000001') is null,'wrong digest denied') from authoring_fixture;
select assert_ok(public.cs_save_character_promo_plan_edit(jsonb_set(review->'snapshot','{changes,caption}','"Tampered"'),review->>'digest','00000000-0000-0000-0000-000000000001') is null,'changed proposed caption denied') from authoring_fixture;
select assert_ok(public.cs_save_character_promo_plan_edit(jsonb_set(review->'snapshot','{expected,plan,account_id}','"other"'),review->>'digest','00000000-0000-0000-0000-000000000001') is null,'changed destination denied') from authoring_fixture;
grant select on authoring_fixture to service_role;
set local role service_role;
select public.assert_ok(public.cs_save_character_promo_plan_edit(review->'snapshot',review->>'digest','00000000-0000-0000-0000-000000000001') is not null,'save as server') from authoring_fixture;
reset role;
select assert_ok((to_jsonb(p)-array['caption','scheduled_at'])=((f.review#>'{snapshot,expected,plan}')-array['caption','scheduled_at']),'all other plan fields immutable') from public.cs_character_promo_delivery_plans p cross join authoring_fixture f;
select assert_ok(to_jsonb(d)=f.review#>'{snapshot,expected,draft}','draft unchanged including historical stamps') from public.cs_character_promo_drafts d cross join authoring_fixture f;
select assert_ok(public.cs_save_character_promo_plan_edit(review->'snapshot',review->>'digest','00000000-0000-0000-0000-000000000001') is null,'exact replay denied') from authoring_fixture;
rollback;

begin;
create table authoring_fixture(review jsonb);
insert into authoring_fixture select public.cs_review_character_promo_plan_edit('00000000-0000-0000-0000-000000000020','New caption','2099-01-01T12:00:00.000Z','00000000-0000-0000-0000-000000000001');
update public.cs_character_promo_drafts set title='Changed after review';
select assert_ok(public.cs_save_character_promo_plan_edit(review->'snapshot',review->>'digest','00000000-0000-0000-0000-000000000001') is null,'entire draft CAS detects non-revision change') from authoring_fixture;
rollback;
begin;
create table authoring_fixture(review jsonb);
insert into authoring_fixture select public.cs_review_character_promo_plan_edit('00000000-0000-0000-0000-000000000020','New caption','2099-01-01T12:00:00.000Z','00000000-0000-0000-0000-000000000001');
update public.cs_character_promo_delivery_plans set caption='Other editor';
select assert_ok(public.cs_save_character_promo_plan_edit(review->'snapshot',review->>'digest','00000000-0000-0000-0000-000000000001') is null,'entire plan CAS detects competing edit') from authoring_fixture;
rollback;
begin;
create table authoring_fixture(review jsonb);
insert into authoring_fixture select public.cs_review_character_promo_plan_edit('00000000-0000-0000-0000-000000000020','New caption','2099-01-01T12:00:00.000Z','00000000-0000-0000-0000-000000000001');
update cs_promo_private.owners set enabled=false;
update cs_promo_private.owners set enabled=true;
select assert_ok(public.cs_save_character_promo_plan_edit(review->'snapshot',review->>'digest','00000000-0000-0000-0000-000000000001') is null,'revoke restore epoch blocks old review') from authoring_fixture;
rollback;

-- Invalid/new values rejected; no timezone coercion or implicit caption/defaults.
select assert_ok(public.cs_review_character_promo_plan_edit('00000000-0000-0000-0000-000000000020',caption,scheduled,'00000000-0000-0000-0000-000000000001') is null,'invalid changes rejected') from (values
 (null::text,'2099-01-01T12:00:00.000Z'),(' ','2099-01-01T12:00:00.000Z'),(repeat('x',501),'2099-01-01T12:00:00.000Z'),
 ('caption','2020-01-01T12:00:00.000Z'),('caption','2099-01-01T12:00:00+00:00'),('caption','2099-02-31T12:00:00.000Z'),('caption',null),('caption','2099-01-01T12:00:00Z')) t(caption,scheduled);

-- Shared-draft claim blocks review and previously reviewed Save even on another plan.
begin;
insert into public.cs_character_promo_delivery_plans(id,promo_id,character_id,network,account_id,scheduled_at,status,caption)
select '00000000-0000-0000-0000-000000000021',promo_id,character_id,'facebook','146219355471397',scheduled_at,status,caption from public.cs_character_promo_delivery_plans;
create table authoring_fixture(review jsonb);
insert into authoring_fixture select public.cs_review_character_promo_plan_edit('00000000-0000-0000-0000-000000000020','New caption','2099-01-01T12:00:00.000Z','00000000-0000-0000-0000-000000000001');
insert into cs_promo_private.approvals(plan_id,snapshot,digest,approved_by,approved_at,source_state) values('00000000-0000-0000-0000-000000000021','{}',repeat('a',64),'00000000-0000-0000-0000-000000000001',now(),'{}');
insert into cs_promo_private.attempts(plan_id,state) values('00000000-0000-0000-0000-000000000021','submission_unknown');
select assert_ok(public.cs_save_character_promo_plan_edit(review->'snapshot',review->>'digest','00000000-0000-0000-0000-000000000001') is null,'sibling attempt blocks save') from authoring_fixture;
select assert_ok(public.cs_review_character_promo_plan_edit('00000000-0000-0000-0000-000000000020','New caption','2099-01-01T12:00:00.000Z','00000000-0000-0000-0000-000000000001') is null,'sibling attempt blocks review');
rollback;

-- Preserve source/gate/approval records, invalidating consent with existing guard.
begin;
insert into cs_promo_private.review_versions(id,plan_id,content,digest,source_state,begun_by,begun_epoch) values('00000000-0000-0000-0000-000000000030','00000000-0000-0000-0000-000000000020','{}',repeat('a',64),'{}','00000000-0000-0000-0000-000000000001',0);
insert into cs_promo_private.review_heads values('00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000030');
insert into cs_promo_private.gates(generation_id,plan_id,gate,content,digest,confirmed_by,confirmed_epoch,confirmed_at,source_state,draft_applied,plan_applied) values('00000000-0000-0000-0000-000000000030','00000000-0000-0000-0000-000000000020','voice','{}',repeat('a',64),'00000000-0000-0000-0000-000000000001',0,now(),'{}',true,true);
insert into cs_promo_private.approvals(plan_id,snapshot,digest,approved_by,approved_at,source_state,review_generation_id,approver_epoch) values('00000000-0000-0000-0000-000000000020','{}',repeat('a',64),'00000000-0000-0000-0000-000000000001',now(),'{}','00000000-0000-0000-0000-000000000030',0);
select assert_ok(public.cs_save_character_promo_plan_edit(r->'snapshot',r->>'digest','00000000-0000-0000-0000-000000000001') is not null,'edit after review evidence') from (select public.cs_review_character_promo_plan_edit('00000000-0000-0000-0000-000000000020','New caption','2099-01-01T12:00:00.000Z','00000000-0000-0000-0000-000000000001') r) f;
select assert_ok((select count(*)=1 and bool_and(invalidated) from cs_promo_private.approvals),'approvals kept invalid');
select assert_ok((select count(*)=1 and bool_and(invalidated) from cs_promo_private.gates),'gates kept invalid');
select assert_ok((select count(*)=1 and bool_and(invalidated) from cs_promo_private.review_versions),'generations kept invalid');
select assert_ok((select count(*)=1 from cs_promo_private.review_heads),'heads retained');
select assert_ok((select count(*)=1 and bool_and(saved_at is not null) from cs_promo_private.plan_edit_reviews),'authoring evidence retained');
rollback;

-- Authority checks and restricted privileges; no claims based on request actor alone.
select assert_ok(not has_function_privilege('authenticated','public.cs_review_character_promo_plan_edit(uuid,text,text,uuid)','execute'),'browser cannot review RPC');
select assert_ok(not has_function_privilege('anon','public.cs_save_character_promo_plan_edit(jsonb,text,uuid)','execute'),'anonymous cannot save RPC');
select assert_ok(not has_table_privilege('service_role','cs_promo_private.plan_edit_reviews','insert,update,delete'),'server cannot forge review table');
begin;
update auth.users set raw_app_meta_data='{}';
do $$ begin
 begin
  perform public.cs_review_character_promo_plan_edit('00000000-0000-0000-0000-000000000020','caption','2099-01-01T12:00:00.000Z','00000000-0000-0000-0000-000000000001');
  raise exception 'Missing admin improperly allowed';
 exception when others then if sqlerrm<>'Verified owner required' then raise; end if; end;
end $$;
rollback;
begin;
update cs_promo_private.owners set enabled=false;
do $$ begin
 begin
  perform public.cs_save_character_promo_plan_edit('{}',repeat('a',64),'00000000-0000-0000-0000-000000000001');
  raise exception 'Disabled owner improperly allowed';
 exception when others then if sqlerrm<>'Verified owner required' then raise; end if; end;
end $$;
rollback;
begin isolation level repeatable read;
do $$ begin
 begin
  perform public.cs_review_character_promo_plan_edit('00000000-0000-0000-0000-000000000020','caption','2099-01-01T12:00:00.000Z','00000000-0000-0000-0000-000000000001');
  raise exception 'Repeatable read review improperly allowed';
 exception when others then if sqlerrm<>'Plan authoring requires READ COMMITTED' then raise; end if; end;
 begin
  perform public.cs_save_character_promo_plan_edit('{}',repeat('a',64),'00000000-0000-0000-0000-000000000001');
  raise exception 'Repeatable read save improperly allowed';
 exception when others then if sqlerrm<>'Plan authoring requires READ COMMITTED' then raise; end if; end;
end $$;
rollback;
