-- Applied to production as proposal_decision_audit_atomic.
create table if not exists public.cs_programming_proposal_audit (
 id uuid primary key default gen_random_uuid(),
 proposal_id uuid not null references public.cs_programming_proposals(id) on delete cascade,
 action text not null check (action in ('revised','concept_approved','rejected')),
 before_state jsonb not null,
 after_state jsonb not null,
 actor_id uuid not null,
 created_at timestamptz not null default now()
);
alter table public.cs_programming_proposal_audit enable row level security;
revoke all on public.cs_programming_proposal_audit from anon, authenticated;
create index if not exists cs_programming_proposal_audit_lookup on public.cs_programming_proposal_audit(proposal_id,created_at desc);
create or replace function public.cs_decide_programming_proposal(p_id uuid,p_expected_status text,p_action text,p_actor uuid)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare old_row public.cs_programming_proposals%rowtype; new_row public.cs_programming_proposals%rowtype;
begin
 if p_actor is null or p_action not in ('concept_approved','rejected') then raise exception 'Invalid decision'; end if;
 select * into old_row from public.cs_programming_proposals where id=p_id for update;
 if not found or old_row.status <> p_expected_status or old_row.status not in ('draft','owner_review','revision_requested') then raise exception 'Proposal state changed'; end if;
 update public.cs_programming_proposals set status=p_action,owner_reviewed_at=now(),owner_reviewed_by=p_actor,updated_at=now() where id=p_id returning * into new_row;
 insert into public.cs_programming_proposal_audit(proposal_id,action,before_state,after_state,actor_id) values(p_id,p_action,to_jsonb(old_row),to_jsonb(new_row),p_actor);
 return jsonb_build_object('id',p_id,'status',p_action);
end $$;
revoke all on function public.cs_decide_programming_proposal(uuid,text,text,uuid) from public, anon, authenticated;
