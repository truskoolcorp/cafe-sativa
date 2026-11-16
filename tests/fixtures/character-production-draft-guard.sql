-- TEST FIXTURE ONLY. Read-only pg_get_functiondef capture on 2026-11-11.
-- Exact cs_promo_private.guard_source() body; synthetic dependencies in tests.
-- Contains SQL logic only, no customer rows, credentials or account identifiers.
CREATE OR REPLACE FUNCTION cs_promo_private.guard_source()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare v_id uuid; g cs_promo_private.gates; expected jsonb; column_name text;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'Promo mutations require READ COMMITTED'; end if;
 if tg_table_name='cs_character_promo_drafts' then v_id:=old.id;
 else
  if tg_op='UPDATE' and new.promo_id is distinct from old.promo_id then raise exception 'Promo ownership is immutable'; end if;
  if tg_op='DELETE' then v_id:=old.promo_id; else v_id:=new.promo_id; end if;
 end if;
 perform 1 from public.cs_character_promo_drafts where id=v_id for update;
 if exists(select 1 from cs_promo_private.attempts a join public.cs_character_promo_delivery_plans p on p.id=a.plan_id where p.promo_id=v_id) then raise exception 'Claimed promo is frozen; manual reconciliation required'; end if;
 if tg_op='UPDATE' and tg_table_name='cs_character_promo_drafts' then
  for g in select x.* from cs_promo_private.gates x join public.cs_character_promo_delivery_plans p on p.id=x.plan_id where p.promo_id=v_id and not x.draft_applied and not x.invalidated loop
   column_name:=case g.gate when 'voice' then 'voice_approved_at' when 'video' then 'video_qa_approved_at' else 'publication_approved_at' end;
   expected:=jsonb_set(jsonb_set(to_jsonb(old),array[column_name],to_jsonb(g.confirmed_at)),'{updated_at}',to_jsonb(g.confirmed_at));
   if to_jsonb(new)=expected then
    update cs_promo_private.approvals a set invalidated=true from public.cs_character_promo_delivery_plans p where p.id=a.plan_id and p.promo_id=v_id;
    update cs_promo_private.gates set draft_applied=true where generation_id=g.generation_id and gate=g.gate;
    return new;
   end if;
  end loop;
 end if;
 if tg_op='UPDATE' and tg_table_name='cs_character_promo_delivery_plans' then
  select x.* into g from cs_promo_private.gates x join cs_promo_private.review_heads h on h.generation_id=x.generation_id where x.plan_id=old.id and x.gate='publication' and x.draft_applied and not x.plan_applied and not x.invalidated;
  if found and to_jsonb(new)=jsonb_set(to_jsonb(old),'{status}','"ready_for_delivery"'::jsonb) then
   update cs_promo_private.gates set plan_applied=true where generation_id=g.generation_id and gate=g.gate;
   return new;
  end if;
 end if;
 update cs_promo_private.approvals a set invalidated=true from public.cs_character_promo_delivery_plans p where p.id=a.plan_id and p.promo_id=v_id;
 update cs_promo_private.review_versions r set invalidated=true from public.cs_character_promo_delivery_plans p where p.id=r.plan_id and p.promo_id=v_id;
 update cs_promo_private.gates x set invalidated=true from public.cs_character_promo_delivery_plans p where p.id=x.plan_id and p.promo_id=v_id;
 if tg_op='DELETE' then return old; else return new; end if;
end $function$

