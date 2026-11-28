-- Proposed Gallery-only publication guard; no data changes or automatic approvals.
-- Review existing products policies/triggers and inventory RPC execution roles before rollout.
begin;
create function public.cs_guard_gallery_product_publication()
returns trigger language plpgsql security invoker
set search_path = pg_catalog, public as $guard$
declare trusted boolean;
begin
 -- PostgREST authenticated clients must not be able to publish directly or
 -- modify a reviewed edition; trusted service workflows still need explicit
 -- rights/asset/price review and ordinary sales readiness.
 trusted := current_user in ('service_role','postgres')
   or current_user = (select pg_get_userbyid(relowner) from pg_class where oid=TG_RELID);
 if not trusted then
  if TG_OP='DELETE' then
   if old.status::text='published' then
    raise exception 'Published artwork requires Gallery review' using errcode='42501';
   end if;
   return old;
  end if;
  if new.status::text is not distinct from 'published' then
   raise exception 'Artwork publication requires Gallery review' using errcode='42501';
  end if;
  if TG_OP='UPDATE' then
   if old.status::text='published' then
    raise exception 'Published artwork requires Gallery review' using errcode='42501';
   end if;
  end if;
 end if;
 if TG_OP='DELETE' then return old; end if;
 return new;
end $guard$;
revoke all on function public.cs_guard_gallery_product_publication() from public,anon,authenticated;
create trigger cs_guard_gallery_product_publication
before insert or update or delete on public.products
for each row execute function public.cs_guard_gallery_product_publication();
commit;
