-- Canonical character speaking promotions; never paid-render or publish unverified media.
create table if not exists public.cs_character_promo_drafts (
 id uuid primary key default gen_random_uuid(),
 character_id text not null,
 promo_key text not null unique,
 specialty text not null,
 title text not null,
 spoken_script text not null,
 visual_brief text not null,
 intended_channel text not null default 'character_profile_unconfirmed',
 duration_seconds integer not null check(duration_seconds between 8 and 45),
 status text not null default 'draft' check(status in ('draft','revision_requested','script_approved','rejected')),
 evidence jsonb not null default '{}'::jsonb,
 linked_event_id uuid,
 actual_social_account text,
 audio_asset_path text,
 video_asset_path text,
 voice_approved_at timestamptz,
 video_qa_approved_at timestamptz,
 publication_approved_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check (status <> 'script_approved' or voice_approved_at is not null)
);
alter table public.cs_character_promo_drafts enable row level security;
revoke all on public.cs_character_promo_drafts from anon,authenticated;
create table if not exists public.cs_character_promo_delivery_plans (
 id uuid primary key default gen_random_uuid(),
 promo_id uuid not null references public.cs_character_promo_drafts(id),
 character_id text not null,
 network text not null,
 account_id text,
 scheduled_at timestamptz not null,
 status text not null default 'blocked_assets' check(status in ('blocked_assets','ready_for_delivery','submitted','confirmed','failed')),
 provider_receipt jsonb,
 created_at timestamptz not null default now(),
 unique(promo_id,network)
);
alter table public.cs_character_promo_delivery_plans enable row level security;
revoke all on public.cs_character_promo_delivery_plans from anon,authenticated;
