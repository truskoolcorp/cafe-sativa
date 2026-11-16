create table if not exists public.cs_character_promo_qa_checks(
 id uuid primary key default gen_random_uuid(),
 promo_id uuid not null references public.cs_character_promo_drafts(id) on delete cascade,
 video_sha256 text not null check(video_sha256 ~ '^[a-f0-9]{64}$'),
 check_name text not null check(check_name in ('mp4_integrity','canonical_likeness','canonical_speech','lip_sync','visual_text','rights','duration','brand_safety')),
 result text not null check(result in ('pass','fail','needs_review')),
 evidence text not null default '',
 reviewer_id uuid,
 created_at timestamptz not null default now(),
 unique(promo_id,video_sha256,check_name)
);
alter table public.cs_character_promo_qa_checks enable row level security;
revoke all on public.cs_character_promo_qa_checks from anon,authenticated;
