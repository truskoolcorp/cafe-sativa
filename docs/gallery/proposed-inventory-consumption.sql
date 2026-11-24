-- Proposed only. Read-only production catalog audit confirmed the existing receipt-first RPC signature, product row lock, session idempotency and stock decrement.
begin;
create function public.cs_record_reserved_gallery_payment(
 p_hold uuid, product_uuid uuid, artist_uuid uuid, quantity integer, receipt jsonb
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare h public.gallery_inventory_holds%rowtype; result jsonb;
begin
 perform 1 from public.products where id=product_uuid for update;
 if not found then raise exception 'Product unavailable'; end if;
 select * into h from public.gallery_inventory_holds where id=p_hold for update;
 if not found or quantity is null or quantity not between 1 and 10 or artist_uuid is null
 or h.stripe_session_id is null or btrim(h.stripe_session_id)='' 
 or h.product_id<>product_uuid or h.quantity<>quantity
 or h.user_id::text is distinct from receipt->>'user_id'
 or h.stripe_session_id is distinct from receipt->>'session_id'
 or h.state not in ('held','consumed','attention')
 or receipt->>'payment_status' is distinct from 'paid' then
 raise exception 'Reservation mismatch';
 end if;
 -- Existing RPC must be idempotent and decrement stock only on first order creation.
 select to_jsonb(public.cs_record_gallery_payment(receipt,product_uuid,artist_uuid,quantity)) into result;
 if result is null or result->>'id' is null then raise exception 'Order recording failed'; end if;
 update public.gallery_inventory_holds set state='consumed' where id=p_hold;
 return result;
end;
$$;
revoke all on function public.cs_record_reserved_gallery_payment(uuid,uuid,uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.cs_record_reserved_gallery_payment(uuid,uuid,uuid,integer,jsonb) to service_role;
commit;
-- Verified signature from pg_get_functiondef: (receipt jsonb, product_uuid uuid, artist_uuid uuid, quantity integer). Execute concurrency and rollback tests on isolated database only.
-- Do not activate until concurrent checkout, duplicate webhook and rollback tests pass.
