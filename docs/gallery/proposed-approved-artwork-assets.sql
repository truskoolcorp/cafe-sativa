-- Proposed only; review schema and storage permissions before applying.
begin;
create table public.gallery_approved_assets (
 id uuid primary key default gen_random_uuid(),
 product_id uuid not null references public.products(id) on delete restrict,
 object_path text not null unique,
 sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
 approved_by uuid not null,
 approved_at timestamptz not null default now(),
 revoked_at timestamptz,
 constraint approved_asset_path check (object_path like product_id::text || '/%' and position('..' in object_path)=0)
);
alter table public.gallery_approved_assets enable row level security;
revoke all on public.gallery_approved_assets from public,anon,authenticated;
grant select,insert,update on public.gallery_approved_assets to service_role;
insert into storage.buckets(id,name,public) values ('gallery-approved','gallery-approved',false) on conflict(id) do nothing;
do $$ begin
 if not exists(select 1 from storage.buckets where id='gallery-approved' and public=false) then raise exception 'Approved assets must be private'; end if;
end $$;
create policy gallery_approved_no_client_objects on storage.objects as restrictive for all to anon,authenticated using(bucket_id <> 'gallery-approved') with check(bucket_id <> 'gallery-approved');
-- Bind an immutable reviewed edition to each order before staging.
alter table public.gallery_private_deliveries add column approved_asset_id uuid references public.gallery_approved_assets(id) on delete restrict;
commit;
-- Existing mappings must be reconciled before enforcing non-null asset references.
-- No migration application or asset approval is authorized by this file.
