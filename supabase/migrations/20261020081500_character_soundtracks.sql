-- Preserve external soundtrack provenance without obtaining or copying external audio.
alter table public.cs_character_video_jobs
 add column if not exists audio_source_url text,
 add column if not exists audio_source_provider text,
 add column if not exists audio_rights_status text not null default 'unverified',
 add column if not exists audio_asset_sha256 text;
alter table public.cs_character_video_jobs drop constraint if exists cs_character_video_audio_rights_status;
alter table public.cs_character_video_jobs add constraint cs_character_video_audio_rights_status check (audio_rights_status in ('unverified','verified_permitted_download','rejected'));
alter table public.cs_character_video_jobs drop constraint if exists cs_character_video_audio_sha;
alter table public.cs_character_video_jobs add constraint cs_character_video_audio_sha check (audio_asset_sha256 is null or audio_asset_sha256 ~ '^[0-9a-f]{64}$');
alter table public.cs_character_video_jobs drop constraint if exists cs_character_video_soundtrack_publish_gate;
alter table public.cs_character_video_jobs add constraint cs_character_video_soundtrack_publish_gate check (status not in ('approved','scheduled','published') or audio_source_url is null or (audio_rights_status='verified_permitted_download' and audio_asset_sha256 is not null));
