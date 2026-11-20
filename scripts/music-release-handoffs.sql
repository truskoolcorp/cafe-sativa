-- Additive, service-only release registry. Does not publish or seed any pilot.
create table if not exists public.cs_music_releases (
 id uuid primary key default gen_random_uuid(),
 slug text not null unique,
 manifest jsonb not null,
 digest text not null check (digest ~ '^[a-f0-9]{64}$'),
 status text not null default 'draft' check(status in ('draft','approved')),
 created_by uuid references auth.users(id) not null,
 approved_by uuid references auth.users(id), approved_at timestamptz,
 marketing_state text not null default 'queued' check(marketing_state in ('queued','submitting','scheduled','unknown','blocked')),
 marketing_receipt jsonb, marketing_error text,
 submitted_at timestamptz, checked_at timestamptz,
 vip_ready boolean not null default false,
 vip_error text,
 created_at timestamptz not null default now(),
 check (status='draft' or (approved_by is not null and approved_at is not null))
);
alter table public.cs_music_releases enable row level security;
revoke all on public.cs_music_releases from anon, authenticated;
grant select,insert,update on public.cs_music_releases to service_role;
create index if not exists cs_music_release_work on public.cs_music_releases(status,marketing_state,created_at);
-- Approval binds the immutable manifest. Corrections require a new draft/slug.
create or replace function public.cs_guard_music_manifest() returns trigger language plpgsql set search_path='' as $$
begin
 if old.status='approved' and (new.manifest is distinct from old.manifest or new.digest is distinct from old.digest or new.slug is distinct from old.slug or new.status is distinct from old.status or new.approved_by is distinct from old.approved_by or new.approved_at is distinct from old.approved_at) then
 raise exception 'Approved release is immutable'; end if;
 return new;
end $$;
revoke all on function public.cs_guard_music_manifest() from public,anon,authenticated;
drop trigger if exists cs_music_manifest_guard on public.cs_music_releases;
create trigger cs_music_manifest_guard before update on public.cs_music_releases for each row execute function public.cs_guard_music_manifest();

-- Attribution is a payment receipt, never an entitlement or payout instruction.
create table if not exists public.cs_music_conversions (
 stripe_session_id text primary key,
 release_id uuid not null references public.cs_music_releases(id),
 stripe_subscription_id text not null,
 amount_cents bigint not null check(amount_cents>0),
 currency text not null check(currency='usd'),
 observed_at timestamptz not null default now()
);
alter table public.cs_music_conversions enable row level security;
revoke all on public.cs_music_conversions from anon,authenticated;
grant select,insert on public.cs_music_conversions to service_role;
