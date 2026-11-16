select public.assert_ok((select count(*)=1 from cs_promo_private.attempts),'one durable attempt');
select public.assert_ok(public.cs_claim_character_promo('00000000-0000-0000-0000-000000000020',repeat('c',64),s) is null,'second claim denied') from fixture_snapshot;
do $$ begin begin update public.cs_character_promo_drafts set spoken_script='changed'; raise exception 'mutation guard failed'; exception when others then if sqlerrm not like 'Claimed promo is frozen%' then raise; end if; end; end $$;
do $$ begin begin update public.cs_character_promo_delivery_plans set caption='changed'; raise exception 'mutation guard failed'; exception when others then if sqlerrm not like 'Claimed promo is frozen%' then raise; end if; end; end $$;
do $$ begin begin delete from public.cs_character_promo_qa_checks; raise exception 'mutation guard failed'; exception when others then if sqlerrm not like 'Claimed promo is frozen%' then raise; end if; end; end $$;
select public.assert_ok(not public.cs_finish_character_promo(plan_id,token,'scheduled','{"state":"published"}'),'published is not scheduled') from cs_promo_private.attempts;
select public.assert_ok(not public.cs_finish_character_promo(plan_id,'00000000-0000-0000-0000-000000000099','submission_unknown',null),'wrong token rejected') from cs_promo_private.attempts;
begin;
select public.assert_ok(public.cs_finish_character_promo(plan_id,token,'submission_unknown',null),'unknown persisted') from cs_promo_private.attempts;
select public.assert_ok(not public.cs_finish_character_promo(plan_id,token,'submission_unknown',null),'unknown is terminal') from cs_promo_private.attempts;
select public.assert_ok(public.cs_claim_character_promo('00000000-0000-0000-0000-000000000020',repeat('c',64),s) is null,'unknown never retries') from fixture_snapshot;

rollback;
select public.assert_ok(public.cs_finish_character_promo(a.plan_id,a.token,'scheduled',jsonb_build_object('state','scheduled','providerId','fixture-id','providerUuid','fixture-uuid','snapshotDigest',repeat('c',64),'videoSha256',s->>'videoSha256','network',s->>'network','accountId',s->>'accountId','brandId',s->>'brandId','userId',s->>'userId','caption',s->>'caption','scheduledAt',s->>'scheduledAt','timezone',s->>'timezone')),'exact scheduling receipt') from cs_promo_private.attempts a cross join fixture_snapshot;
select public.assert_ok((select state='scheduled' from cs_promo_private.attempts),'scheduled only not published');
