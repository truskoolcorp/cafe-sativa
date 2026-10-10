-- Dedicated authorization ledger for LiveKit session bridge.
create table if not exists public.cafe_voice_sessions (
  room_name text primary key,
  host_agent text not null check (host_agent in ('laviche', 'ginger', 'ahnika')),
  conversation_id uuid not null references public.host_conversations(id) on delete cascade,
  user_id uuid null,
  session_id text null,
  tier text not null check (tier in ('anonymous','explorer','regular','vip')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz null,
  constraint cafe_voice_identity check (user_id is not null or session_id is not null)
);
create index if not exists cafe_voice_sessions_expiry on public.cafe_voice_sessions(expires_at);
alter table public.cafe_voice_sessions enable row level security;
-- No direct browser grants. Only server-side service role accesses this table.
revoke all on public.cafe_voice_sessions from anon, authenticated;
