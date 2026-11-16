-- Additive migration. Apply to cafe-sativa-prod after its active-project limit is resolved.
create table if not exists public.cs_canonical_assets (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('venue','character','logo')),
  subject text not null, url text not null check (url like 'https://%'),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'), version text not null,
  approved_by uuid references auth.users(id), approved_at timestamptz,
  active boolean not null default false,
  unique(kind,subject,version)
);
create unique index if not exists cs_one_active_canonical on public.cs_canonical_assets(kind,subject) where active;

create table if not exists public.cs_content_jobs (
  id uuid primary key default gen_random_uuid(), slot_key text not null unique,
  room text not null, title text not null, caption text not null, camera_action text not null,
  policy_version text not null,
  status text not null default 'planned' check (status in ('planned','blocked','submitting','generating','submission_unknown','failed','pending_qa','approved','scheduled','published')),
  canonical_asset_id uuid references public.cs_canonical_assets(id),
  provider_task_id text unique, output_url text, blocker text,
  estimated_cost_cents integer check (estimated_cost_cents > 0),
  budget_month date, qa_approved_by uuid references auth.users(id), qa_approved_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.cs_content_budget (
  month date primary key,
  reserved_cents integer not null default 0 check (reserved_cents between 0 and 2500)
);
alter table public.cs_canonical_assets enable row level security;
alter table public.cs_content_jobs enable row level security;
alter table public.cs_content_budget enable row level security;
-- No browser policies: access only via authenticated server routes/service role.

create or replace function public.cs_claim_generation(job_id uuid, cost_cents integer, asset_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare job public.cs_content_jobs; month_start date := date_trunc('month', now() at time zone 'America/Chicago')::date;
begin
  if cost_cents is null or cost_cents <= 0 or cost_cents > 2500 then return false; end if;
  select * into job from cs_content_jobs where id = job_id for update;
  if not found or job.status not in ('planned','blocked') then return false; end if;
  -- Lock the approved canonical row so a concurrent retirement cannot race the claim.
  perform 1 from cs_canonical_assets where id = asset_id and kind = 'venue' and subject = job.room
    and active and approved_by is not null and approved_at is not null for share;
  if not found then return false; end if;
  insert into cs_content_budget(month) values(month_start) on conflict do nothing;
  update cs_content_budget set reserved_cents = reserved_cents + cost_cents
    where month = month_start and reserved_cents + cost_cents <= 2500;
  if not found then return false; end if;
  update cs_content_jobs set status='submitting', canonical_asset_id=asset_id,
    estimated_cost_cents=cost_cents, budget_month=month_start, blocker=null, updated_at=now() where id=job_id;
  return true;
end $$;
revoke all on function public.cs_claim_generation(uuid,integer,uuid) from public, anon, authenticated;
grant execute on function public.cs_claim_generation(uuid,integer,uuid) to service_role;
