create table if not exists public.cs_room_host_assignments (
 room_key text not null,
 character_id text not null,
 role text not null check (role in ('primary_host','guest_chef','guest_host','support')),
 assignment_status text not null default 'active' check (assignment_status in ('active','inactive')),
 source_note text not null,
 updated_at timestamptz not null default now(),
 primary key (room_key,character_id)
);
create unique index if not exists cs_room_one_primary_host on public.cs_room_host_assignments(room_key) where role='primary_host' and assignment_status='active';
alter table public.cs_room_host_assignments enable row level security;
revoke all on public.cs_room_host_assignments from anon,authenticated;
insert into public.cs_room_host_assignments(room_key,character_id,role,assignment_status,source_note)
values
 ('kitchen','andromeda-zouganelis','primary_host','active','Owner direction 2026-10-21: Andromeda is initial host of The Kitchen'),
 ('kitchen','chef-v','guest_chef','active','Owner direction 2026-10-21: Chef V is a guest chef, not the primary Kitchen host')
on conflict (room_key,character_id) do update set role=excluded.role,assignment_status=excluded.assignment_status,source_note=excluded.source_note,updated_at=now();