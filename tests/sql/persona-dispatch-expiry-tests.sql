begin;
create table public.expiring_dispatch as select public.cs_claim_character_promo_as_owner('00000000-0000-0000-0000-000000000001',0,'00000000-0000-0000-0000-000000000020',repeat('d',64),public.execution_for('00000000-0000-0000-0000-000000000020')) token;
select public.assert_ok(token is not null,'future scheduled target claimed') from expiring_dispatch;
select public.assert_ok(public.cs_preflight_character_promo_dispatch('00000000-0000-0000-0000-000000000001',0,'00000000-0000-0000-0000-000000000020',repeat('d',64),public.execution_for('00000000-0000-0000-0000-000000000020'),token),'fresh claim preflight valid') from expiring_dispatch;
select pg_sleep(66);
select public.assert_ok((select scheduled_at<clock_timestamp() from public.cs_character_promo_delivery_plans where id='00000000-0000-0000-0000-000000000020'),'actual slot passed without source mutation');
select public.assert_ok(not public.cs_preflight_character_promo_dispatch('00000000-0000-0000-0000-000000000001',0,'00000000-0000-0000-0000-000000000020',repeat('d',64),public.execution_for('00000000-0000-0000-0000-000000000020'),token),'expired submitting token cannot authorize provider call') from expiring_dispatch;
select public.assert_ok((select count(*)=1 and min(state)='submitting' from cs_promo_private.attempts),'expired attempt remains permanent no reset');
commit;
