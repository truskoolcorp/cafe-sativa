-- SEPARATE OFFLINE SECURITY SCOPE. Not included in a production rollout approval.
-- Requires explicit review/approval of narrow auth.users trigger before production.
begin;
create function cs_promo_private.invalidate_actor_reviews() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
declare v_actor uuid; promo uuid;
begin
 if tg_table_schema='auth' then v_actor:=old.id; else v_actor:=old.actor; end if;
 -- Ignore accounts with no persona authority/evidence. Do not alter their auth rows.
 if not exists(select 1 from cs_promo_private.owners where cs_promo_private.owners.actor=v_actor) then
  if tg_op='DELETE' then return old; else return new; end if;
 end if;
 -- Epoch changes even if no evidence yet exists: a concurrent first contribution
 -- that saw the old committed authority remains stale after this transaction commits.
 if tg_table_schema='auth' then
  update cs_promo_private.owners set revocation_epoch=revocation_epoch+1 where cs_promo_private.owners.actor=v_actor;
 elsif tg_op='UPDATE' then
  new.revocation_epoch:=old.revocation_epoch+1;
 end if;
 -- Auth/owner row -> sorted parent draft locks. Confirm/claim take only draft locks,
 -- and read (never row-lock/update) auth/owner records, avoiding inverse lock order.
 for promo in select distinct p.promo_id from public.cs_character_promo_delivery_plans p
 join cs_promo_private.review_versions r on r.plan_id=p.id
 where r.begun_by=v_actor or exists(select 1 from cs_promo_private.gates g where g.generation_id=r.id and g.confirmed_by=v_actor)
 or exists(select 1 from cs_promo_private.approvals a where a.review_generation_id=r.id and a.approved_by=v_actor)
 order by p.promo_id loop
  perform 1 from public.cs_character_promo_drafts where id=promo for update;
 end loop;
 update cs_promo_private.review_versions r set invalidated=true where r.begun_by=v_actor
 or exists(select 1 from cs_promo_private.gates g where g.generation_id=r.id and g.confirmed_by=v_actor)
 or exists(select 1 from cs_promo_private.approvals a where a.review_generation_id=r.id and a.approved_by=v_actor);
 update cs_promo_private.gates g set invalidated=true where g.confirmed_by=v_actor or exists(select 1 from cs_promo_private.review_versions r where r.id=g.generation_id and r.invalidated);
 update cs_promo_private.approvals a set invalidated=true where a.approved_by=v_actor or exists(select 1 from cs_promo_private.review_versions r where r.id=a.review_generation_id and r.invalidated);
 -- Never delete attempts or cancel an in-flight/provider operation. Existing claims stay held.
 if tg_op='DELETE' then return old; else return new; end if;
end $$;
revoke all on function cs_promo_private.invalidate_actor_reviews() from public,anon,authenticated,service_role;
create trigger cs_promo_owner_disabled before update of enabled on cs_promo_private.owners
for each row when (old.enabled and not new.enabled) execute function cs_promo_private.invalidate_actor_reviews();
-- Keep the epoch tombstone even before any evidence exists. Otherwise owner DELETE
-- plus UUID recreation could reset epoch zero under an in-flight first confirmation.
create function cs_promo_private.prevent_owner_delete() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
 raise exception 'Persona owner records are permanent; disable instead';
end $$;
revoke all on function cs_promo_private.prevent_owner_delete() from public,anon,authenticated,service_role;
create trigger cs_promo_owner_removed before delete on cs_promo_private.owners
for each row execute function cs_promo_private.prevent_owner_delete();
create function cs_promo_private.prevent_owner_identity_change() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
 if new.actor is distinct from old.actor then raise exception 'Persona owner identity is permanent'; end if;
 if new.revocation_epoch<old.revocation_epoch then raise exception 'Persona revocation epoch cannot decrease'; end if;
 return new;
end $$;
revoke all on function cs_promo_private.prevent_owner_identity_change() from public,anon,authenticated,service_role;
create trigger cs_promo_owner_identity_immutable before update of actor,revocation_epoch on cs_promo_private.owners
for each row execute function cs_promo_private.prevent_owner_identity_change();
create trigger cs_promo_owner_admin_lost before update of raw_app_meta_data on auth.users
for each row when (old.raw_app_meta_data->'cafe_sativa_admin'='true'::jsonb and new.raw_app_meta_data->'cafe_sativa_admin' is distinct from 'true'::jsonb)
execute function cs_promo_private.invalidate_actor_reviews();
create trigger cs_promo_owner_account_removed before delete on auth.users
for each row execute function cs_promo_private.invalidate_actor_reviews();
commit;
