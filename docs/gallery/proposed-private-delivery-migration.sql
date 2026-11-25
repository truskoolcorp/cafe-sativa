-- Proposed only. Review existing schema and storage policies before applying.
begin;
create table if not exists public.gallery_private_deliveries (
  order_id uuid primary key references public.orders(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  object_path text not null unique,
  created_at timestamptz not null default now(),
  constraint gallery_delivery_order_prefix check (
    object_path like order_id::text || '/%' and position('..' in object_path)=0
  )
);
alter table public.gallery_private_deliveries enable row level security;
revoke all on public.gallery_private_deliveries from public, anon, authenticated;
grant select, insert, update, delete on public.gallery_private_deliveries to service_role;
insert into storage.buckets (id,name,public)
values ('gallery-private','gallery-private',false)
on conflict (id) do nothing;
do $$
begin
  if not exists (select 1 from storage.buckets where id='gallery-private' and public=false) then
    raise exception 'Gallery storage must be private';
  end if;
end $$;
-- Restrictive policy blocks ordinary client access even if another permissive
-- storage policy is present. Service-role operations and signed URLs remain
-- subject to the platform's service-role/signed-URL behavior; test before release.
create policy gallery_private_no_client_objects on storage.objects
as restrictive for all to anon, authenticated
using (bucket_id <> 'gallery-private')
with check (bucket_id <> 'gallery-private');
commit;
-- Do not enable GALLERY_PRIVATE_DOWNLOADS until migration, storage isolation,
-- buyer ownership, refund denial, signed URL expiry and delivery UI are tested.
