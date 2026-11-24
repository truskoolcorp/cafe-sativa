-- Fresh one-shot runner only. No production migration.
create table public.host_conversations (
 id uuid default gen_random_uuid() primary key, user_id uuid, session_id text,
 host_agent text not null, surface text not null check (surface in ('web-chat','email','mall-3d')), room_id text,
 started_at timestamptz not null default now(), ended_at timestamptz, check (user_id is not null or session_id is not null)
);
create table public.host_messages (
 id uuid default gen_random_uuid() primary key,
 conversation_id uuid not null references public.host_conversations(id), role text not null check(role in ('user','assistant','system')),
 content text not null, created_at timestamptz not null default now()
);
create table public.qa_gallery_items(slug text primary key,title text not null,description text not null,
 kind text not null, artist_name text not null, created_at timestamptz not null default now(), published boolean not null);
create view public.gallery_v with (security_invoker=true) as
 SELECT slug,title,description,kind,artist_name,created_at FROM public.qa_gallery_items WHERE published;
alter table public.qa_gallery_items enable row level security;
create policy public_only on public.qa_gallery_items for select to anon using (published);
grant select on public.qa_gallery_items, public.gallery_v to anon;
alter table public.host_conversations enable row level security;
alter table public.host_messages enable row level security;
grant select, insert on public.host_conversations,public.host_messages to service_role;
insert into public.qa_gallery_items(slug,title,description,kind,artist_name,published) values
 ('qa-art','QA Selected Relief','QA publishable selected work','digital','QA Studio',true),
 ('qa-alternate','QA Alternate Study','QA publishable alternative work','physical','QA Studio',true),
 ('qa-nft','QA NFT NOT ALLOWED','NFT excluded in application','nft','QA Studio',true),
 ('qa-hidden','QA PRIVATE NOT ALLOWED','Private not exposed by the view','digital','QA Studio',false);
notify pgrst, 'reload schema';
