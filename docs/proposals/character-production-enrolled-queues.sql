-- OFFLINE ONLY. No grants, table changes, enrollment, activation or raw RPC edits.
BEGIN;
CREATE FUNCTION public.character_production_scheduler_due(p_enrollment uuid,p_provider text,p_model text,p_limit integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE e character_production.scheduler_enrollments; result jsonb;
BEGIN
 e:=character_production.scheduler_current(p_enrollment);
 IF e.id IS NULL OR p_limit IS NULL OR p_limit<1 OR p_limit>25 THEN RETURN NULL; END IF;
 WITH observed AS (SELECT clock_timestamp() at), due AS (
 SELECT jsonb_build_object('slot',a.slot,'digest',a.digest,'scheduledAt',floor(extract(epoch FROM s.scheduled_at)*1000)::bigint,'notAfter',floor(extract(epoch FROM s.not_after)*1000)::bigint) row,s.scheduled_at,a.key
 FROM character_production.scheduler_candidates c
 JOIN character_production.approved_slots a ON a.key=c.slot->>'key' AND a.digest=c.digest AND a.slot=c.slot
 JOIN character_production.schedules s ON s.key=a.key AND s.digest=a.digest AND s.scheduled_at=c.scheduled_at
 JOIN character_production.budgets b ON b.provider=a.slot->>'provider' AND b.period=a.slot->>'period'
 CROSS JOIN observed o
 WHERE c.enrollment_id=e.id AND s.enabled AND a.enabled AND b.enabled
 AND (b.provider<>'heygen' OR b.cap_cents<=2000)
 AND a.slot->>'provider'=p_provider AND a.slot->>'model'=p_model
 AND a.slot->>'period'=character_production.calendar_period(p_provider,o.at)
 AND b.cap_cents=(a.slot->>'periodCapCents')::bigint
 AND s.scheduled_at<=o.at AND s.not_after>o.at
 AND s.not_after=to_timestamp((a.slot->>'authorizationExpiresAt')::numeric/1000)
 AND NOT EXISTS(SELECT 1 FROM character_production.jobs j WHERE j.key=a.key)
 ORDER BY s.scheduled_at,a.key LIMIT p_limit
 ) SELECT jsonb_build_object('observedAt',floor(extract(epoch FROM o.at)*1000)::bigint,'rows',coalesce((SELECT jsonb_agg(d.row ORDER BY d.scheduled_at,d.key) FROM due d),'[]'::jsonb)) INTO result FROM observed o;
 RETURN result;
END $$;
CREATE FUNCTION public.character_production_scheduler_pending(p_enrollment uuid,p_provider text,p_model text,p_limit integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE e character_production.scheduler_enrollments; result jsonb;
BEGIN
 e:=character_production.scheduler_current(p_enrollment);
 IF e.id IS NULL OR p_limit IS NULL OR p_limit<1 OR p_limit>5 THEN RETURN NULL; END IF;
 SELECT coalesce(jsonb_agg(x.j ORDER BY x.created_at,x.key),'[]'::jsonb) INTO result FROM (
 SELECT jsonb_build_object('key',j.key,'token',j.token,'digest',j.digest,'taskId',j.task,'provider',j.provider,'model',j.model,'providerBindingRevision',j.provider_binding_revision) j,j.created_at,j.key
 FROM character_production.jobs j
 JOIN character_production.scheduler_candidates c ON c.slot->>'key'=j.key AND c.digest=j.digest AND c.slot=j.slot
 WHERE c.enrollment_id=e.id AND j.state='submitted' AND j.provider=p_provider AND j.model=p_model
 ORDER BY j.created_at,j.key LIMIT p_limit
 ) x;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.character_production_scheduler_due(uuid,text,text,integer),public.character_production_scheduler_pending(uuid,text,text,integer) FROM PUBLIC;
DO $$ DECLARE r text; BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role','character_production_generator','character_production_output_broker'] LOOP
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
 EXECUTE format('REVOKE ALL ON FUNCTION public.character_production_scheduler_due(uuid,text,text,integer),public.character_production_scheduler_pending(uuid,text,text,integer) FROM %I',r);
 END IF; END LOOP;
END $$;
COMMIT;
