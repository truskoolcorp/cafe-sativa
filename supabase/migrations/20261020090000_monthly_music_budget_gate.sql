-- Character music production budget and monthly cadence; no auto-spend or calendar bookings.
alter table public.cs_character_video_jobs add column if not exists production_kind text not null default 'character_video';
alter table public.cs_character_video_jobs add column if not exists performance_month text;
alter table public.cs_character_video_jobs add column if not exists budget_cap_usd numeric(10,2);
alter table public.cs_character_video_jobs add column if not exists budget_approved_by uuid;
alter table public.cs_character_video_jobs add column if not exists budget_approved_at timestamptz;
alter table public.cs_character_video_jobs add column if not exists spend_usd numeric(10,2) not null default 0;
alter table public.cs_character_video_jobs add constraint cs_cv_kind_check check (production_kind in ('character_video','full_music_performance'));
alter table public.cs_character_video_jobs add constraint cs_cv_month_check check (performance_month is null or performance_month ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$');
alter table public.cs_character_video_jobs add constraint cs_cv_month_required check (production_kind <> 'full_music_performance' or performance_month is not null);
alter table public.cs_character_video_jobs add constraint cs_cv_budget_amounts check (spend_usd >= 0 and (budget_cap_usd is null or (budget_cap_usd > 0 and spend_usd <= budget_cap_usd)));
alter table public.cs_character_video_jobs add constraint cs_cv_approval_pair check ((budget_approved_at is null) = (budget_approved_by is null));
alter table public.cs_character_video_jobs add constraint cs_cv_paid_gate check (production_kind <> 'full_music_performance' or status not in ('ready_for_generation','rendering','pending_qa','approved','scheduled','published') or (budget_cap_usd is not null and budget_approved_at is not null and budget_approved_by is not null));
create unique index if not exists cs_cv_one_music_per_month on public.cs_character_video_jobs(performance_month) where production_kind='full_music_performance' and status not in ('rejected');
