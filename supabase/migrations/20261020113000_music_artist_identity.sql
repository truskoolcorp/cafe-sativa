create table if not exists public.cs_music_artist_identity (
 id uuid primary key default gen_random_uuid(),
 artist_name text not null unique,
 musicbrainz_artist_mbid uuid unique,
 identity_status text not null default 'unverified' check(identity_status in ('unverified','owner_confirmed','rejected')),
 confirmed_by uuid,
 confirmed_at timestamptz,
 source_note text not null default '',
 created_at timestamptz not null default now(),
 check(identity_status <> 'owner_confirmed' or (musicbrainz_artist_mbid is not null and confirmed_by is not null and confirmed_at is not null))
);
alter table public.cs_music_artist_identity enable row level security;
revoke all on public.cs_music_artist_identity from anon,authenticated;
insert into public.cs_music_artist_identity(artist_name,source_note)
select distinct artist_name,'Owner-provided DistroKid release inventory; MBID not verified'
from public.cs_music_catalog on conflict (artist_name) do nothing;
