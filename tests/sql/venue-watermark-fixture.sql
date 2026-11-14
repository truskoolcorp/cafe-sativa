create role anon;create role authenticated;create role service_role bypassrls;
create schema auth;
create table auth.users(id uuid primary key,raw_app_meta_data jsonb);
create table public.cs_content_jobs(id uuid primary key,output_url text,updated_at timestamptz);
insert into auth.users values('00000000-0000-0000-0000-000000000001','{"cafe_sativa_admin":true}');
insert into public.cs_content_jobs values('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002.mp4','2026-01-01');
