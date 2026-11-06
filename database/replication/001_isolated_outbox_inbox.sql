-- ISOLATED SANDBOX ONLY. Apply separately to dedicated Neon staging and Supabase preview.
-- Never apply to production before write paths have been fenced.
create schema if not exists cs_replication_v1;
create table if not exists cs_replication_v1.writer_lease (
 stream text primary key,
 epoch bigint not null check(epoch > 0),
 writer_id text not null,
 lease_until timestamptz not null,
 updated_at timestamptz not null default clock_timestamp()
);
create table if not exists cs_replication_v1.outbox (
 sequence_no bigint generated always as identity primary key,
 stream text not null,
 writer_epoch bigint not null,
 event_id uuid not null unique default gen_random_uuid(),
 action text not null check(action in ('upsert','delete')),
 aggregate_key text not null,
 payload jsonb,
 created_at timestamptz not null default clock_timestamp(),
 check(action <> 'upsert' or payload is not null)
);
create table if not exists cs_replication_v1.inbox (
 stream text not null,
 sequence_no bigint not null,
 event_id uuid not null unique,
 writer_epoch bigint not null,
 action text not null check(action in ('upsert','delete')),
 aggregate_key text not null,
 payload jsonb,
 applied_at timestamptz not null default clock_timestamp(),
 primary key(stream,sequence_no)
);
create table if not exists cs_replication_v1.checkpoint (
 stream text primary key,
 last_sequence bigint not null default 0,
 writer_epoch bigint not null default 0,
 updated_at timestamptz not null default clock_timestamp()
);
create or replace function cs_replication_v1.append_event(
 p_stream text,p_writer text,p_epoch bigint,p_action text,p_key text,p_payload jsonb
) returns bigint language plpgsql security invoker set search_path=pg_catalog,cs_replication_v1 as $$
declare next_seq bigint;
begin
 if not exists(select 1 from cs_replication_v1.writer_lease
   where stream=p_stream and writer_id=p_writer and epoch=p_epoch
     and lease_until > clock_timestamp() for update)
 then raise exception 'writer_fenced'; end if;
 insert into cs_replication_v1.outbox(stream,writer_epoch,action,aggregate_key,payload)
 values(p_stream,p_epoch,p_action,p_key,p_payload) returning sequence_no into next_seq;
 return next_seq;
end $$;
create or replace function cs_replication_v1.apply_event(
 p_stream text,p_sequence bigint,p_event uuid,p_epoch bigint,p_action text,
 p_key text,p_payload jsonb
) returns text language plpgsql security invoker set search_path=pg_catalog,cs_replication_v1 as $$
declare cp bigint; existing record;
begin
 insert into cs_replication_v1.checkpoint(stream) values(p_stream) on conflict do nothing;
 select last_sequence into cp from cs_replication_v1.checkpoint where stream=p_stream for update;
 select event_id,writer_epoch,action,aggregate_key,payload into existing
   from cs_replication_v1.inbox where stream=p_stream and sequence_no=p_sequence;
 if found then
   if existing.event_id<>p_event or existing.writer_epoch<>p_epoch
     or existing.action<>p_action or existing.aggregate_key<>p_key
     or existing.payload is distinct from p_payload
   then raise exception 'conflicting_replay'; end if;
   return 'duplicate';
 end if;
 if p_sequence<>cp+1 then raise exception 'sequence_gap'; end if;
 insert into cs_replication_v1.inbox(stream,sequence_no,event_id,writer_epoch,action,aggregate_key,payload)
 values(p_stream,p_sequence,p_event,p_epoch,p_action,p_key,p_payload);
 update cs_replication_v1.checkpoint set last_sequence=p_sequence,
 writer_epoch=p_epoch,updated_at=clock_timestamp() where stream=p_stream;
 return 'applied';
end $$;
revoke all on schema cs_replication_v1 from public;
revoke all on all tables in schema cs_replication_v1 from public;
revoke execute on all functions in schema cs_replication_v1 from public;
