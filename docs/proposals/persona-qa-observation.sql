-- OFFLINE PROPOSAL ONLY. Requires ledger + approval gates + owner revocation.
-- No migration, activation, automatic QA result or final approval.
begin;
create function public.cs_record_character_promo_qa_observation(
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
 and p_check_name in ('mp4_integrity','canonical_likeness','canonical_speech','lip_sync','visual_text','rights','duration','brand_safety')
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
revoke all on function public.cs_record_character_promo_qa_observation(uuid,text,timestamptz,text,text,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.cs_record_character_promo_qa_observation(uuid,text,timestamptz,text,text,text,jsonb,uuid) to service_role;
commit;
