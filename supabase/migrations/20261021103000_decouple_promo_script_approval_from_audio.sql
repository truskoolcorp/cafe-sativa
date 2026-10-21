alter table public.cs_character_promo_drafts drop constraint if exists cs_character_promo_drafts_check;
comment on column public.cs_character_promo_drafts.status is 'Script review independent of delivered audio. Voice and video QA remain separate publication gates.';
