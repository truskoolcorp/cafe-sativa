begin;
select public.assert_ok(cs_promo_private.plan_delivery_ready('00000000-0000-0000-0000-000000000020'),'whole-second target otherwise approved');
select public.assert_ok((select scheduled_at=date_trunc('second',scheduled_at) from public.cs_character_promo_delivery_plans where id='00000000-0000-0000-0000-000000000020'),'target has supported precision');
select public.assert_ok(not public.cs_preflight_character_promo_dispatch('00000000-0000-0000-0000-000000000001',0,'00000000-0000-0000-0000-000000000020',repeat('d',64),public.execution_for('00000000-0000-0000-0000-000000000020'),null),'fractional active sibling blocks first claim');
select public.assert_ok(public.cs_claim_character_promo_as_owner('00000000-0000-0000-0000-000000000001',0,'00000000-0000-0000-0000-000000000020',repeat('d',64),public.execution_for('00000000-0000-0000-0000-000000000020')) is null,'cannot freeze unsupported sibling by claiming target first');
create table public.exclude_fractional as select public.cs_review_character_promo_plan_control('00000000-0000-0000-0000-000000000021','withdraw','00000000-0000-0000-0000-000000000001') ticket;
select public.assert_ok((public.cs_save_character_promo_plan_control(ticket->'snapshot',ticket->>'digest','00000000-0000-0000-0000-000000000001')->>'withdrawn')::boolean,'explicit owner can exclude unsupported sibling') from exclude_fractional;
select public.assert_ok(public.cs_preflight_character_promo_dispatch('00000000-0000-0000-0000-000000000001',0,'00000000-0000-0000-0000-000000000020',repeat('d',64),public.execution_for('00000000-0000-0000-0000-000000000020'),null),'only explicitly active supported target remains eligible');
commit;
