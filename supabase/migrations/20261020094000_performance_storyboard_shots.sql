create table if not exists public.cs_performance_storyboard_shots (
 id uuid primary key default gen_random_uuid(),
 job_id uuid not null references public.cs_character_video_jobs(id) on delete cascade,
 shot_number integer not null check (shot_number between 1 and 300),
 start_ms integer not null check(start_ms >= 0),
 end_ms integer not null check(end_ms > start_ms and end_ms-start_ms <= 15000),
 scene_brief text not null check(length(scene_brief) between 1 and 2500),
 camera_note text not null default '',
 performer_note text not null default '',
 instrument_note text not null default '',
 reference_path text,
 reference_sha256 text check(reference_sha256 is null or reference_sha256 ~ '^[0-9a-f]{64}$'),
 review_status text not null default 'pending' check(review_status in ('pending','revision_requested','approved','rejected')),
 reviewed_at timestamptz,
 reviewed_by uuid,
 created_at timestamptz not null default now(),
 unique(job_id,shot_number),
 constraint cs_sb_approval_has_reference check(review_status <> 'approved' or (reference_path is not null and reference_sha256 is not null and reviewed_by is not null and reviewed_at is not null))
);
alter table public.cs_performance_storyboard_shots enable row level security;
revoke all on public.cs_performance_storyboard_shots from anon,authenticated;
create index if not exists cs_sb_job_idx on public.cs_performance_storyboard_shots(job_id,shot_number);
