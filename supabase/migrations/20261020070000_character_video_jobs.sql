-- Draft-only character-video production registry; no rendering, approval or publishing side effects.
create table if not exists public.cs_character_video_jobs (
 id uuid primary key default gen_random_uuid(),
 character_id text not null check (char_length(character_id) between 2 and 100),
 title text not null check (char_length(title) between 1 and 240),
 brief text not null default '' check (char_length(brief) <= 5000),
 status text not null default 'draft' check (status in ('draft','blocked','pending_canonical_review','ready_for_generation','rendering','pending_qa','rejected','approved','scheduled','published')),
 canonical_asset_id uuid,
 canonical_sha256 text check (canonical_sha256 is null or canonical_sha256 ~ '^[0-9a-f]{64}$'),
 voice_reference_id text,
 provider text,
 provider_task_id text,
 output_bucket text,
 output_path text,
 output_sha256 text check (output_sha256 is null or output_sha256 ~ '^[0-9a-f]{64}$'),
 qa_result jsonb,
 qa_approved_by uuid,
 qa_approved_at timestamptz,
 publication_approved_by uuid,
 publication_approved_at timestamptz,
 scheduled_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint cs_character_video_output_pair check ((output_bucket is null) = (output_path is null)),
 constraint cs_character_video_qa_pair check ((qa_approved_at is null) = (qa_approved_by is null)),
 constraint cs_character_video_pub_pair check ((publication_approved_at is null) = (publication_approved_by is null)),
 constraint cs_character_video_publish_gate check (status not in ('approved','scheduled','published') or (qa_approved_at is not null and output_path is not null and output_sha256 is not null)),
 constraint cs_character_video_schedule_gate check (status not in ('scheduled','published') or (publication_approved_at is not null and scheduled_at is not null))
);
create index if not exists cs_character_video_jobs_created_idx on public.cs_character_video_jobs(created_at desc);
create index if not exists cs_character_video_jobs_character_idx on public.cs_character_video_jobs(character_id,status);
alter table public.cs_character_video_jobs enable row level security;
revoke all on public.cs_character_video_jobs from anon,authenticated;
-- Only privileged server-side service-role operations may use this table.
