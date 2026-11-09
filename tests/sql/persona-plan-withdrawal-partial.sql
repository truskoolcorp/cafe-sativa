begin;
select public.assert_ok(public.cs_claim_character_promo('00000000-0000-0000-0000-000000000020',repeat('d',64),public.execution_for('00000000-0000-0000-0000-000000000020')) is null,'unfinished required sibling blocks dispatch');
create table public.partial_ticket as select public.cs_review_character_promo_plan_control('00000000-0000-0000-0000-000000000021','withdraw','00000000-0000-0000-0000-000000000001') ticket;
select public.assert_ok((public.cs_save_character_promo_plan_control(ticket->'snapshot',ticket->>'digest','00000000-0000-0000-0000-000000000001')->>'withdrawn')::boolean,'owner explicitly excludes unfinished sibling') from partial_ticket;
select public.assert_ok((select count(*)=0 from cs_promo_private.gates where plan_id='00000000-0000-0000-0000-000000000021'),'no approvals invented for excluded destination');
select public.assert_ok(public.cs_claim_character_promo('00000000-0000-0000-0000-000000000020',repeat('d',64),public.execution_for('00000000-0000-0000-0000-000000000020')) is not null,'only independently approved active target can claim');
commit;
