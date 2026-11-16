-- OFFLINE DISPATCHER SECURITY PROPOSAL. Requires separate production schema/grant
-- approval. No migration runner, route activation, provider call or new attempt ledger.
-- Apply after ledger, gates, owner revocation, authoring/withdrawal proposals.
begin;
alter table cs_promo_private.attempts
 add column dispatch_actor uuid references cs_promo_private.owners(actor),
 add column dispatch_epoch bigint,
 add constraint cs_promo_dispatch_actor_pair check((dispatch_actor is null)=(dispatch_epoch is null));
-- Existing unbound attempts remain permanent holds; never fabricate/backfill an actor.

-- Provider local timestamp has no UTC offset. This bounded guard refuses known
-- repeated-wall-time representations instead of selecting/rounding an instant.
create function cs_promo_private.dispatch_time_exact(p_plan_id uuid) returns boolean
language plpgsql stable set search_path=pg_catalog as $$
declare instant timestamptz; zone_name text; local_time timestamp; delta integer;
begin
 select p.scheduled_at,a.snapshot->>'timezone' into instant,zone_name
 from public.cs_character_promo_delivery_plans p join cs_promo_private.approvals a on a.plan_id=p.id
 where p.id=p_plan_id and a.snapshot->>'planId'=p.id::text
 and (a.snapshot->>'scheduledAt')::timestamptz=p.scheduled_at;
 if instant is null or zone_name is null or btrim(zone_name)='' or instant<>date_trunc('second',instant) then return false; end if;
 local_time:=timezone(zone_name,instant);
 foreach delta in array array[30,60,90,120] loop
  if timezone(zone_name,instant-make_interval(mins=>delta))=local_time
   or timezone(zone_name,instant+make_interval(mins=>delta))=local_time then return false; end if;
 end loop;
 return true;
exception when others then return false;
end $$;
revoke all on function cs_promo_private.dispatch_time_exact(uuid) from public,anon,authenticated,service_role;

create function public.cs_authorize_character_promo_dispatch(p_actor uuid) returns jsonb
language sql stable security definer set search_path=pg_catalog as $$
 select jsonb_build_object('actorId',o.actor,'actorEpoch',o.revocation_epoch)
 from cs_promo_private.owners o join auth.users u on u.id=o.actor
 where current_setting('transaction_isolation')='read committed' and o.actor=p_actor
 and o.enabled and u.raw_app_meta_data->'cafe_sativa_admin'='true'::jsonb
$$;

-- Read-only advisory gate. Authoritative claim serializes source mutation/withdrawal.
-- Fresh verified caller identity must be supplied by the server, not request JSON.
-- The original authorize epoch is carried unchanged through every dispatch step.
create function public.cs_preflight_character_promo_dispatch(p_actor uuid,p_actor_epoch bigint,p_plan_id uuid,p_digest text,p_snapshot jsonb,p_token uuid default null) returns boolean
language plpgsql stable security definer set search_path=pg_catalog as $$
declare promo uuid;
begin
 if current_setting('transaction_isolation')<>'read committed' or not cs_promo_private.actor_epoch_valid(p_actor,p_actor_epoch) then return false; end if;
 -- Provider transport supports whole seconds only. Reject precision loss; never round approved time.
 if not cs_promo_private.dispatch_time_exact(p_plan_id) then return false; end if;
 if not cs_promo_private.plan_delivery_ready(p_plan_id) or not exists(select 1 from cs_promo_private.approvals where plan_id=p_plan_id and digest=p_digest and snapshot=p_snapshot) then return false; end if;
 select promo_id into promo from public.cs_character_promo_delivery_plans where id=p_plan_id;
 if promo is null then return false; end if;
 if p_token is not null then
  return exists(select 1 from cs_promo_private.attempts where plan_id=p_plan_id and token=p_token and state='submitting' and dispatch_actor=p_actor and dispatch_epoch=p_actor_epoch);
 end if;
 if exists(select 1 from cs_promo_private.attempts where plan_id=p_plan_id) then return false; end if;
 if not exists(select 1 from cs_promo_private.attempts a join public.cs_character_promo_delivery_plans p on p.id=a.plan_id where p.promo_id=promo)
 and exists(select 1 from public.cs_character_promo_delivery_plans p where p.promo_id=promo and not cs_promo_private.plan_withdrawn(p.id) and (not cs_promo_private.plan_delivery_ready(p.id) or not cs_promo_private.dispatch_time_exact(p.id))) then return false; end if;
 return true;
end $$;

create function public.cs_claim_character_promo_as_owner(p_actor uuid,p_actor_epoch bigint,p_plan_id uuid,p_digest text,p_snapshot jsonb) returns uuid
language plpgsql security definer set search_path=pg_catalog as $$
declare promo uuid; claim_token uuid;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'Dispatch claim requires READ COMMITTED'; end if;
 select promo_id into promo from public.cs_character_promo_delivery_plans where id=p_plan_id;
 if promo is null then return null; end if;
 perform 1 from public.cs_character_promo_drafts where id=promo for update;
 -- Check the captured caller epoch AFTER a waited parent lock. Never reacquire a
 -- replacement epoch to revive an in-flight request after revoke/restore.
 if not public.cs_preflight_character_promo_dispatch(p_actor,p_actor_epoch,p_plan_id,p_digest,p_snapshot,null) then return null; end if;
 claim_token:=public.cs_claim_character_promo(p_plan_id,p_digest,p_snapshot);
 if claim_token is null then return null; end if;
 update cs_promo_private.attempts set dispatch_actor=p_actor,dispatch_epoch=p_actor_epoch
 where plan_id=p_plan_id and token=claim_token and state='submitting' and dispatch_actor is null and dispatch_epoch is null;
 if not found then raise exception 'New dispatch caller binding was not persisted'; end if;
 return claim_token;
end $$;

-- Close the legacy service-call bypass. Definer owner retains internal delegation.
-- Finish remains unchanged so a request may record an actual external outcome even
-- if the caller is revoked after transmission. This never grants a new submission.
revoke all on function public.cs_claim_character_promo(uuid,text,jsonb) from service_role;
revoke all on function public.cs_authorize_character_promo_dispatch(uuid),public.cs_preflight_character_promo_dispatch(uuid,bigint,uuid,text,jsonb,uuid),public.cs_claim_character_promo_as_owner(uuid,bigint,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.cs_authorize_character_promo_dispatch(uuid),public.cs_preflight_character_promo_dispatch(uuid,bigint,uuid,text,jsonb,uuid),public.cs_claim_character_promo_as_owner(uuid,bigint,uuid,text,jsonb) to service_role;
commit;
