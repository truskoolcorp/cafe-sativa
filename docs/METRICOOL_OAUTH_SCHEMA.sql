-- Server-only, encrypted provider connection. No browser role can read tokens.
create table public.cs_social_connections (
  provider text primary key check (provider='metricool'),
  owner_id uuid not null references auth.users(id),
  status text not null check (status in ('verified','revoked')),
  brand_id bigint not null check (brand_id=5373515),
  user_id bigint not null check (user_id=4174093),
  brand_label text not null,
  credential_ciphertext text not null,
  verified_at timestamptz not null,
  updated_at timestamptz not null default now(),
  dispatch_enabled boolean not null default false
);
alter table public.cs_social_connections enable row level security;
revoke all on public.cs_social_connections from public,anon,authenticated;
grant select,insert,update,delete on public.cs_social_connections to service_role;
