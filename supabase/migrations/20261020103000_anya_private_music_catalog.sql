-- Private, evidence-labelled music catalog for Anya. Observed releases are not verified tracks.
create table if not exists public.cs_music_catalog (
 id uuid primary key default gen_random_uuid(),
 source text not null check (source in ('owner_distrokid_inventory','distrokid_metadata','owner_upload','verified_streaming')),
 source_key text not null unique,
 release_title text not null,
 artist_name text not null,
 release_type text not null default 'unknown' check(release_type in ('unknown','single','multi_track')),
 reported_track_count integer check(reported_track_count > 0),
 catalog_status text not null default 'needs_verification' check(catalog_status in ('needs_verification','verified','withdrawn')),
 streaming_status text not null default 'unverified' check(streaming_status in ('unverified','live','unavailable')),
 isrc text, upc text, release_date date,
 artwork_path text, audio_master_path text,
 source_note text not null default '',
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
alter table public.cs_music_catalog enable row level security;
revoke all on public.cs_music_catalog from anon, authenticated;
create index if not exists cs_music_artist_index on public.cs_music_catalog(artist_name, release_title);
create table if not exists public.cs_music_tracks (
 id uuid primary key default gen_random_uuid(),
 catalog_id uuid not null references public.cs_music_catalog(id) on delete cascade,
 track_number integer not null check(track_number>0),
 title text not null,
 featured_artist text,
 isrc text,
 duration_ms integer check(duration_ms>0),
 master_path text,
 lead_vocal_path text,
 instrumental_path text,
 eligibility text not null default 'needs_verification' check(eligibility in ('needs_verification','eligible','excluded')),
 unique(catalog_id,track_number)
);
alter table public.cs_music_tracks enable row level security;
revoke all on public.cs_music_tracks from anon,authenticated;
