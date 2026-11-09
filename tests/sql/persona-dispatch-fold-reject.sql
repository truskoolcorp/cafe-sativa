begin;
create table public.exact_approved_fold as select id,scheduled_at from public.cs_character_promo_delivery_plans;
select public.assert_ok(cs_promo_private.plan_delivery_ready(id),'fold instant otherwise fully approved') from public.cs_character_promo_delivery_plans;
select public.assert_ok(not cs_promo_private.dispatch_time_exact(id),'approved local walltime repeats and is ambiguous') from public.cs_character_promo_delivery_plans;
select public.assert_ok(not public.cs_preflight_character_promo_dispatch('00000000-0000-0000-0000-000000000001',0,id,repeat('d',64),public.execution_for(id),null),'ambiguous fold fails preflight') from public.cs_character_promo_delivery_plans;
select public.assert_ok(public.cs_claim_character_promo_as_owner('00000000-0000-0000-0000-000000000001',0,id,repeat('d',64),public.execution_for(id)) is null,'fold cannot create attempt') from public.cs_character_promo_delivery_plans;
select public.assert_ok((select count(*)=0 from cs_promo_private.attempts),'fold creates zero attempts');
select public.assert_ok((select bool_and(p.scheduled_at=s.scheduled_at) from public.cs_character_promo_delivery_plans p join exact_approved_fold s using(id)),'approved fold instant not silently changed');
commit;
