-- Reviewed venue tours have their own website category; Community stays the long-table format.
alter table public.content_items drop constraint content_items_site_category_check;
alter table public.content_items add constraint content_items_site_category_check
  check (site_category in ('stage','kitchen','cigar_lounge','bar','gallery','community','venue'));

-- One automatic paid take per master. Reuse approved media; unresolved/rejected
-- takes require review rather than another automatic charge. Asset-level locking
-- also prevents two different jobs racing for the same initial master.
create or replace function public.cs_claim_generation(job_id uuid,cost_cents integer,asset_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$
declare job public.cs_content_jobs;
  month_start date:=date_trunc('month',now() at time zone 'America/Chicago')::date;
begin
  if cost_cents is null or cost_cents<=0 or cost_cents>2500 then return false; end if;
  select * into job from public.cs_content_jobs where id=job_id for update;
  if not found or job.status not in ('planned','blocked') or job.estimated_cost_cents>0
     or job.policy_version is distinct from '2026-10-07' then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended(asset_id::text,0));
  perform 1 from public.cs_canonical_assets where id=asset_id and kind='venue' and subject=job.room
    and active and approved_by is not null and approved_at is not null for share;
  if not found then return false; end if;
  if exists(select 1 from public.cs_content_jobs prior where prior.canonical_asset_id=asset_id and prior.id<>job_id
    and (prior.estimated_cost_cents>0 or prior.status in ('submitting','generating','pending_qa','submission_unknown')
      or (prior.status in ('approved','scheduled','published') and prior.qa_approved_by is not null
          and prior.qa_approved_at is not null and prior.output_url is not null))) then return false; end if;
  insert into public.cs_content_budget(month) values(month_start) on conflict do nothing;
  update public.cs_content_budget set reserved_cents=reserved_cents+cost_cents
    where month=month_start and reserved_cents+cost_cents<=2500;
  if not found then return false; end if;
  update public.cs_content_jobs set status='submitting',canonical_asset_id=asset_id,
    estimated_cost_cents=cost_cents,budget_month=month_start,blocker=null,updated_at=now() where id=job_id;
  return true;
end $$;
revoke all on function public.cs_claim_generation(uuid,integer,uuid) from public,anon,authenticated;
grant execute on function public.cs_claim_generation(uuid,integer,uuid) to service_role;
