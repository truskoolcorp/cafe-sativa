-- OFFLINE ONLY. Separate from frozen gate/approval artifacts and production rollout.
-- Apply after ledger, gates, sticky revocation. Review tickets are explicit POST-style
-- actions, never ordinary GET/prefetch. No provider calls, cancellation, or dispatch.
begin;
create table cs_promo_private.plan_controls(
 plan_id uuid primary key references public.cs_character_promo_delivery_plans(id),
 withdrawn boolean not null, revision bigint not null check(revision>0),
 changed_by uuid not null references cs_promo_private.owners(actor), changed_at timestamptz not null
);
create table cs_promo_private.plan_control_reviews(
 id uuid primary key, actor uuid not null references cs_promo_private.owners(actor), actor_epoch bigint not null,
 snapshot jsonb not null, digest text not null, reviewed_at timestamptz not null default clock_timestamp(),
 confirmed_at timestamptz, result jsonb
);
create table cs_promo_private.plan_control_events(
 id uuid primary key default gen_random_uuid(), review_id uuid not null unique references cs_promo_private.plan_control_reviews(id),
 plan_id uuid not null references public.cs_character_promo_delivery_plans(id), action text not null check(action in ('withdraw','restore')),
 actor uuid not null references cs_promo_private.owners(actor), actor_epoch bigint not null, confirmed_at timestamptz not null,
 before_cohort jsonb not null, after_cohort jsonb not null
);
revoke all on cs_promo_private.plan_controls,cs_promo_private.plan_control_reviews,cs_promo_private.plan_control_events from public,anon,authenticated,service_role;
create function cs_promo_private.plan_withdrawn(p_plan_id uuid) returns boolean
language sql stable set search_path=pg_catalog as $$
 select coalesce((select withdrawn from cs_promo_private.plan_controls where plan_id=p_plan_id),false)
$$;
-- Exact cohort CAS includes plan fields/control revisions, NOT sibling attempt
-- progression. A sibling starting does not prevent stopping an unattempted target.
create function cs_promo_private.plan_control_cohort(p_plan_id uuid) returns jsonb
language sql stable set search_path=pg_catalog as $$
 select coalesce(jsonb_agg(jsonb_build_object('plan',jsonb_build_object('id',p.id,'promo_id',p.promo_id,'character_id',p.character_id,'network',p.network,'account_id',p.account_id,'caption',p.caption,'scheduled_at',p.scheduled_at,'status',p.status),'withdrawn',coalesce(c.withdrawn,false),'controlRevision',coalesce(c.revision,0)) order by p.id),'[]'::jsonb)
 from public.cs_character_promo_delivery_plans p left join cs_promo_private.plan_controls c on c.plan_id=p.id
 where p.promo_id=(select promo_id from public.cs_character_promo_delivery_plans where id=p_plan_id)
$$;
create function public.cs_read_character_promo_plan_controls(p_plan_id uuid) returns jsonb
language sql stable security definer set search_path=pg_catalog as $$
 select jsonb_build_object('planId',p_plan_id,'withdrawn',cs_promo_private.plan_withdrawn(p_plan_id),
 'targetAttemptState',(select state from cs_promo_private.attempts where plan_id=p_plan_id),
 'hasSharedAttempt',exists(select 1 from cs_promo_private.attempts a join public.cs_character_promo_delivery_plans p on p.id=a.plan_id where p.promo_id=(select promo_id from public.cs_character_promo_delivery_plans where id=p_plan_id)),
 'cohort',coalesce((select jsonb_agg(jsonb_build_object('planId',p.id,'network',p.network,'accountId',p.account_id,'caption',p.caption,'scheduledAt',p.scheduled_at,'withdrawn',coalesce(c.withdrawn,false),'controlRevision',coalesce(c.revision,0),'attemptState',a.state) order by p.id) from public.cs_character_promo_delivery_plans p left join cs_promo_private.plan_controls c on c.plan_id=p.id left join cs_promo_private.attempts a on a.plan_id=p.id where p.promo_id=(select promo_id from public.cs_character_promo_delivery_plans where id=p_plan_id)),'[]'::jsonb))
$$;

create function public.cs_review_character_promo_plan_control(p_plan_id uuid,p_action text,p_actor uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare p public.cs_character_promo_delivery_plans; epoch bigint; review_id uuid:=gen_random_uuid(); s jsonb; hash text;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'Plan controls require READ COMMITTED'; end if;
 select o.revocation_epoch into epoch from cs_promo_private.owners o join auth.users u on u.id=o.actor where o.actor=p_actor and o.enabled and u.raw_app_meta_data->'cafe_sativa_admin'='true'::jsonb;
 if epoch is null then raise exception 'Verified owner required'; end if;
 select * into p from public.cs_character_promo_delivery_plans where id=p_plan_id;
 perform 1 from public.cs_character_promo_drafts where id=p.promo_id for update;
 if not cs_promo_private.actor_epoch_valid(p_actor,epoch) then raise exception 'Verified owner required'; end if;
 select * into p from public.cs_character_promo_delivery_plans where id=p_plan_id;
 if p.id is null or p_action is null or p_action not in ('withdraw','restore') then return null; end if;
 if exists(select 1 from cs_promo_private.attempts where plan_id=p_plan_id) then return jsonb_build_object('status','reconciliation_required','planId',p_plan_id,'providerCancelled',false); end if;
 if p_action='restore' and exists(select 1 from cs_promo_private.attempts a join public.cs_character_promo_delivery_plans z on z.id=a.plan_id where z.promo_id=p.promo_id) then return jsonb_build_object('status','shared_dispatch_started','planId',p_plan_id,'providerCancelled',false); end if;
 if cs_promo_private.plan_withdrawn(p_plan_id)=(p_action='withdraw') then return null; end if;
 s:=jsonb_build_object('version',1,'reviewId',review_id,'actor',p_actor,'actorEpoch',epoch,'planId',p_plan_id,'action',p_action,
 'expectedCohort',cs_promo_private.plan_control_cohort(p_plan_id),
 'effect',case when p_action='withdraw' then 'Stop this unattempted plan; other independently approved active plans may become eligible. No provider cancellation or dispatch.' else 'Restore this plan to the required cohort; prior consent remains invalid and a new explicit review is required. No dispatch.' end);
 hash:=encode(sha256(convert_to(s::text,'UTF8')),'hex');
 insert into cs_promo_private.plan_control_reviews(id,actor,actor_epoch,snapshot,digest) values(review_id,p_actor,epoch,s,hash);
 return jsonb_build_object('snapshot',s,'digest',hash);
end $$;

create function public.cs_save_character_promo_plan_control(p_snapshot jsonb,p_digest text,p_actor uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare r cs_promo_private.plan_control_reviews; p public.cs_character_promo_delivery_plans; epoch bigint; at_time timestamptz; action text; cohort_after jsonb; receipt jsonb;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'Plan controls require READ COMMITTED'; end if;
 select o.revocation_epoch into epoch from cs_promo_private.owners o join auth.users u on u.id=o.actor where o.actor=p_actor and o.enabled and u.raw_app_meta_data->'cafe_sativa_admin'='true'::jsonb;
 if epoch is null then raise exception 'Verified owner required'; end if;
 select * into r from cs_promo_private.plan_control_reviews where snapshot=p_snapshot and digest=p_digest and actor=p_actor and actor_epoch=epoch and confirmed_at is null;
 if r.id is null then return null; end if;
 select * into p from public.cs_character_promo_delivery_plans where id=(r.snapshot->>'planId')::uuid;
 perform 1 from public.cs_character_promo_drafts where id=p.promo_id for update;
 if not cs_promo_private.actor_epoch_valid(p_actor,epoch) then raise exception 'Verified owner required'; end if;
 select * into p from public.cs_character_promo_delivery_plans where id=(r.snapshot->>'planId')::uuid;
 if p.id is null then return null; end if;
 -- Target claim wins => no pretend cancellation, even if the preview was older.
 if exists(select 1 from cs_promo_private.attempts where plan_id=p.id) then return jsonb_build_object('status','reconciliation_required','planId',p.id,'providerCancelled',false); end if;
 action:=r.snapshot->>'action';
 if action='restore' and exists(select 1 from cs_promo_private.attempts a join public.cs_character_promo_delivery_plans z on z.id=a.plan_id where z.promo_id=p.promo_id) then return jsonb_build_object('status','shared_dispatch_started','planId',p.id,'providerCancelled',false); end if;
 if cs_promo_private.plan_control_cohort(p.id) is distinct from r.snapshot->'expectedCohort' or cs_promo_private.plan_withdrawn(p.id)=(action='withdraw') then return null; end if;
 at_time:=clock_timestamp();
 update cs_promo_private.plan_control_reviews set confirmed_at=at_time where id=r.id and confirmed_at is null;
 if not found then return null; end if;
 insert into cs_promo_private.plan_controls(plan_id,withdrawn,revision,changed_by,changed_at) values(p.id,action='withdraw',1,p_actor,at_time)
 on conflict(plan_id) do update set withdrawn=excluded.withdrawn,revision=cs_promo_private.plan_controls.revision+1,changed_by=excluded.changed_by,changed_at=excluded.changed_at;
 -- Only target consent metadata changes; source rows, siblings and attempts stay intact.
 update cs_promo_private.review_versions set invalidated=true where plan_id=p.id;
 update cs_promo_private.gates set invalidated=true where plan_id=p.id;
 update cs_promo_private.approvals set invalidated=true where plan_id=p.id;
 cohort_after:=cs_promo_private.plan_control_cohort(p.id);
 insert into cs_promo_private.plan_control_events(review_id,plan_id,action,actor,actor_epoch,confirmed_at,before_cohort,after_cohort)
 values(r.id,p.id,action,p_actor,epoch,at_time,r.snapshot->'expectedCohort',cohort_after);
 receipt:=jsonb_build_object('reviewId',r.id,'planId',p.id,'action',action,'withdrawn',action='withdraw','confirmedAt',at_time,'providerCancelled',false,'dispatched',false,'consentInvalidated',true,'reviewRequired',true,'generationStarted',false,'cohort',(public.cs_read_character_promo_plan_controls(p.id)->'cohort'));
 update cs_promo_private.plan_control_reviews set result=receipt where id=r.id;
 return receipt;
end $$;

-- Read-only reconciliation after an unknown save response; never auto-repeat save.
create function public.cs_read_character_promo_plan_control_result(p_review_id uuid,p_actor uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare epoch bigint;
begin
 select o.revocation_epoch into epoch from cs_promo_private.owners o join auth.users u on u.id=o.actor where o.actor=p_actor and o.enabled and u.raw_app_meta_data->'cafe_sativa_admin'='true'::jsonb;
 if epoch is null then raise exception 'Verified owner required'; end if;
 return (select result from cs_promo_private.plan_control_reviews where id=p_review_id and actor=p_actor);
end $$;

create or replace function public.cs_confirm_character_promo_gate(p_plan_id uuid,p_content jsonb,p_digest text,p_expected jsonb,p_gate text,p_actor uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare d public.cs_character_promo_drafts; p public.cs_character_promo_delivery_plans; at_time timestamptz; evidence jsonb; generation uuid; actor_epoch bigint;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'Promo gates require READ COMMITTED'; end if;
 select o.revocation_epoch into actor_epoch from cs_promo_private.owners o join auth.users u on u.id=o.actor where o.actor=p_actor and o.enabled and u.raw_app_meta_data->'cafe_sativa_admin'='true'::jsonb;
 if actor_epoch is null then raise exception 'Verified owner required'; end if;
 select * into p from public.cs_character_promo_delivery_plans where id=p_plan_id;
 select * into d from public.cs_character_promo_drafts where id=p.promo_id for update;
 if not cs_promo_private.actor_epoch_valid(p_actor,actor_epoch) then raise exception 'Verified owner required'; end if;
 if cs_promo_private.plan_withdrawn(p_plan_id) then return null; end if;
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

create or replace function public.cs_begin_character_promo_review(p_plan_id uuid,p_content jsonb,p_digest text,p_expected jsonb,p_actor uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare d public.cs_character_promo_drafts; p public.cs_character_promo_delivery_plans; prior uuid; generation uuid; actor_epoch bigint;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'Promo reviews require READ COMMITTED'; end if;
 select o.revocation_epoch into actor_epoch from cs_promo_private.owners o join auth.users u on u.id=o.actor where o.actor=p_actor and o.enabled and u.raw_app_meta_data->'cafe_sativa_admin'='true'::jsonb;
 if actor_epoch is null then raise exception 'Verified owner required'; end if;
 select * into p from public.cs_character_promo_delivery_plans where id=p_plan_id;
 select * into d from public.cs_character_promo_drafts where id=p.promo_id for update;
 if not cs_promo_private.actor_epoch_valid(p_actor,actor_epoch) then raise exception 'Verified owner required'; end if;
 if cs_promo_private.plan_withdrawn(p_plan_id) then return null; end if;
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
 if cs_promo_private.plan_withdrawn(p_plan_id) then return false; end if;
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

create or replace function public.cs_claim_character_promo(p_plan_id uuid,p_digest text,p_snapshot jsonb) returns uuid
language plpgsql security definer set search_path=pg_catalog as $$
declare v_promo uuid; v_token uuid;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'Promo claim requires READ COMMITTED'; end if;
 select promo_id into v_promo from public.cs_character_promo_delivery_plans where id=p_plan_id;
 perform 1 from public.cs_character_promo_drafts where id=v_promo for update;
 if cs_promo_private.plan_withdrawn(p_plan_id) then return null; end if;
 if not exists(select 1 from cs_promo_private.attempts a join public.cs_character_promo_delivery_plans p on p.id=a.plan_id where p.promo_id=v_promo)
 and exists(select 1 from public.cs_character_promo_delivery_plans p where p.promo_id=v_promo and not cs_promo_private.plan_withdrawn(p.id) and not cs_promo_private.plan_delivery_ready(p.id)) then return null; end if;
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
 where a.plan_id=p_plan_id and not cs_promo_private.plan_withdrawn(p_plan_id) and a.review_generation_id=(select generation_id from cs_promo_private.review_heads where plan_id=p_plan_id) and exists(select 1 from cs_promo_private.review_versions r where r.id=a.review_generation_id and not r.invalidated and cs_promo_private.gate_valid(p_plan_id,'voice',a.snapshot-array['approvals','draftRevision'],r.digest) and cs_promo_private.gate_valid(p_plan_id,'video',a.snapshot-array['approvals','draftRevision'],r.digest) and cs_promo_private.gate_valid(p_plan_id,'publication',a.snapshot-array['approvals','draftRevision'],r.digest)) and o.enabled and o.revocation_epoch=a.approver_epoch and not a.invalidated and u.raw_app_meta_data->'cafe_sativa_admin'='true'::jsonb
$$;

create or replace function public.cs_read_character_promo_gates(p_plan_id uuid) returns jsonb
language sql stable security definer set search_path=pg_catalog as $$
 select jsonb_build_object('withdrawn',cs_promo_private.plan_withdrawn(p_plan_id),'cohort',(public.cs_read_character_promo_plan_controls(p_plan_id)->'cohort'),'generationId',r.id,'invalidated',case when r.id is null then false else r.invalidated or not cs_promo_private.actor_epoch_valid(r.begun_by,r.begun_epoch) or r.source_state is distinct from cs_promo_private.gate_source_state(p_plan_id) end,'ownDeliveryApprovalCurrent',cs_promo_private.plan_delivery_ready(p_plan_id),
 'hasSharedAttempt',exists(select 1 from cs_promo_private.attempts a join public.cs_character_promo_delivery_plans ap on ap.id=a.plan_id where ap.promo_id=(select promo_id from public.cs_character_promo_delivery_plans where id=p_plan_id)),
 'pendingSiblingGatePlans',(select count(*) from public.cs_character_promo_delivery_plans sp where sp.id<>p_plan_id and not cs_promo_private.plan_withdrawn(sp.id) and not exists(select 1 from cs_promo_private.attempts a where a.plan_id=sp.id) and sp.promo_id=(select promo_id from public.cs_character_promo_delivery_plans where id=p_plan_id) and not exists(select 1 from cs_promo_private.review_heads sh join cs_promo_private.review_versions sr on sr.id=sh.generation_id where sh.plan_id=sp.id and not sr.invalidated and cs_promo_private.gate_valid(sp.id,'voice',sr.content,sr.digest) and cs_promo_private.gate_valid(sp.id,'video',sr.content,sr.digest) and cs_promo_private.gate_valid(sp.id,'publication',sr.content,sr.digest))),
 'pendingSiblingDeliveryApprovals',(select count(*) from public.cs_character_promo_delivery_plans sp where sp.id<>p_plan_id and not cs_promo_private.plan_withdrawn(sp.id) and not exists(select 1 from cs_promo_private.attempts a where a.plan_id=sp.id) and sp.promo_id=(select promo_id from public.cs_character_promo_delivery_plans where id=p_plan_id) and not cs_promo_private.plan_delivery_ready(sp.id)),
 'gates',
 coalesce((select jsonb_agg(jsonb_build_object('generationId',g.generation_id,'gate',g.gate,'contentDigest',g.digest,'content',g.content,'confirmedBy',g.confirmed_by,'confirmedAt',g.confirmed_at,'invalidated',not cs_promo_private.gate_valid(p_plan_id,g.gate,g.content,g.digest)) order by g.confirmed_at) from cs_promo_private.gates g where g.generation_id=r.id),'[]'::jsonb))
 from (select 1) seed left join cs_promo_private.review_heads h on h.plan_id=p_plan_id left join cs_promo_private.review_versions r on r.id=h.generation_id
$$;

create or replace function cs_promo_private.plan_delivery_ready(p_plan_id uuid) returns boolean
language sql stable set search_path=pg_catalog as $$
 select exists(select 1 from cs_promo_private.approvals a join cs_promo_private.review_heads h on h.plan_id=a.plan_id and h.generation_id=a.review_generation_id
 join cs_promo_private.review_versions r on r.id=h.generation_id and not r.invalidated
 join cs_promo_private.owners o on o.actor=a.approved_by and o.enabled
 join auth.users u on u.id=o.actor and u.raw_app_meta_data->'cafe_sativa_admin'='true'::jsonb
 where a.plan_id=p_plan_id and not cs_promo_private.plan_withdrawn(p_plan_id) and a.approver_epoch=o.revocation_epoch and not a.invalidated and a.source_state=cs_promo_private.source_state(p_plan_id)
 and cs_promo_private.validate_snapshot(p_plan_id,a.snapshot)
 and cs_promo_private.gate_valid(p_plan_id,'voice',a.snapshot-array['approvals','draftRevision'],r.digest)
 and cs_promo_private.gate_valid(p_plan_id,'video',a.snapshot-array['approvals','draftRevision'],r.digest)
 and cs_promo_private.gate_valid(p_plan_id,'publication',a.snapshot-array['approvals','draftRevision'],r.digest))
$$;
revoke all on all functions in schema cs_promo_private from public,anon,authenticated,service_role;
revoke all on function public.cs_read_character_promo_plan_controls(uuid),public.cs_review_character_promo_plan_control(uuid,text,uuid),public.cs_save_character_promo_plan_control(jsonb,text,uuid),public.cs_read_character_promo_plan_control_result(uuid,uuid) from public,anon,authenticated;
grant execute on function public.cs_read_character_promo_plan_controls(uuid),public.cs_review_character_promo_plan_control(uuid,text,uuid),public.cs_save_character_promo_plan_control(jsonb,text,uuid),public.cs_read_character_promo_plan_control_result(uuid,uuid) to service_role;
commit;
