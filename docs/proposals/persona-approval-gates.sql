-- OFFLINE ONLY: apply only after separately reviewed persona-delivery-ledger.sql.
-- New source-gate proposal, NOT an auto migration, route, or provider activation.
begin;
alter table cs_promo_private.owners add column revocation_epoch bigint not null default 0 check(revocation_epoch>=0);
create table cs_promo_private.review_versions(
 id uuid primary key default gen_random_uuid(), plan_id uuid not null references public.cs_character_promo_delivery_plans(id),
 content jsonb not null, digest text not null, source_state jsonb not null,
 begun_by uuid not null references cs_promo_private.owners(actor), begun_epoch bigint not null, begun_at timestamptz not null default clock_timestamp(),
 invalidated boolean not null default false
);
create table cs_promo_private.review_heads(plan_id uuid primary key references public.cs_character_promo_delivery_plans(id),generation_id uuid not null references cs_promo_private.review_versions(id));
create table cs_promo_private.approval_history(id uuid primary key default gen_random_uuid(),plan_id uuid not null,generation_id uuid not null,approval jsonb not null,archived_at timestamptz not null default clock_timestamp());
alter table cs_promo_private.approvals add column review_generation_id uuid references cs_promo_private.review_versions(id);
alter table cs_promo_private.approvals add column approver_epoch bigint;
revoke all on cs_promo_private.review_versions,cs_promo_private.review_heads,cs_promo_private.approval_history from public,anon,authenticated,service_role;
create table cs_promo_private.gates(
 generation_id uuid not null references cs_promo_private.review_versions(id),
 plan_id uuid not null references public.cs_character_promo_delivery_plans(id),
 gate text not null check(gate in ('voice','video','publication')),
 content jsonb not null, digest text not null check(digest ~ '^[a-f0-9]{64}$'),
 confirmed_by uuid not null references cs_promo_private.owners(actor), confirmed_epoch bigint not null,
 confirmed_at timestamptz not null, source_state jsonb not null,
 invalidated boolean not null default false,
 draft_applied boolean not null default false, plan_applied boolean not null default false,
 primary key(generation_id,gate)
);
revoke all on cs_promo_private.gates from public,anon,authenticated,service_role;
create function cs_promo_private.actor_epoch_valid(p_actor uuid,p_epoch bigint) returns boolean
language sql stable set search_path=pg_catalog as $$
 select exists(select 1 from cs_promo_private.owners o join auth.users u on u.id=o.actor
 where o.actor=p_actor and o.enabled and o.revocation_epoch=p_epoch and u.raw_app_meta_data->'cafe_sativa_admin'='true'::jsonb)
$$;
create function cs_promo_private.gate_source_state(p_plan_id uuid) returns jsonb
language sql stable set search_path=pg_catalog as $$
 select jsonb_set(jsonb_set(s,'{draft}',(s->'draft')-array['updated_at','voice_approved_at','video_qa_approved_at','publication_approved_at']),'{plan}',(s->'plan')-'status')
 from (select cs_promo_private.source_state(p_plan_id) s) x
$$;
create function cs_promo_private.validate_gate_content(p_plan_id uuid,s jsonb) returns boolean
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

-- A pending private row exists only inside the atomic gate RPC. It authorizes exactly
-- one selected stamp/revision write, and publication's one ready-state transition.
-- No GUC/session bypass is used; service_role cannot insert or update pending rows.
create or replace function cs_promo_private.guard_source() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
declare v_id uuid; g cs_promo_private.gates; expected jsonb; column_name text;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'Promo mutations require READ COMMITTED'; end if;
 if tg_table_name='cs_character_promo_drafts' then v_id:=old.id;
 else
  if tg_op='UPDATE' and new.promo_id is distinct from old.promo_id then raise exception 'Promo ownership is immutable'; end if;
  if tg_op='DELETE' then v_id:=old.promo_id; else v_id:=new.promo_id; end if;
 end if;
 perform 1 from public.cs_character_promo_drafts where id=v_id for update;
 if exists(select 1 from cs_promo_private.attempts a join public.cs_character_promo_delivery_plans p on p.id=a.plan_id where p.promo_id=v_id) then raise exception 'Claimed promo is frozen; manual reconciliation required'; end if;
 if tg_op='UPDATE' and tg_table_name='cs_character_promo_drafts' then
  for g in select x.* from cs_promo_private.gates x join public.cs_character_promo_delivery_plans p on p.id=x.plan_id where p.promo_id=v_id and not x.draft_applied and not x.invalidated loop
   column_name:=case g.gate when 'voice' then 'voice_approved_at' when 'video' then 'video_qa_approved_at' else 'publication_approved_at' end;
   expected:=jsonb_set(jsonb_set(to_jsonb(old),array[column_name],to_jsonb(g.confirmed_at)),'{updated_at}',to_jsonb(g.confirmed_at));
   if to_jsonb(new)=expected then
    update cs_promo_private.approvals a set invalidated=true from public.cs_character_promo_delivery_plans p where p.id=a.plan_id and p.promo_id=v_id;
    update cs_promo_private.gates set draft_applied=true where generation_id=g.generation_id and gate=g.gate;
    return new;
   end if;
  end loop;
 end if;
 if tg_op='UPDATE' and tg_table_name='cs_character_promo_delivery_plans' then
  select x.* into g from cs_promo_private.gates x join cs_promo_private.review_heads h on h.generation_id=x.generation_id where x.plan_id=old.id and x.gate='publication' and x.draft_applied and not x.plan_applied and not x.invalidated;
  if found and to_jsonb(new)=jsonb_set(to_jsonb(old),'{status}','"ready_for_delivery"'::jsonb) then
   update cs_promo_private.gates set plan_applied=true where generation_id=g.generation_id and gate=g.gate;
   return new;
  end if;
 end if;
 update cs_promo_private.approvals a set invalidated=true from public.cs_character_promo_delivery_plans p where p.id=a.plan_id and p.promo_id=v_id;
 update cs_promo_private.review_versions r set invalidated=true from public.cs_character_promo_delivery_plans p where p.id=r.plan_id and p.promo_id=v_id;
 update cs_promo_private.gates x set invalidated=true from public.cs_character_promo_delivery_plans p where p.id=x.plan_id and p.promo_id=v_id;
 if tg_op='DELETE' then return old; else return new; end if;
end $$;

create function cs_promo_private.gate_valid(p_plan_id uuid,p_gate text,p_content jsonb,p_digest text) returns boolean
language sql stable set search_path=pg_catalog as $$
 select exists(select 1 from cs_promo_private.gates g
 join cs_promo_private.review_heads h on h.generation_id=g.generation_id and h.plan_id=g.plan_id
 join cs_promo_private.review_versions r on r.id=h.generation_id and not r.invalidated and cs_promo_private.actor_epoch_valid(r.begun_by,r.begun_epoch)
 join public.cs_character_promo_delivery_plans p on p.id=g.plan_id
 join public.cs_character_promo_drafts d on d.id=p.promo_id
 join cs_promo_private.owners o on o.actor=g.confirmed_by and o.enabled
 join auth.users u on u.id=o.actor and u.raw_app_meta_data->'cafe_sativa_admin'='true'::jsonb
 where g.plan_id=p_plan_id and g.gate=p_gate and not g.invalidated and g.draft_applied and g.plan_applied
 and g.confirmed_epoch=o.revocation_epoch and g.content=p_content and g.digest=p_digest and g.source_state=cs_promo_private.gate_source_state(p_plan_id)
)
$$;

create function public.cs_confirm_character_promo_gate(p_plan_id uuid,p_content jsonb,p_digest text,p_expected jsonb,p_gate text,p_actor uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare d public.cs_character_promo_drafts; p public.cs_character_promo_delivery_plans; at_time timestamptz; evidence jsonb; generation uuid; actor_epoch bigint;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'Promo gates require READ COMMITTED'; end if;
 select o.revocation_epoch into actor_epoch from cs_promo_private.owners o join auth.users u on u.id=o.actor where o.actor=p_actor and o.enabled and u.raw_app_meta_data->'cafe_sativa_admin'='true'::jsonb;
 if actor_epoch is null then raise exception 'Verified owner required'; end if;
 select * into p from public.cs_character_promo_delivery_plans where id=p_plan_id;
 select * into d from public.cs_character_promo_drafts where id=p.promo_id for update;
 if not cs_promo_private.actor_epoch_valid(p_actor,actor_epoch) then raise exception 'Verified owner required'; end if;
 -- Reread plan after parent lock, so a preceding waited-on mutation cannot disappear.
 select * into p from public.cs_character_promo_delivery_plans where id=p_plan_id;
 if p_gate is null or p_gate not in ('voice','video','publication') or p_digest is null or p_digest !~ '^[a-f0-9]{64}$'
 or not cs_promo_private.validate_gate_content(p_plan_id,p_content)
 or p_expected is null or (select count(*) from jsonb_object_keys(p_expected))<>6
 or not (p_expected ?& array['draftRevision','voiceApprovedAt','videoApprovedAt','publicationApprovedAt','planStatus','generationId'])
 or (p_expected->>'draftRevision')::timestamptz is distinct from d.updated_at
 or (p_expected->>'voiceApprovedAt')::timestamptz is distinct from d.voice_approved_at
 or (p_expected->>'videoApprovedAt')::timestamptz is distinct from d.video_qa_approved_at
 or (p_expected->>'publicationApprovedAt')::timestamptz is distinct from d.publication_approved_at
 or p_expected->>'planStatus' is distinct from p.status then return null; end if;
 select generation_id into generation from cs_promo_private.review_heads where plan_id=p_plan_id;
 if generation is null or (p_expected->>'generationId')::uuid is distinct from generation
 or not exists(select 1 from cs_promo_private.review_versions r where r.id=generation and not r.invalidated and cs_promo_private.actor_epoch_valid(r.begun_by,r.begun_epoch) and r.content=p_content and r.digest=p_digest and r.source_state=cs_promo_private.gate_source_state(p_plan_id)) then return null; end if;
 if exists(select 1 from cs_promo_private.attempts a join public.cs_character_promo_delivery_plans z on z.id=a.plan_id where z.promo_id=d.id) then return null; end if;
 if exists(select 1 from cs_promo_private.approvals a where a.plan_id=p_plan_id)
 or exists(select 1 from cs_promo_private.gates where generation_id=generation and gate=p_gate) then return null; end if;
 if p_gate in ('video','publication') and not cs_promo_private.gate_valid(p_plan_id,'voice',p_content,p_digest) then return null; end if;
 if p_gate='publication' and not cs_promo_private.gate_valid(p_plan_id,'video',p_content,p_digest) then return null; end if;
 at_time:=clock_timestamp();
 insert into cs_promo_private.gates(generation_id,plan_id,gate,content,digest,confirmed_by,confirmed_epoch,confirmed_at,source_state,plan_applied)
 values(generation,p_plan_id,p_gate,p_content,p_digest,p_actor,actor_epoch,at_time,cs_promo_private.gate_source_state(p_plan_id),p_gate<>'publication');
 update public.cs_character_promo_drafts set
 voice_approved_at=case when p_gate='voice' then at_time else voice_approved_at end,
 video_qa_approved_at=case when p_gate='video' then at_time else video_qa_approved_at end,
 publication_approved_at=case when p_gate='publication' then at_time else publication_approved_at end,
 updated_at=at_time where id=d.id;
 if p_gate='publication' then update public.cs_character_promo_delivery_plans set status='ready_for_delivery' where id=p_plan_id; end if;
 if not cs_promo_private.gate_valid(p_plan_id,p_gate,p_content,p_digest) then raise exception 'Gate transition did not persist exactly'; end if;
 return jsonb_build_object('generationId',generation,'gate',p_gate,'contentDigest',p_digest,'content',p_content,'confirmedBy',p_actor,'confirmedAt',at_time,'invalidated',false);
end $$;

create function public.cs_begin_character_promo_review(p_plan_id uuid,p_content jsonb,p_digest text,p_expected jsonb,p_actor uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare d public.cs_character_promo_drafts; p public.cs_character_promo_delivery_plans; prior uuid; generation uuid; actor_epoch bigint;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'Promo reviews require READ COMMITTED'; end if;
 select o.revocation_epoch into actor_epoch from cs_promo_private.owners o join auth.users u on u.id=o.actor where o.actor=p_actor and o.enabled and u.raw_app_meta_data->'cafe_sativa_admin'='true'::jsonb;
 if actor_epoch is null then raise exception 'Verified owner required'; end if;
 select * into p from public.cs_character_promo_delivery_plans where id=p_plan_id;
 select * into d from public.cs_character_promo_drafts where id=p.promo_id for update;
 if not cs_promo_private.actor_epoch_valid(p_actor,actor_epoch) then raise exception 'Verified owner required'; end if;
 select * into p from public.cs_character_promo_delivery_plans where id=p_plan_id;
 select generation_id into prior from cs_promo_private.review_heads where plan_id=p_plan_id;
 if p_digest is null or p_digest !~ '^[a-f0-9]{64}$' or not cs_promo_private.validate_gate_content(p_plan_id,p_content)
 or p_expected is null or (select count(*) from jsonb_object_keys(p_expected))<>6
 or not (p_expected ?& array['draftRevision','voiceApprovedAt','videoApprovedAt','publicationApprovedAt','planStatus','generationId'])
 or (p_expected->>'draftRevision')::timestamptz is distinct from d.updated_at
 or (p_expected->>'voiceApprovedAt')::timestamptz is distinct from d.voice_approved_at
 or (p_expected->>'videoApprovedAt')::timestamptz is distinct from d.video_qa_approved_at
 or (p_expected->>'publicationApprovedAt')::timestamptz is distinct from d.publication_approved_at
 or p_expected->>'planStatus' is distinct from p.status or (p_expected->>'generationId')::uuid is distinct from prior then return null; end if;
 if exists(select 1 from cs_promo_private.attempts a join public.cs_character_promo_delivery_plans z on z.id=a.plan_id where z.promo_id=d.id) then return null; end if;
 -- Archive exact immutable approval evidence before clearing only the unclaimed slot.
 -- Legacy approvals without a generation are not silently adopted/reset by this slice.
 if exists(select 1 from cs_promo_private.approvals where plan_id=p_plan_id and review_generation_id is null) then return null; end if;
 insert into cs_promo_private.approval_history(plan_id,generation_id,approval)
 select plan_id,review_generation_id,to_jsonb(a) from cs_promo_private.approvals a where plan_id=p_plan_id;
 delete from cs_promo_private.approvals where plan_id=p_plan_id;
 insert into cs_promo_private.review_versions(plan_id,content,digest,source_state,begun_by,begun_epoch)
 values(p_plan_id,p_content,p_digest,cs_promo_private.gate_source_state(p_plan_id),p_actor,actor_epoch) returning id into generation;
 insert into cs_promo_private.review_heads(plan_id,generation_id) values(p_plan_id,generation)
 on conflict(plan_id) do update set generation_id=excluded.generation_id;
 -- Historical timestamps intentionally remain visible but grant nothing in new generation.
 return public.cs_read_character_promo_gates(p_plan_id);
end $$;

create or replace function public.cs_approve_character_promo(p_plan_id uuid,p_digest text,p_snapshot jsonb,p_approved_at timestamptz,p_actor uuid) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
declare v_actor uuid:=p_actor; v_promo uuid; generation uuid; content jsonb; content_digest text; actor_epoch bigint;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'Promo approval requires READ COMMITTED'; end if;
 select o.revocation_epoch into actor_epoch from cs_promo_private.owners o join auth.users u on u.id=o.actor where o.actor=v_actor and o.enabled and u.raw_app_meta_data->'cafe_sativa_admin'='true'::jsonb;
 if actor_epoch is null then raise exception 'Verified owner required'; end if;
 select promo_id into v_promo from public.cs_character_promo_delivery_plans where id=p_plan_id;
 perform 1 from public.cs_character_promo_drafts where id=v_promo for update;
 if not cs_promo_private.actor_epoch_valid(v_actor,actor_epoch) then raise exception 'Verified owner required'; end if;
 select h.generation_id,r.digest into generation,content_digest from cs_promo_private.review_heads h join cs_promo_private.review_versions r on r.id=h.generation_id where h.plan_id=p_plan_id and not r.invalidated;
 content:=p_snapshot-array['approvals','draftRevision'];
 if generation is null or not cs_promo_private.gate_valid(p_plan_id,'voice',content,content_digest)
 or not cs_promo_private.gate_valid(p_plan_id,'video',content,content_digest)
 or not cs_promo_private.gate_valid(p_plan_id,'publication',content,content_digest) then return false; end if;
 if p_approved_at is null or p_approved_at>clock_timestamp() or p_approved_at<clock_timestamp()-interval '60 seconds'
 or p_approved_at<greatest((p_snapshot#>>'{approvals,voice}')::timestamptz,(p_snapshot#>>'{approvals,video}')::timestamptz,(p_snapshot#>>'{approvals,publication}')::timestamptz)
 or not cs_promo_private.validate_snapshot(p_plan_id,p_snapshot) then return false; end if;
 -- A NEW explicit final confirmation may refresh only a stale approval in the same
 -- valid generation. Preserve exact prior evidence and never reset a durable attempt.
 if exists(select 1 from cs_promo_private.attempts a join public.cs_character_promo_delivery_plans p on p.id=a.plan_id where p.promo_id=v_promo) then return false; end if;
 if exists(select 1 from cs_promo_private.approvals where plan_id=p_plan_id) then
  if not exists(select 1 from cs_promo_private.approvals where plan_id=p_plan_id and review_generation_id=generation and (invalidated or snapshot is distinct from p_snapshot or source_state is distinct from cs_promo_private.source_state(p_plan_id))) then return false; end if;
  insert into cs_promo_private.approval_history(plan_id,generation_id,approval) select plan_id,review_generation_id,to_jsonb(a) from cs_promo_private.approvals a where plan_id=p_plan_id;
  delete from cs_promo_private.approvals where plan_id=p_plan_id;
 end if;
 insert into cs_promo_private.approvals(plan_id,snapshot,digest,approved_by,approved_at,source_state,review_generation_id,approver_epoch)
 values(p_plan_id,p_snapshot,p_digest,v_actor,p_approved_at,cs_promo_private.source_state(p_plan_id),generation,actor_epoch) on conflict do nothing;
 return found;
end $$;

create function cs_promo_private.plan_delivery_ready(p_plan_id uuid) returns boolean
language sql stable set search_path=pg_catalog as $$
 select exists(select 1 from cs_promo_private.approvals a join cs_promo_private.review_heads h on h.plan_id=a.plan_id and h.generation_id=a.review_generation_id
 join cs_promo_private.review_versions r on r.id=h.generation_id and not r.invalidated
 join cs_promo_private.owners o on o.actor=a.approved_by and o.enabled
 join auth.users u on u.id=o.actor and u.raw_app_meta_data->'cafe_sativa_admin'='true'::jsonb
 where a.plan_id=p_plan_id and a.approver_epoch=o.revocation_epoch and not a.invalidated and a.source_state=cs_promo_private.source_state(p_plan_id)
 and cs_promo_private.validate_snapshot(p_plan_id,a.snapshot)
 and cs_promo_private.gate_valid(p_plan_id,'voice',a.snapshot-array['approvals','draftRevision'],r.digest)
 and cs_promo_private.gate_valid(p_plan_id,'video',a.snapshot-array['approvals','draftRevision'],r.digest)
 and cs_promo_private.gate_valid(p_plan_id,'publication',a.snapshot-array['approvals','draftRevision'],r.digest))
$$;
create or replace function public.cs_claim_character_promo(p_plan_id uuid,p_digest text,p_snapshot jsonb) returns uuid
language plpgsql security definer set search_path=pg_catalog as $$
declare v_promo uuid; v_token uuid;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'Promo claim requires READ COMMITTED'; end if;
 select promo_id into v_promo from public.cs_character_promo_delivery_plans where id=p_plan_id;
 perform 1 from public.cs_character_promo_drafts where id=v_promo for update;
 if not exists(select 1 from cs_promo_private.attempts a join public.cs_character_promo_delivery_plans p on p.id=a.plan_id where p.promo_id=v_promo)
 and exists(select 1 from public.cs_character_promo_delivery_plans p where p.promo_id=v_promo and not cs_promo_private.plan_delivery_ready(p.id)) then return null; end if;
 if not exists(select 1 from cs_promo_private.approvals a where a.plan_id=p_plan_id and a.review_generation_id=(select generation_id from cs_promo_private.review_heads where plan_id=p_plan_id) and exists(select 1 from cs_promo_private.review_versions r where r.id=a.review_generation_id and not r.invalidated and cs_promo_private.gate_valid(p_plan_id,'voice',a.snapshot-array['approvals','draftRevision'],r.digest) and cs_promo_private.gate_valid(p_plan_id,'video',a.snapshot-array['approvals','draftRevision'],r.digest) and cs_promo_private.gate_valid(p_plan_id,'publication',a.snapshot-array['approvals','draftRevision'],r.digest)) and exists(select 1 from cs_promo_private.owners o join auth.users u on u.id=o.actor where o.actor=a.approved_by and o.enabled and o.revocation_epoch=a.approver_epoch and u.raw_app_meta_data->'cafe_sativa_admin'='true'::jsonb) and not a.invalidated and a.digest=p_digest and a.snapshot=p_snapshot and a.source_state=cs_promo_private.source_state(p_plan_id))
 or not cs_promo_private.validate_snapshot(p_plan_id,p_snapshot) then return null; end if;
 insert into cs_promo_private.attempts(plan_id,state) values(p_plan_id,'submitting') on conflict do nothing returning token into v_token;
 return v_token;
end $$;

create or replace function public.cs_read_character_promo_approval(p_plan_id uuid) returns jsonb
language sql stable security definer set search_path=pg_catalog as $$
 select jsonb_build_object('snapshot',a.snapshot,'digest',a.digest,'approvedBy',a.approved_by,'approvedAt',a.approved_at,'revokedAt',null)
 from cs_promo_private.approvals a
 join cs_promo_private.owners o on o.actor=a.approved_by
 join auth.users u on u.id=o.actor
 where a.plan_id=p_plan_id and a.review_generation_id=(select generation_id from cs_promo_private.review_heads where plan_id=p_plan_id) and exists(select 1 from cs_promo_private.review_versions r where r.id=a.review_generation_id and not r.invalidated and cs_promo_private.gate_valid(p_plan_id,'voice',a.snapshot-array['approvals','draftRevision'],r.digest) and cs_promo_private.gate_valid(p_plan_id,'video',a.snapshot-array['approvals','draftRevision'],r.digest) and cs_promo_private.gate_valid(p_plan_id,'publication',a.snapshot-array['approvals','draftRevision'],r.digest)) and o.enabled and o.revocation_epoch=a.approver_epoch and not a.invalidated and u.raw_app_meta_data->'cafe_sativa_admin'='true'::jsonb
$$;

create or replace function public.cs_read_character_promo_gates(p_plan_id uuid) returns jsonb
language sql stable security definer set search_path=pg_catalog as $$
 select jsonb_build_object('generationId',r.id,'invalidated',case when r.id is null then false else r.invalidated or not cs_promo_private.actor_epoch_valid(r.begun_by,r.begun_epoch) or r.source_state is distinct from cs_promo_private.gate_source_state(p_plan_id) end,'ownDeliveryApprovalCurrent',cs_promo_private.plan_delivery_ready(p_plan_id),
 'hasSharedAttempt',exists(select 1 from cs_promo_private.attempts a join public.cs_character_promo_delivery_plans ap on ap.id=a.plan_id where ap.promo_id=(select promo_id from public.cs_character_promo_delivery_plans where id=p_plan_id)),
 'pendingSiblingGatePlans',(select count(*) from public.cs_character_promo_delivery_plans sp where sp.id<>p_plan_id and not exists(select 1 from cs_promo_private.attempts a where a.plan_id=sp.id) and sp.promo_id=(select promo_id from public.cs_character_promo_delivery_plans where id=p_plan_id) and not exists(select 1 from cs_promo_private.review_heads sh join cs_promo_private.review_versions sr on sr.id=sh.generation_id where sh.plan_id=sp.id and not sr.invalidated and cs_promo_private.gate_valid(sp.id,'voice',sr.content,sr.digest) and cs_promo_private.gate_valid(sp.id,'video',sr.content,sr.digest) and cs_promo_private.gate_valid(sp.id,'publication',sr.content,sr.digest))),
 'pendingSiblingDeliveryApprovals',(select count(*) from public.cs_character_promo_delivery_plans sp where sp.id<>p_plan_id and not exists(select 1 from cs_promo_private.attempts a where a.plan_id=sp.id) and sp.promo_id=(select promo_id from public.cs_character_promo_delivery_plans where id=p_plan_id) and not cs_promo_private.plan_delivery_ready(sp.id)),
 'gates',
 coalesce((select jsonb_agg(jsonb_build_object('generationId',g.generation_id,'gate',g.gate,'contentDigest',g.digest,'content',g.content,'confirmedBy',g.confirmed_by,'confirmedAt',g.confirmed_at,'invalidated',not cs_promo_private.gate_valid(p_plan_id,g.gate,g.content,g.digest)) order by g.confirmed_at) from cs_promo_private.gates g where g.generation_id=r.id),'[]'::jsonb))
 from (select 1) seed left join cs_promo_private.review_heads h on h.plan_id=p_plan_id left join cs_promo_private.review_versions r on r.id=h.generation_id
$$;

revoke all on all functions in schema cs_promo_private from public,anon,authenticated,service_role;
revoke all on function public.cs_begin_character_promo_review(uuid,jsonb,text,jsonb,uuid),public.cs_confirm_character_promo_gate(uuid,jsonb,text,jsonb,text,uuid),public.cs_read_character_promo_gates(uuid) from public,anon,authenticated;
grant execute on function public.cs_begin_character_promo_review(uuid,jsonb,text,jsonb,uuid),public.cs_confirm_character_promo_gate(uuid,jsonb,text,jsonb,text,uuid),public.cs_read_character_promo_gates(uuid) to service_role;
commit;
