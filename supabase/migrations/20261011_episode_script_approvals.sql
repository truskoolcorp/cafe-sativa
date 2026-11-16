create table public.cs_episode_script_approvals (
 episode_id text primary key,
 script_sha256 text not null check(script_sha256 ~ '^[0-9a-f]{64}$'),
 approved_by uuid not null references public.profiles(id),
 approved_at timestamptz not null default now(),
 brief jsonb not null
);
alter table public.cs_episode_script_approvals enable row level security;
revoke all on public.cs_episode_script_approvals from anon, authenticated;
grant all on public.cs_episode_script_approvals to service_role;
