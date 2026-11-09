-- OFFLINE PROPOSAL ONLY. Not a migration. Requires separate action-time deployment approval.
-- Run transactionally as migration owner after reviewing ownership/grants and owner identity gate.
begin;
create schema cs_promo_private;
revoke all on schema cs_promo_private from public, anon, authenticated, service_role;
alter table public.cs_character_promo_delivery_plans add column caption text;
create table cs_promo_private.owners(actor uuid primary key, enabled boolean not null default true);
-- Intentionally empty. No existing draft or nullable timestamp grants delivery approval.
create table cs_promo_private.approvals(
 plan_id uuid primary key references public.cs_character_promo_delivery_plans(id),
 snapshot jsonb not null, digest text not null check(digest ~ '^[a-f0-9]{64}$'),
 approved_by uuid not null references cs_promo_private.owners(actor), approved_at timestamptz not null,
 source_state jsonb not null, invalidated boolean not null default false
);
create table cs_promo_private.attempts(
 plan_id uuid primary key references cs_promo_private.approvals(plan_id),
 token uuid not null unique default gen_random_uuid(),
 state text not null check(state in ('submitting','submission_unknown','scheduled')),
 receipt jsonb, claimed_at timestamptz not null default clock_timestamp(),
 check ((state='scheduled')=(receipt is not null))
);
revoke all on all tables in schema cs_promo_private from public,anon,authenticated,service_role;

create function cs_promo_private.source_state(p_plan_id uuid) returns jsonb
language sql stable set search_path=pg_catalog as $$
 select jsonb_build_object('draft',to_jsonb(d),'plan',to_jsonb(p),'qa',
 coalesce((select jsonb_agg(to_jsonb(q) order by q.id) from public.cs_character_promo_qa_checks q where q.promo_id=d.id),'[]'::jsonb))
 from public.cs_character_promo_delivery_plans p join public.cs_character_promo_drafts d on d.id=p.promo_id where p.id=p_plan_id
$$;

-- Parent draft row serializes every source mutation, approval, and claim, including QA phantoms.
create function cs_promo_private.guard_source() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
declare v_id uuid;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'Promo mutations require READ COMMITTED'; end if;
 if tg_table_name='cs_character_promo_drafts' then v_id:=old.id;
 else
   if tg_op='UPDATE' and new.promo_id is distinct from old.promo_id then raise exception 'Promo ownership is immutable'; end if;
   if tg_op='DELETE' then v_id:=old.promo_id; else v_id:=new.promo_id; end if;
 end if;
 perform 1 from public.cs_character_promo_drafts where id=v_id for update;
 if exists(select 1 from cs_promo_private.attempts a join public.cs_character_promo_delivery_plans p on p.id=a.plan_id where p.promo_id=v_id) then
   raise exception 'Claimed promo is frozen; manual reconciliation required';
 end if;
 update cs_promo_private.approvals a set invalidated=true from public.cs_character_promo_delivery_plans p where p.id=a.plan_id and p.promo_id=v_id;
 if tg_op='DELETE' then return old; else return new; end if;
end $$;
create trigger cs_promo_draft_guard before update or delete on public.cs_character_promo_drafts for each row execute function cs_promo_private.guard_source();
create trigger cs_promo_plan_guard before insert or update or delete on public.cs_character_promo_delivery_plans for each row execute function cs_promo_private.guard_source();
create trigger cs_promo_qa_guard before insert or update or delete on public.cs_character_promo_qa_checks for each row execute function cs_promo_private.guard_source();

-- Validates SQL-owned facts. External bytes, canonical rights and live provider connection
-- require fresh trusted server verification; SQL does not pretend to verify external services.
create function cs_promo_private.validate_snapshot(p_plan_id uuid,s jsonb) returns boolean
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
 and jsonb_array_length(s->'qa')=8,false) then return false; end if;
 select count(*) into v_count from public.cs_character_promo_qa_checks where promo_id=d.id and video_sha256=s->>'videoSha256' and result='pass';
 if v_count<>8 then return false; end if;
 for q in select * from jsonb_populate_recordset(null::public.cs_character_promo_qa_checks,s->'qa') loop
   if q.promo_id is distinct from d.id or q.video_sha256 is distinct from s->>'videoSha256' or q.result is distinct from 'pass'
    or not exists(select 1 from public.cs_character_promo_qa_checks z where z is not distinct from q) then return false; end if;
 end loop;
 if (select count(distinct x->>'check_name') from jsonb_array_elements(s->'qa') x)<>8 then return false; end if;
 return true;
exception when others then return false;
end $$;

-- Only a trusted server owner-confirmation action may invoke this. p_actor MUST be
-- derived by fresh auth.getUser(), never request JSON. SQL independently checks the
-- current auth.users admin metadata and explicit owner allowlist (initially empty).
-- p_approved_at is explicit action evidence, not inferred from draft timestamps.
create function public.cs_approve_character_promo(p_plan_id uuid,p_digest text,p_snapshot jsonb,p_approved_at timestamptz,p_actor uuid) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
declare v_actor uuid:=p_actor; v_promo uuid;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'Promo approval requires READ COMMITTED'; end if;
 if v_actor is null or not exists(select 1 from cs_promo_private.owners where actor=v_actor and enabled) or not exists(select 1 from auth.users where id=v_actor and raw_app_meta_data->>'cafe_sativa_admin'='true') then raise exception 'Verified owner required'; end if;
 select promo_id into v_promo from public.cs_character_promo_delivery_plans where id=p_plan_id;
 perform 1 from public.cs_character_promo_drafts where id=v_promo for update;
 if p_approved_at is null or p_approved_at>clock_timestamp() or p_approved_at<clock_timestamp()-interval '60 seconds'
 or p_approved_at<greatest((p_snapshot#>>'{approvals,voice}')::timestamptz,(p_snapshot#>>'{approvals,video}')::timestamptz,(p_snapshot#>>'{approvals,publication}')::timestamptz)
 or not cs_promo_private.validate_snapshot(p_plan_id,p_snapshot) then return false; end if;
 insert into cs_promo_private.approvals(plan_id,snapshot,digest,approved_by,approved_at,source_state)
 values(p_plan_id,p_snapshot,p_digest,v_actor,p_approved_at,cs_promo_private.source_state(p_plan_id)) on conflict do nothing;
 return found;
end $$;

create function public.cs_claim_character_promo(p_plan_id uuid,p_digest text,p_snapshot jsonb) returns uuid
language plpgsql security definer set search_path=pg_catalog as $$
declare v_promo uuid; v_token uuid;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'Promo claim requires READ COMMITTED'; end if;
 select promo_id into v_promo from public.cs_character_promo_delivery_plans where id=p_plan_id;
 perform 1 from public.cs_character_promo_drafts where id=v_promo for update;
 if not exists(select 1 from cs_promo_private.approvals a where a.plan_id=p_plan_id and exists(select 1 from cs_promo_private.owners o join auth.users u on u.id=o.actor where o.actor=a.approved_by and o.enabled and u.raw_app_meta_data->>'cafe_sativa_admin'='true') and not a.invalidated and a.digest=p_digest and a.snapshot=p_snapshot and a.source_state=cs_promo_private.source_state(p_plan_id))
 or not cs_promo_private.validate_snapshot(p_plan_id,p_snapshot) then return null; end if;
 insert into cs_promo_private.attempts(plan_id,state) values(p_plan_id,'submitting') on conflict do nothing returning token into v_token;
 return v_token;
end $$;

create function public.cs_finish_character_promo(p_plan_id uuid,p_token uuid,p_state text,p_receipt jsonb) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
declare s jsonb; d text;
begin
 select snapshot,digest into s,d from cs_promo_private.approvals where plan_id=p_plan_id;
 if p_state='scheduled' then
   if not coalesce(p_receipt->>'state'='scheduled' and length(p_receipt->>'providerId')>0 and length(p_receipt->>'providerUuid')>0
    and p_receipt->>'snapshotDigest'=d and p_receipt->>'videoSha256'=s->>'videoSha256'
    and p_receipt->>'network'=s->>'network' and p_receipt->>'accountId'=s->>'accountId'
    and p_receipt->>'brandId'=s->>'brandId' and p_receipt->>'userId'=s->>'userId'
    and p_receipt->>'caption'=s->>'caption' and p_receipt->>'scheduledAt'=s->>'scheduledAt'
    and p_receipt->>'timezone'=s->>'timezone',false) then return false; end if;
 elsif p_state<>'submission_unknown' or p_receipt is not null then return false; end if;
 update cs_promo_private.attempts set state=p_state,receipt=p_receipt where plan_id=p_plan_id and token=p_token and state='submitting';
 return found;
end $$;
-- Server-only read for the dormant executor, never expose the private ledger directly.
create function public.cs_read_character_promo_approval(p_plan_id uuid) returns jsonb
language sql stable security definer set search_path=pg_catalog as $$
 select jsonb_build_object('snapshot',a.snapshot,'digest',a.digest,'approvedBy',a.approved_by,'approvedAt',a.approved_at,'revokedAt',null)
 from cs_promo_private.approvals a
 join cs_promo_private.owners o on o.actor=a.approved_by
 join auth.users u on u.id=o.actor
 where a.plan_id=p_plan_id and o.enabled and not a.invalidated and u.raw_app_meta_data->>'cafe_sativa_admin'='true'
$$;
revoke all on function public.cs_read_character_promo_approval(uuid) from public,anon,authenticated;
grant execute on function public.cs_read_character_promo_approval(uuid) to service_role;
-- No exposed private helper or tables. Owner retains object ownership; service receives
-- only the four RPCs, never direct mutation of approvals/attempts or private schema usage.
revoke all on all functions in schema cs_promo_private from public,anon,authenticated,service_role;
revoke all on function public.cs_approve_character_promo(uuid,text,jsonb,timestamptz,uuid),public.cs_claim_character_promo(uuid,text,jsonb),public.cs_finish_character_promo(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.cs_approve_character_promo(uuid,text,jsonb,timestamptz,uuid),public.cs_claim_character_promo(uuid,text,jsonb),public.cs_finish_character_promo(uuid,uuid,text,jsonb) to service_role;
commit;
