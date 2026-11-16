create table if not exists public.cs_programming_proposals (
 id uuid primary key default gen_random_uuid(),
 proposal_key text not null unique,
 proposed_month text not null check (proposed_month ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'),
 performance_type text not null check(performance_type in ('music','comedy','spoken_word','interview','other')),
 title text not null check(length(title) between 1 and 240),
 description text not null default '',
 production_brief text not null default '',
 artist_name text,
 source_catalog_id uuid references public.cs_music_catalog(id),
 source_evidence jsonb not null default '[]'::jsonb,
 confidence text not null default 'low' check(confidence in ('low','medium','high')),
 status text not null default 'draft' check(status in ('draft','owner_review','revision_requested','concept_approved','rejected')),
 source_type text not null default 'inventory' check(source_type in ('inventory','evidence_analysis','owner')),
 proposed_start timestamptz,
 owner_reviewed_at timestamptz,
 owner_reviewed_by uuid,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check(status not in ('concept_approved','rejected') or (owner_reviewed_at is not null and owner_reviewed_by is not null))
);
alter table public.cs_programming_proposals enable row level security;
revoke all on public.cs_programming_proposals from anon,authenticated;
create unique index if not exists cs_programming_one_music_proposal_per_month on public.cs_programming_proposals(proposed_month) where performance_type='music' and status <> 'rejected';
comment on table public.cs_programming_proposals is 'Private proposals only: never auto-create public events or authorize paid video jobs.';
