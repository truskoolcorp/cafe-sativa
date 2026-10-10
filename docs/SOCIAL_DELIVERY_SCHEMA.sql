alter table public.cs_social_connections
  add column lock_until timestamptz,
  add column last_check_at timestamptz,
  add column last_error text,
  add column capabilities_verified boolean not null default false;

create function public.cs_claim_social_connection()
returns setof public.cs_social_connections
language sql security invoker set search_path=public
as $$
  update public.cs_social_connections set lock_until=now()+interval '90 seconds'
  where provider='metricool' and status='verified'
    and (lock_until is null or lock_until<now()) returning *;
$$;
revoke all on function public.cs_claim_social_connection() from public,anon,authenticated;
grant execute on function public.cs_claim_social_connection() to service_role;

create table public.cs_social_deliveries (
  id uuid primary key default gen_random_uuid(),
  content_item_id uuid unique references public.content_items(id),
  source_job_id uuid references public.cs_content_jobs(id),
  state text not null check (state in ('queued','submitting','scheduled','submission_unknown','blocked','canceled')),
  caption text not null,
  caption_hash text not null,
  scheduled_at timestamptz not null,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  provider_post_id bigint,
  provider_uuid text unique,
  receipt jsonb,
  error text,
  submitted_at timestamptz,
  checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.cs_social_deliveries enable row level security;
revoke all on public.cs_social_deliveries from public,anon,authenticated;
grant select,insert,update,delete on public.cs_social_deliveries to service_role;
