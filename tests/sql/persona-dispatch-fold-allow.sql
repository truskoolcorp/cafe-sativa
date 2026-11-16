begin;
select public.assert_ok(cs_promo_private.plan_delivery_ready(id) and cs_promo_private.dispatch_time_exact(id),'nearby nonrepeated approved walltime supported') from public.cs_character_promo_delivery_plans;
select public.assert_ok(public.cs_preflight_character_promo_dispatch('00000000-0000-0000-0000-000000000001',0,id,repeat('d',64),public.execution_for(id),null),'nearby exact instant passes preflight') from public.cs_character_promo_delivery_plans;
select public.assert_ok(public.cs_claim_character_promo_as_owner('00000000-0000-0000-0000-000000000001',0,'00000000-0000-0000-0000-000000000020',repeat('d',64),public.execution_for('00000000-0000-0000-0000-000000000020')) is not null,'nearby exact approved instant can claim once');
commit;
