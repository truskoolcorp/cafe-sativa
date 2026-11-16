-- Disposable database only. Ordinary fixtures, no production data or elevated attack probes.
create role anon;
create role authenticated;
create role service_role;
create schema auth;
create table auth.users(id uuid primary key, raw_app_meta_data jsonb not null);
