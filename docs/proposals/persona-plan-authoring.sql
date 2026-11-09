-- OFFLINE PROPOSAL ONLY. Apply manually only after ledger, gates, owner revocation.
-- Not a migration, activation, approval, provider action, or sibling lifecycle API.
begin;
create table cs_promo_private.plan_edit_reviews(
 id uuid primary key, actor uuid not null references cs_promo_private.owners(actor),
 actor_epoch bigint not null, snapshot jsonb not null, digest text not null,
 reviewed_at timestamptz not null default clock_timestamp(), saved_at timestamptz
);
revoke all on cs_promo_private.plan_edit_reviews from public,anon,authenticated,service_role;

create function cs_promo_private.plan_edit_changes_valid(caption text, scheduled text) returns boolean
language plpgsql set search_path=pg_catalog as $$
begin
 return coalesce(length(btrim(caption))>0 and length(caption)<=500
 and scheduled ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
 and to_char(scheduled::timestamptz at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')=scheduled
 and scheduled::timestamptz>clock_timestamp()+interval '60 seconds',false);
exception when others then return false;
end $$;

-- p_actor comes exclusively from fresh server auth.getUser(), never request JSON.
-- Existing null caption, past schedule and incomplete QA/canon/media are allowed.
create function public.cs_review_character_promo_plan_edit(p_plan_id uuid,p_caption text,p_scheduled_at text,p_actor uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare p public.cs_character_promo_delivery_plans; d public.cs_character_promo_drafts;
 epoch bigint; s jsonb; digest text; review_id uuid:=gen_random_uuid();
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'Plan authoring requires READ COMMITTED'; end if;
 select o.revocation_epoch into epoch from cs_promo_private.owners o join auth.users u on u.id=o.actor where o.actor=p_actor and o.enabled and u.raw_app_meta_data->'cafe_sativa_admin'='true'::jsonb;
 if epoch is null then raise exception 'Verified owner required'; end if;
 select * into p from public.cs_character_promo_delivery_plans where id=p_plan_id;
 select * into d from public.cs_character_promo_drafts where id=p.promo_id for update;
 if not cs_promo_private.actor_epoch_valid(p_actor,epoch) then raise exception 'Verified owner required'; end if;
 select * into p from public.cs_character_promo_delivery_plans where id=p_plan_id;
 if p.id is null or d.id is null or not cs_promo_private.plan_edit_changes_valid(p_caption,p_scheduled_at)
 or exists(select 1 from cs_promo_private.attempts a join public.cs_character_promo_delivery_plans z on z.id=a.plan_id where z.promo_id=d.id) then return null; end if;
 s:=jsonb_build_object('version',1,'reviewId',review_id,'actor',p_actor,'actorEpoch',epoch,
 'expected',jsonb_build_object('plan',to_jsonb(p),'draft',to_jsonb(d)),
 'changes',jsonb_build_object('caption',p_caption,'scheduledAt',p_scheduled_at));
 digest:=encode(sha256(convert_to(s::text,'UTF8')),'hex');
 insert into cs_promo_private.plan_edit_reviews(id,actor,actor_epoch,snapshot,digest) values(review_id,p_actor,epoch,s,digest);
 return jsonb_build_object('snapshot',s,'digest',digest);
end $$;

-- Save the exact previously displayed review. Never reconstruct/review on Save.
-- Digest is SQL canonical jsonb text SHA256, not JS JSON.stringify or approval digest.
create function public.cs_save_character_promo_plan_edit(p_snapshot jsonb,p_digest text,p_actor uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare r cs_promo_private.plan_edit_reviews; p public.cs_character_promo_delivery_plans;
 d public.cs_character_promo_drafts; epoch bigint; saved_time timestamptz;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'Plan authoring requires READ COMMITTED'; end if;
 select o.revocation_epoch into epoch from cs_promo_private.owners o join auth.users u on u.id=o.actor where o.actor=p_actor and o.enabled and u.raw_app_meta_data->'cafe_sativa_admin'='true'::jsonb;
 if epoch is null then raise exception 'Verified owner required'; end if;
 -- Compare exact stored JSON before interpreting caller-controlled fields.
 select * into r from cs_promo_private.plan_edit_reviews where snapshot=p_snapshot and digest=p_digest and actor=p_actor and actor_epoch=epoch and saved_at is null;
 if r.id is null then return null; end if;
 select * into p from public.cs_character_promo_delivery_plans where id=(r.snapshot#>>'{expected,plan,id}')::uuid;
 select * into d from public.cs_character_promo_drafts where id=p.promo_id for update;
 if not cs_promo_private.actor_epoch_valid(p_actor,epoch) then raise exception 'Verified owner required'; end if;
 select * into p from public.cs_character_promo_delivery_plans where id=(r.snapshot#>>'{expected,plan,id}')::uuid;
 if p.id is null or d.id is null or to_jsonb(p) is distinct from r.snapshot#>'{expected,plan}'
 or to_jsonb(d) is distinct from r.snapshot#>'{expected,draft}'
 or not cs_promo_private.plan_edit_changes_valid(r.snapshot#>>'{changes,caption}',r.snapshot#>>'{changes,scheduledAt}')
 or exists(select 1 from cs_promo_private.attempts a join public.cs_character_promo_delivery_plans z on z.id=a.plan_id where z.promo_id=d.id)
 then return null; end if;
 saved_time:=clock_timestamp();
 update cs_promo_private.plan_edit_reviews set saved_at=saved_time where id=r.id and saved_at is null;
 if not found then return null; end if;
 -- Only these two columns. Existing source guard invalidates shared-draft consent.
 -- Never bypass triggers, clear/reset approval stamps, delete evidence, or change heads.
 update public.cs_character_promo_delivery_plans set caption=r.snapshot#>>'{changes,caption}',
 scheduled_at=(r.snapshot#>>'{changes,scheduledAt}')::timestamptz where id=p.id;
 return jsonb_build_object('planId',p.id,'caption',r.snapshot#>>'{changes,caption}',
 'scheduledAt',r.snapshot#>>'{changes,scheduledAt}','consentInvalidated',true);
end $$;
revoke all on function cs_promo_private.plan_edit_changes_valid(text,text) from public,anon,authenticated,service_role;
revoke all on function public.cs_review_character_promo_plan_edit(uuid,text,text,uuid),public.cs_save_character_promo_plan_edit(jsonb,text,uuid) from public,anon,authenticated;
grant execute on function public.cs_review_character_promo_plan_edit(uuid,text,text,uuid),public.cs_save_character_promo_plan_edit(jsonb,text,uuid) to service_role;
commit;
