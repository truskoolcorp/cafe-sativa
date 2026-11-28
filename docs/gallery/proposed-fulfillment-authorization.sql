-- Proposed migration; requires private-delivery and approved-assets migrations and schema validation.
begin;
create or replace function public.cs_authorize_gallery_delivery(p_order uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare
  o public.orders%rowtype;
begin
  select * into o from public.orders where id=p_order for update;
  if not found or o.paid_at is null or o.fulfillment_state not in ('pending','delivered') then
    return false;
  end if;
  -- Mapping is created only by the trusted fulfillment worker after copying
  -- a reviewed, immutable source file into private order-specific storage.
  if (select count(*) from public.order_items where order_id=p_order) <> 1 then return false; end if;
  if not exists (
    select 1 from public.gallery_private_deliveries d
    join public.order_items i on i.order_id=d.order_id and i.product_id=d.product_id
    join public.products p on p.id=i.product_id and p.kind='digital'
    join public.gallery_approved_assets a on a.id=d.approved_asset_id and a.product_id=d.product_id and a.revoked_at is null
    join storage.objects s on s.bucket_id='gallery-private' and s.name=d.object_path
    where d.order_id=p_order
  ) then return false; end if;
  if o.fulfillment_state='delivered' then return true; end if;
  update public.orders set fulfillment_state='delivered',updated_at=now()
  where id=p_order and fulfillment_state='pending';
  return found;
end;
$$;
revoke all on function public.cs_authorize_gallery_delivery(uuid) from public,anon,authenticated;
grant execute on function public.cs_authorize_gallery_delivery(uuid) to service_role;
commit;
-- No public execution, no automatic invocation, no production application.
-- Test concurrent refund, duplicate invocation, missing object and wrong product.
