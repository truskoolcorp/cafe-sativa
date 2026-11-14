-- REVIEW ONLY. Apply only after independent review and exact live definition comparison.
-- No passes, approval stamps, backfill or publication. Existing 8-check snapshots fail closed.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
alter table public.cs_character_promo_qa_checks drop constraint cs_character_promo_qa_checks_check_name_check;
alter table public.cs_character_promo_qa_checks add constraint cs_character_promo_qa_checks_check_name_check check(check_name in ('mp4_integrity','canonical_likeness','canonical_speech','lip_sync','visual_text','rights','duration','brand_safety','third_party_watermark'));
create or replace function cs_promo_private.watermark_valid(p_promo uuid,p_hash text) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select coalesce(p_hash ~ '^[a-f0-9]{64}$' and p_hash not in (
 'a20bd6a7f813370991031840a105a6b3bbac66d28dddbe13dd6dedf920a4903d',
 'ed8153e2ddd80b3099823eec24c22327cccad3eabdc4c0a039d4425b5f3a52e7',
 '70f2ad3fe14420e472908850576b3240bbad2a3e6d121ae2f89a7da77148f4e0')
 and (select count(*)=1 from public.cs_character_promo_qa_checks q
 where q.promo_id=p_promo and q.video_sha256=p_hash and q.check_name='third_party_watermark'
 and q.result='pass' and q.reviewer_id is not null and length(btrim(q.evidence))>0 and length(q.evidence)<=1000),false)
$$;
revoke all on function cs_promo_private.watermark_valid(uuid,text) from public,anon,authenticated,service_role;
create or replace function cs_promo_private.validate_snapshot(p_plan_id uuid,s jsonb) returns boolean
language plpgsql set search_path=pg_catalog as $$
declare d public.cs_character_promo_drafts; p public.cs_character_promo_delivery_plans; q public.cs_character_promo_qa_checks; v_count int;
begin
 select * into p from public.cs_character_promo_delivery_plans where id=p_plan_id;
 select * into d from public.cs_character_promo_drafts where id=p.promo_id;
 if p.id is null or s is null then return false; end if;
 if not coalesce(s->>'version'='1' and s->>'planId'=p.id::text and s->>'promoId'=d.id::text
 and s->>'characterId'=d.character_id and p.character_id=d.character_id and d.character_id='keith'
 and d.intended_channel='truskoolcorp_metricool_brand_5373515' and d.status='script_approved' and p.status='ready_for_delivery'
 and s->>'script'=d.spoken_script and length(trim(d.spoken_script))>0 and s->>'visualBrief'=d.visual_brief
 and (s->>'durationSeconds')::int=d.duration_seconds and d.duration_seconds between 8 and 45
 and (s->>'draftRevision')::timestamptz=d.updated_at
 and s->>'audioPath' is not distinct from d.audio_asset_path
 and s->>'videoPath'=d.video_asset_path and s->>'videoSha256' ~ '^[a-f0-9]{64}$'
 and d.video_asset_path='character-promos/'||d.character_id||'/'||d.id::text||'/'||(s->>'videoSha256')||'.mp4'
 and (s->>'videoBytes')::int between 16 and 36700160
 and (s#>>'{approvals,voice}')::timestamptz=d.voice_approved_at
 and (s#>>'{approvals,video}')::timestamptz=d.video_qa_approved_at
 and (s#>>'{approvals,publication}')::timestamptz=d.publication_approved_at
 and greatest(d.voice_approved_at,d.video_qa_approved_at,d.publication_approved_at)<=clock_timestamp()
 and s->>'caption'=p.caption and length(trim(p.caption))>0 and length(p.caption)<=500
 and (s->>'scheduledAt')::timestamptz=p.scheduled_at and p.scheduled_at>clock_timestamp()+interval '60 seconds'
 and s->>'network'=p.network and s->>'accountId'=p.account_id and d.actual_social_account='metricool-brand:5373515'
 and ((p.network='facebook' and p.account_id='146219355471397') or (p.network='threads' and p.account_id='truskoolcorp'))
 and s->>'brandId'='5373515' and s->>'userId'='4174093' and length(s->>'timezone')>0
 and s#>>'{canon,rightsStatus}'='approved' and s#>>'{canon,voiceStatus}'='canonical' and (s#>>'{canon,productionReady}')::boolean=true
 and s#>>'{canon,revisionSha256}' ~ '^[a-f0-9]{64}$'
 and length(s#>>'{canon,assetId}')>0 and s#>>'{canon,portraitSha256}' ~ '^[a-f0-9]{64}$' and length(s#>>'{canon,voiceId}')>0
 and jsonb_array_length(s->'qa')=9,false) then return false; end if;
 select count(*) into v_count from public.cs_character_promo_qa_checks where promo_id=d.id and video_sha256=s->>'videoSha256' and result='pass';
 if v_count<>9 then return false; end if;
 for q in select * from jsonb_populate_recordset(null::public.cs_character_promo_qa_checks,s->'qa') loop
   if q.promo_id is distinct from d.id or q.video_sha256 is distinct from s->>'videoSha256' or q.result is distinct from 'pass'
    or not exists(select 1 from public.cs_character_promo_qa_checks z where z is not distinct from q) then return false; end if;
 end loop;
 if (select count(distinct x->>'check_name') from jsonb_array_elements(s->'qa') x)<>9 then return false; end if;
 if not cs_promo_private.watermark_valid(d.id,s->>'videoSha256') then return false; end if;
 return true;
exception when others then return false;
end $$;
create or replace function cs_promo_private.validate_gate_content(p_plan_id uuid,s jsonb) returns boolean
language plpgsql set search_path=pg_catalog as $$
declare d public.cs_character_promo_drafts; p public.cs_character_promo_delivery_plans; q public.cs_character_promo_qa_checks; v_count int;
begin
 select * into p from public.cs_character_promo_delivery_plans where id=p_plan_id;
 select * into d from public.cs_character_promo_drafts where id=p.promo_id;
 if p.id is null or s is null then return false; end if;
 if not coalesce(s->>'version'='1' and s->>'planId'=p.id::text and s->>'promoId'=d.id::text
 and s->>'characterId'=d.character_id and p.character_id=d.character_id and d.character_id='keith'
 and d.intended_channel='truskoolcorp_metricool_brand_5373515' and d.status='script_approved' and p.status in ('blocked_assets','ready_for_delivery')
 and s->>'script'=d.spoken_script and length(trim(d.spoken_script))>0 and s->>'visualBrief'=d.visual_brief
 and (s->>'durationSeconds')::int=d.duration_seconds and d.duration_seconds between 8 and 45
 and s->>'audioPath' is not distinct from d.audio_asset_path
 and s->>'videoPath'=d.video_asset_path and s->>'videoSha256' ~ '^[a-f0-9]{64}$'
 and d.video_asset_path='character-promos/'||d.character_id||'/'||d.id::text||'/'||(s->>'videoSha256')||'.mp4'
 and (s->>'videoBytes')::int between 16 and 36700160
 and s->>'caption'=p.caption and length(trim(p.caption))>0 and length(p.caption)<=500
 and (s->>'scheduledAt')::timestamptz=p.scheduled_at and p.scheduled_at>clock_timestamp()+interval '60 seconds'
 and s->>'network'=p.network and s->>'accountId'=p.account_id and d.actual_social_account='metricool-brand:5373515'
 and ((p.network='facebook' and p.account_id='146219355471397') or (p.network='threads' and p.account_id='truskoolcorp'))
 and s->>'brandId'='5373515' and s->>'userId'='4174093' and length(s->>'timezone')>0
 and s#>>'{canon,rightsStatus}'='approved' and s#>>'{canon,voiceStatus}'='canonical' and (s#>>'{canon,productionReady}')::boolean=true
 and s#>>'{canon,revisionSha256}' ~ '^[a-f0-9]{64}$'
 and length(s#>>'{canon,assetId}')>0 and s#>>'{canon,portraitSha256}' ~ '^[a-f0-9]{64}$' and length(s#>>'{canon,voiceId}')>0
 and jsonb_array_length(s->'qa')=9,false) then return false; end if;
 select count(*) into v_count from public.cs_character_promo_qa_checks where promo_id=d.id and video_sha256=s->>'videoSha256' and result='pass';
 if v_count<>9 then return false; end if;
 for q in select * from jsonb_populate_recordset(null::public.cs_character_promo_qa_checks,s->'qa') loop
   if q.promo_id is distinct from d.id or q.video_sha256 is distinct from s->>'videoSha256' or q.result is distinct from 'pass'
    or not exists(select 1 from public.cs_character_promo_qa_checks z where z is not distinct from q) then return false; end if;
 end loop;
 if (select count(distinct x->>'check_name') from jsonb_array_elements(s->'qa') x)<>9 then return false; end if;
 if not cs_promo_private.watermark_valid(d.id,s->>'videoSha256') then return false; end if;
 return true;
exception when others then return false;
end $$;
create or replace function public.cs_record_character_promo_qa_observation(
 p_promo_id uuid,p_video_sha256 text,p_draft_revision timestamptz,
 p_check_name text,p_result text,p_evidence text,p_expected_observation jsonb,p_actor uuid
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare d public.cs_character_promo_drafts; prior public.cs_character_promo_qa_checks;
 expected public.cs_character_promo_qa_checks; saved public.cs_character_promo_qa_checks;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'QA observations require READ COMMITTED'; end if;
 -- Actor comes only from fresh server auth.getUser(), never request JSON.
 -- QA reviewer scope intentionally differs from final owner consent scope.
 if not exists(select 1 from auth.users where id=p_actor and raw_app_meta_data->'cafe_sativa_admin'='true'::jsonb) then raise exception 'Verified content admin required'; end if;
 select * into d from public.cs_character_promo_drafts where id=p_promo_id for update;
 -- A new READ COMMITTED statement after the potentially waited parent lock.
 if not exists(select 1 from auth.users where id=p_actor and raw_app_meta_data->'cafe_sativa_admin'='true'::jsonb) then raise exception 'Verified content admin required'; end if;
 if not coalesce(d.id is not null and p_video_sha256 ~ '^[a-f0-9]{64}$'
 and d.updated_at=p_draft_revision
 and d.video_asset_path='character-promos/'||d.character_id||'/'||d.id::text||'/'||p_video_sha256||'.mp4'
 and p_check_name in ('mp4_integrity','canonical_likeness','canonical_speech','lip_sync','visual_text','rights','duration','brand_safety','third_party_watermark')
 and p_result in ('pass','fail','needs_review') and length(btrim(p_evidence))>0 and length(p_evidence)<=1000,false)
 or exists(select 1 from cs_promo_private.attempts a join public.cs_character_promo_delivery_plans p on p.id=a.plan_id where p.promo_id=d.id) then return null; end if;
 select * into prior from public.cs_character_promo_qa_checks where promo_id=d.id and video_sha256=p_video_sha256 and check_name=p_check_name;
 if p_expected_observation is null then
  if prior.id is not null then return null; end if;
 else
  if jsonb_typeof(p_expected_observation)<>'object' then return null; end if;
  if (select array_agg(k order by k) from jsonb_object_keys(p_expected_observation) k)
   is distinct from array['check_name','created_at','evidence','id','promo_id','result','reviewer_id','video_sha256']::text[] then return null; end if;
  begin
   expected:=jsonb_populate_record(null::public.cs_character_promo_qa_checks,p_expected_observation);
  exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format then return null;
  end;
  if prior.id is null or prior is distinct from expected then return null; end if;
 end if;
 if prior.id is null then
  insert into public.cs_character_promo_qa_checks(promo_id,video_sha256,check_name,result,evidence,reviewer_id,created_at)
  values(d.id,p_video_sha256,p_check_name,p_result,p_evidence,p_actor,clock_timestamp()) returning * into saved;
 else
  update public.cs_character_promo_qa_checks set result=p_result,evidence=p_evidence,reviewer_id=p_actor,created_at=clock_timestamp()
  where id=prior.id returning * into saved;
 end if;
 -- Existing QA source trigger invalidates consent. Never write draft approval stamps.
 return to_jsonb(saved);
end $$;
commit;
