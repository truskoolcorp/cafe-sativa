begin;
-- All preexisting approval/source/gate checks pass; only the dispatcher precision
-- guard refuses the exact millisecond/microsecond slot. No data is rounded or changed.
create table public.precise_approved_slots as select id,scheduled_at from public.cs_character_promo_delivery_plans;
select public.assert_ok(cs_promo_private.plan_delivery_ready(id),'exact fractional schedule otherwise fully approved') from public.cs_character_promo_delivery_plans;
select public.assert_ok(scheduled_at<>date_trunc('second',scheduled_at),'fixture has nonzero subsecond precision') from public.cs_character_promo_delivery_plans;
select public.assert_ok(not public.cs_preflight_character_promo_dispatch('00000000-0000-0000-0000-000000000001',0,id,repeat('d',64),public.execution_for(id),null),'millisecond or microsecond schedule rejected before claim') from public.cs_character_promo_delivery_plans;
select public.assert_ok(public.cs_claim_character_promo_as_owner('00000000-0000-0000-0000-000000000001',0,id,repeat('d',64),public.execution_for(id)) is null,'unsupported schedule cannot create attempt') from public.cs_character_promo_delivery_plans;
select public.assert_ok((select count(*)=0 from cs_promo_private.attempts),'no attempt exists for unsupported precision');
select public.assert_ok((select bool_and(p.scheduled_at=s.scheduled_at) from public.cs_character_promo_delivery_plans p join precise_approved_slots s using(id)),'approved slot values remain exactly unchanged');
commit;
