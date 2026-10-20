create table if not exists public.cs_music_artist_sources (
 id uuid primary key default gen_random_uuid(),
 artist_name text not null references public.cs_music_artist_identity(artist_name),
 provider text not null check(provider in ('youtube_official_artist','musicbrainz','distrokid','spotify','apple_music')),
 external_id text not null,
 canonical_url text,
 assertion_source text not null default 'owner',
 verification_status text not null default 'owner_asserted' check(verification_status in ('owner_asserted','provider_verified','rejected')),
 metadata jsonb not null default '{}'::jsonb,
 observed_at timestamptz not null default now(),
 unique(provider,external_id)
);
alter table public.cs_music_artist_sources enable row level security;
revoke all on public.cs_music_artist_sources from anon,authenticated;
insert into public.cs_music_artist_sources(artist_name,provider,external_id,canonical_url,assertion_source,verification_status)
values ('THE Verse Alkemist','youtube_official_artist','UCxm__KM9V9qFO2WN6NhkykA','https://www.youtube.com/channel/UCxm__KM9V9qFO2WN6NhkykA','owner','owner_asserted')
on conflict(provider,external_id) do nothing;