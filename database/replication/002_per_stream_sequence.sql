-- Sandbox v2: per-stream contiguous sequence, not a global identity.
-- Apply only after reviewing historical staging rows; production use prohibited.
alter table cs_replication_v1.writer_lease add column if not exists next_sequence bigint not null default 0;
update cs_replication_v1.writer_lease l
 set next_sequence=coalesce((select max(o.sequence_no) from cs_replication_v1.outbox o where o.stream=l.stream),0);
alter table cs_replication_v1.outbox drop constraint outbox_pkey;
alter table cs_replication_v1.outbox alter column sequence_no drop identity if exists;
alter table cs_replication_v1.outbox add constraint outbox_pkey primary key(stream,sequence_no);
create or replace function cs_replication_v1.append_event(
 p_stream text,p_writer text,p_epoch bigint,p_action text,p_key text,p_payload jsonb
) returns bigint language plpgsql security invoker set search_path=pg_catalog,cs_replication_v1 as $$
declare next_seq bigint;
begin
 update cs_replication_v1.writer_lease set next_sequence=next_sequence+1,
 updated_at=clock_timestamp()
 where stream=p_stream and writer_id=p_writer and epoch=p_epoch
 and lease_until>clock_timestamp()
 returning next_sequence into next_seq;
 if next_seq is null then raise exception 'writer_fenced'; end if;
 insert into cs_replication_v1.outbox(sequence_no,stream,writer_epoch,action,aggregate_key,payload)
 values(next_seq,p_stream,p_epoch,p_action,p_key,p_payload);
 return next_seq;
end $$;
