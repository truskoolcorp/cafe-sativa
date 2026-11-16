-- REVIEW ONLY. No rows, approval backfill, publication or runtime activation.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
create table public.cs_venue_media_watermark_reviews (
 job_id uuid not null references public.cs_content_jobs(id),
 object_path text not null check(object_path ~ '^[0-9a-fA-F-]{36}\.mp4$' or object_path ~ '^variants/[0-9a-fA-F-]{36}/[a-f0-9]{64}-(feed|landscape)-preserve-frame-v1/[a-f0-9]{64}\.mp4$'),
 sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
 result text not null check(result in ('pass','fail','needs_review')),
 reviewer_id uuid not null references auth.users(id),
 reviewed_at timestamptz not null default clock_timestamp(),
 evidence text not null check(length(btrim(evidence)) between 1 and 1000),
 primary key(job_id,object_path,sha256)
);
alter table public.cs_venue_media_watermark_reviews enable row level security;
revoke all on public.cs_venue_media_watermark_reviews from public,anon,authenticated,service_role;
-- Existing trusted server can read only; writing truthful reviews remains a separate
-- reviewed admin path. No direct general-client inserts or automatic pass.
grant select on public.cs_venue_media_watermark_reviews to service_role;
create function public.cs_record_venue_watermark_review(p_job_id uuid,p_job_revision timestamptz,p_object_path text,p_sha256 text,p_result text,p_evidence text,p_actor uuid,p_expected_review_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare j public.cs_content_jobs; prior public.cs_venue_media_watermark_reviews; saved public.cs_venue_media_watermark_reviews;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'READ COMMITTED required'; end if;
 if not exists(select 1 from auth.users where id=p_actor and raw_app_meta_data->'cafe_sativa_admin'='true'::jsonb) then raise exception 'Admin required'; end if;
 select * into j from public.cs_content_jobs where id=p_job_id for update;
 if not exists(select 1 from auth.users where id=p_actor and raw_app_meta_data->'cafe_sativa_admin'='true'::jsonb) then raise exception 'Admin revoked'; end if;
 if j.id is null or j.updated_at is distinct from p_job_revision then return null; end if;
 if p_object_path is distinct from j.output_url and p_object_path !~ ('^variants/'||j.id::text||'/[a-f0-9]{64}-(feed|landscape)-preserve-frame-v1/'||p_sha256||'\.mp4$') then return null; end if;
 if p_result='pass' and p_sha256 in ('a20bd6a7f813370991031840a105a6b3bbac66d28dddbe13dd6dedf920a4903d','ed8153e2ddd80b3099823eec24c22327cccad3eabdc4c0a039d4425b5f3a52e7','70f2ad3fe14420e472908850576b3240bbad2a3e6d121ae2f89a7da77148f4e0') then return null; end if;
 select * into prior from public.cs_venue_media_watermark_reviews where job_id=j.id and object_path=p_object_path and sha256=p_sha256;
 if prior.reviewed_at is distinct from p_expected_review_at then return null; end if;
 insert into public.cs_venue_media_watermark_reviews(job_id,object_path,sha256,result,reviewer_id,evidence) values(j.id,p_object_path,p_sha256,p_result,p_actor,p_evidence)
 on conflict(job_id,object_path,sha256) do update set result=excluded.result,reviewer_id=excluded.reviewer_id,evidence=excluded.evidence,reviewed_at=clock_timestamp() returning * into saved;
 return to_jsonb(saved);
end $$;
revoke all on function public.cs_record_venue_watermark_review(uuid,timestamptz,text,text,text,text,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.cs_record_venue_watermark_review(uuid,timestamptz,text,text,text,text,uuid,timestamptz) to service_role;
commit;
