begin;
update public.cs_character_promo_drafts set voice_approved_at=null,video_qa_approved_at=null,publication_approved_at=null;
update public.cs_character_promo_delivery_plans set status='blocked_assets';
create function public.revocation_expected() returns jsonb language sql as $$
select jsonb_build_object('draftRevision',d.updated_at,'voiceApprovedAt',d.voice_approved_at,'videoApprovedAt',d.video_qa_approved_at,'publicationApprovedAt',d.publication_approved_at,'planStatus',p.status,'generationId',(select generation_id from cs_promo_private.review_heads where plan_id=p.id)) from public.cs_character_promo_drafts d join public.cs_character_promo_delivery_plans p on p.promo_id=d.id
$$;
create function public.begin_fixture_review() returns jsonb language sql as $$
select public.cs_begin_character_promo_review('00000000-0000-0000-0000-000000000020',s-array['approvals','draftRevision'],repeat('c',64),public.revocation_expected(),'00000000-0000-0000-0000-000000000001') from fixture_snapshot
$$;
select public.assert_ok(public.begin_fixture_review() is not null,'review before revocation');
do $$ begin begin delete from cs_promo_private.owners where actor='00000000-0000-0000-0000-000000000001'; raise exception 'Existing owner deletion was not rejected'; exception when others then if sqlerrm <> 'Persona owner records are permanent; disable instead' then raise; end if; end; end $$;
select public.assert_ok((select count(*)=1 from cs_promo_private.owners where actor='00000000-0000-0000-0000-000000000001'),'existing-evidence owner retained');
update cs_promo_private.owners set enabled=false;
update cs_promo_private.owners set enabled=true;
select public.assert_ok((public.cs_read_character_promo_gates('00000000-0000-0000-0000-000000000020')->>'invalidated')::boolean,'owner disable reenable does not revive');
select public.assert_ok(public.begin_fixture_review() is not null,'explicit replacement after owner restored');
update auth.users set raw_app_meta_data='{"cafe_sativa_admin":false}';
update auth.users set raw_app_meta_data='{"cafe_sativa_admin":true}';
select public.assert_ok((public.cs_read_character_promo_gates('00000000-0000-0000-0000-000000000020')->>'invalidated')::boolean,'admin loss restore does not revive');
select public.assert_ok(public.begin_fixture_review() is not null,'explicit replacement after admin restored');
update auth.users set raw_app_meta_data=raw_app_meta_data||'{"unrelated":"changed"}'::jsonb;
select public.assert_ok(not (public.cs_read_character_promo_gates('00000000-0000-0000-0000-000000000020')->>'invalidated')::boolean,'unrelated metadata untouched');
insert into auth.users values('00000000-0000-0000-0000-000000000099','{"cafe_sativa_admin":true}');
update auth.users set raw_app_meta_data='{}' where id='00000000-0000-0000-0000-000000000099';
select public.assert_ok(not (public.cs_read_character_promo_gates('00000000-0000-0000-0000-000000000020')->>'invalidated')::boolean,'unrelated account authority untouched');
delete from auth.users where id='00000000-0000-0000-0000-000000000001';
insert into auth.users values('00000000-0000-0000-0000-000000000001','{"cafe_sativa_admin":true}');
select public.assert_ok((public.cs_read_character_promo_gates('00000000-0000-0000-0000-000000000020')->>'invalidated')::boolean,'account deletion recreation does not revive');
select public.assert_ok((select count(*)=3 from cs_promo_private.review_versions),'all historical review versions preserved');
-- Ordinary local fixture models a first-ever contribution inserted using a previously
-- validated epoch after the revoke trigger had already scanned its evidence tables.
insert into auth.users values('00000000-0000-0000-0000-000000000002','{"cafe_sativa_admin":true}');
insert into cs_promo_private.owners(actor) values('00000000-0000-0000-0000-000000000002');
do $$ begin begin delete from cs_promo_private.owners where actor='00000000-0000-0000-0000-000000000002'; raise exception 'Zero-evidence owner deletion was not rejected'; exception when others then if sqlerrm <> 'Persona owner records are permanent; disable instead' then raise; end if; end; end $$;
select public.assert_ok((select count(*)=1 from cs_promo_private.owners where actor='00000000-0000-0000-0000-000000000002' and revocation_epoch=0),'zero-evidence owner epoch tombstone retained');
do $$ begin begin update cs_promo_private.owners set actor='00000000-0000-0000-0000-000000000003' where actor='00000000-0000-0000-0000-000000000002'; raise exception 'Owner identity change was not rejected'; exception when others then if sqlerrm <> 'Persona owner identity is permanent' then raise; end if; end; end $$;
select public.assert_ok((select count(*)=1 from cs_promo_private.owners where actor='00000000-0000-0000-0000-000000000002' and revocation_epoch=0),'owner identity cannot be renamed away and recreated');
create table public.captured_authority as select o.actor,o.revocation_epoch from cs_promo_private.owners o join auth.users u on u.id=o.actor where o.actor='00000000-0000-0000-0000-000000000002' and o.enabled and u.raw_app_meta_data->'cafe_sativa_admin'='true'::jsonb;
update cs_promo_private.owners set enabled=false where actor='00000000-0000-0000-0000-000000000002';
update cs_promo_private.owners set enabled=true where actor='00000000-0000-0000-0000-000000000002';
select public.assert_ok(not cs_promo_private.actor_epoch_valid(actor,revocation_epoch),'first-ever captured authority permanently stale') from captured_authority;
insert into cs_promo_private.review_versions(plan_id,content,digest,source_state,begun_by,begun_epoch)
select '00000000-0000-0000-0000-000000000020',s-array['approvals','draftRevision'],repeat('c',64),cs_promo_private.gate_source_state('00000000-0000-0000-0000-000000000020'),actor,revocation_epoch from fixture_snapshot cross join captured_authority;
update cs_promo_private.review_heads set generation_id=(select id from cs_promo_private.review_versions where begun_by='00000000-0000-0000-0000-000000000002');
select public.assert_ok((public.cs_read_character_promo_gates('00000000-0000-0000-0000-000000000020')->>'invalidated')::boolean,'missed evidence cannot revive after restore');
select public.assert_ok(public.cs_confirm_character_promo_gate('00000000-0000-0000-0000-000000000020',s-array['approvals','draftRevision'],repeat('c',64),public.revocation_expected(),'voice','00000000-0000-0000-0000-000000000001') is null,'another active owner cannot reuse stale-begun generation') from fixture_snapshot;
commit;
