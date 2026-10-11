begin;
do $$
declare a uuid; p uuid; receipt jsonb; first_result jsonb; second_result jsonb; n integer;
begin
 insert into public.artists(user_id,display_name,slug,stripe_account_id)
 values('54b71f3f-19e1-46f0-99e2-28993463caf8','Transactional test fixture','test-'||gen_random_uuid(),'acct_test_fixture') returning id into a;
 insert into public.products(artist_id,slug,title,kind,status,price_cents,currency,stock_count)
 values(a,'test-product','Rollback-only test','physical','draft',9999,'usd',2) returning id into p;
 receipt=jsonb_build_object('session_id','cs_test_'||gen_random_uuid(),'payment_status','paid','user_id','54b71f3f-19e1-46f0-99e2-28993463caf8','email','test@example.invalid','subtotal_cents',1200,'total_cents',1200,'currency','usd','application_fee_cents',120);
 first_result=public.cs_record_gallery_payment(receipt,p,a,1);
 second_result=public.cs_record_gallery_payment(receipt,p,a,1);
 if not (first_result->>'created')::boolean or (second_result->>'created')::boolean or first_result->>'id'<>second_result->>'id' then raise exception 'Idempotency assertion failed'; end if;
 select stock_count into n from products where id=p;
 if n<>1 then raise exception 'Stock decremented twice'; end if;
 select count(*) into n from order_items where order_id=(first_result->>'id')::uuid and price_cents=1200;
 if n<>1 then raise exception 'Paid price snapshot assertion failed'; end if;
 begin
  perform public.cs_record_gallery_payment(receipt||jsonb_build_object('session_id','cs_test_'||gen_random_uuid()),p,a,2);
  raise exception 'Expected inventory failure';
 exception when others then
  if sqlerrm<>'Paid order requires inventory reconciliation' then raise; end if;
 end;
 select count(*) into n from orders where id=(first_result->>'id')::uuid;
 if n<>1 then raise exception 'Order assertion failed'; end if;
 if has_function_privilege('anon','public.cs_record_gallery_payment(jsonb,uuid,uuid,integer)','execute') or has_function_privilege('authenticated','public.cs_record_gallery_payment(jsonb,uuid,uuid,integer)','execute') then raise exception 'RPC permission assertion failed'; end if;
end $$;
rollback;
