begin isolation level repeatable read;
do $$ begin begin perform public.cs_claim_character_promo('00000000-0000-0000-0000-000000000020',repeat('c',64),s) from fixture_snapshot; raise exception 'isolation guard failed'; exception when others then if sqlerrm <> 'Promo claim requires READ COMMITTED' then raise; end if; end; end $$;
rollback;
