-- Evidence ledger for optional metadata reconciliation; never overwrite owner inventory automatically.
create table if not exists public.cs_music_metadata_matches (
 id uuid primary key default gen_random_uuid(),
 catalog_id uuid not null references public.cs_music_catalog(id) on delete cascade,
 provider text not null check (provider in ('musicbrainz','listenbrainz')),
 provider_entity_id text not null,
 provider_entity_type text not null check (provider_entity_type in ('release','release_group','recording','artist')),
 match_status text not null default 'candidate' check(match_status in ('candidate','review_required','verified','rejected')),
 match_confidence text not null default 'unverified' check(match_confidence in ('unverified','low','medium','high')),
 metadata jsonb not null default '{}'::jsonb,
 observed_at timestamptz not null default now(),
 reviewed_at timestamptz,
 reviewed_by uuid,
 unique(catalog_id,provider,provider_entity_type,provider_entity_id),
 constraint cs_music_verified_has_reviewer check(match_status<>'verified' or (reviewed_at is not null and reviewed_by is not null))
);
alter table public.cs_music_metadata_matches enable row level security;
revoke all on public.cs_music_metadata_matches from anon,authenticated;
create index if not exists cs_music_metadata_pending on public.cs_music_metadata_matches(match_status,observed_at desc);
