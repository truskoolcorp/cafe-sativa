-- OFFLINE OWNER-ONLY PROPOSAL. No runtime grants, enrollment or activation.
-- Depends on reviewed scheduler/QA/planner foundations. Not a migration or
-- permission to install. Existing paid job claims/budgets are never modified.
BEGIN;
DO $$ BEGIN
 IF current_user<>'character_production_owner' THEN RAISE EXCEPTION 'Reviewed restricted owner required'; END IF;
END $$;
CREATE TABLE character_production.recurring_selections(
 enrollment_id uuid NOT NULL,
 ordinal integer NOT NULL,
 phase text NOT NULL CHECK(phase IN ('collect','qa','generate')),
 slot_key text NOT NULL,
 digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),
 state text NOT NULL CHECK(state IN ('in_flight','ready','done','held')),
 token uuid NOT NULL UNIQUE,
 attempts integer NOT NULL CHECK(attempts BETWEEN 1 AND 1000),
 last_selected_at timestamptz NOT NULL,
 next_check_at timestamptz NOT NULL,
 PRIMARY KEY(enrollment_id,ordinal,phase),
 FOREIGN KEY(enrollment_id,ordinal) REFERENCES character_production.scheduler_candidates(enrollment_id,ordinal)
);
ALTER TABLE character_production.recurring_selections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON character_production.recurring_selections FROM PUBLIC;

-- The private eligibility query is not an authorization grant. Each public
-- wrapper first locks and validates scheduler_current and each action keeps its
-- original exact policy, budget, canon, media and duplicate checks.
CREATE FUNCTION character_production.recurring_eligible(p_enrollment uuid)
RETURNS TABLE(ordinal integer,phase text,slot_key text,digest text,payload jsonb)
LANGUAGE sql SET search_path=pg_catalog AS $$
 SELECT c.ordinal,'collect'::text,j.key,j.digest,
 jsonb_build_object('key',j.key,'token',j.token,'digest',j.digest,'taskId',j.task,'provider',j.provider,'model',j.model,'providerBindingRevision',j.provider_binding_revision)
 FROM character_production.scheduler_candidates c
 JOIN character_production.jobs j ON j.key=c.slot->>'key' AND j.digest=c.digest AND j.slot=c.slot
 JOIN character_production.approved_slots a ON a.key=j.key AND a.slot=j.slot AND a.digest=j.digest AND a.enabled
 WHERE c.enrollment_id=p_enrollment AND j.state='submitted'
 UNION ALL
 SELECT c.ordinal,'qa'::text,j.key,j.digest,jsonb_build_object('key',j.key,'digest',j.digest)
 FROM character_production.scheduler_candidates c
 JOIN character_production.jobs j ON j.key=c.slot->>'key' AND j.digest=c.digest AND j.slot=c.slot
 JOIN character_production.approved_slots a ON a.key=j.key AND a.digest=j.digest AND a.slot=j.slot AND a.enabled
 JOIN character_production.qa_slot_bindings b ON b.slot_key=j.key AND b.digest=j.digest AND b.slot=j.slot AND b.enabled AND b.promo_id=c.draft_id
 JOIN public.cs_character_promo_drafts d ON d.id=b.promo_id
 WHERE c.enrollment_id=p_enrollment AND j.state='pending_qa'
 AND public.character_production_qa_draft_unplanned(b.promo_id) AND d.updated_at=b.expected_updated_at
 AND d.character_id=j.slot->>'characterId' AND d.spoken_script=j.slot->>'script'
 AND j.slot->>'characterId' ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,239}$' AND length(btrim(j.slot->>'script'))>0
 AND d.status IN ('draft','revision_requested') AND d.video_asset_path IS NULL AND d.audio_asset_path IS NULL
 AND d.voice_approved_at IS NULL AND d.video_qa_approved_at IS NULL AND d.publication_approved_at IS NULL
 AND j.sha ~ '^[a-f0-9]{64}$' AND j.bytes BETWEEN 16 AND 36700160
 AND j.bucket='character-production-private' AND j.object_path=j.digest||'/'||j.sha||'.mp4'
 AND NOT EXISTS(SELECT 1 FROM character_production.qa_ingestion_receipts r WHERE r.job_key=j.key)
 AND NOT EXISTS(SELECT 1 FROM character_production.qa_targets t WHERE t.job_key=j.key AND
 (t.enabled IS DISTINCT FROM true OR t.digest IS DISTINCT FROM b.digest OR t.promo_id IS DISTINCT FROM b.promo_id OR t.expected_updated_at IS DISTINCT FROM b.expected_updated_at))
 UNION ALL
 SELECT c.ordinal,'generate'::text,a.key,a.digest,
 jsonb_build_object('slot',a.slot,'digest',a.digest,'scheduledAt',floor(extract(epoch FROM s.scheduled_at)*1000)::bigint,'notAfter',floor(extract(epoch FROM s.not_after)*1000)::bigint)
 FROM character_production.scheduler_candidates c
 JOIN character_production.approved_slots a ON a.key=c.slot->>'key' AND a.digest=c.digest AND a.slot=c.slot
 JOIN character_production.schedules s ON s.key=a.key AND s.digest=a.digest AND s.scheduled_at=c.scheduled_at
 JOIN character_production.budgets b ON b.provider=a.slot->>'provider' AND b.period=a.slot->>'period'
 WHERE c.enrollment_id=p_enrollment AND s.enabled AND a.enabled AND b.enabled
 AND (b.provider<>'heygen' OR b.cap_cents<=2000)
 AND a.slot->>'period'=character_production.calendar_period(b.provider,clock_timestamp())
 AND b.cap_cents=(a.slot->>'periodCapCents')::bigint
 AND s.scheduled_at<=clock_timestamp() AND s.not_after>clock_timestamp()
 AND s.not_after=to_timestamp((a.slot->>'authorizationExpiresAt')::numeric/1000)
 AND NOT EXISTS(SELECT 1 FROM character_production.jobs j WHERE j.key=a.key)
 -- Do not create more paid work while any original enrolled task is unfinished
 -- or unknown, including a task whose selection claim is held indefinitely.
 AND NOT EXISTS(SELECT 1 FROM character_production.jobs j
 JOIN character_production.scheduler_candidates original ON original.enrollment_id=p_enrollment
 AND original.slot->>'key'=j.key AND original.slot=j.slot AND original.digest=j.digest
 WHERE j.state IN ('submitting','submitted','unknown'))
$$;
REVOKE ALL ON FUNCTION character_production.recurring_eligible(uuid) FROM PUBLIC;

CREATE FUNCTION public.character_production_recurring_next(p_enrollment uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE e character_production.scheduler_enrollments; chosen record;
 s character_production.recurring_selections; observed timestamptz;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RETURN NULL; END IF;
 e:=character_production.scheduler_current(p_enrollment);
 IF e.id IS NULL THEN RETURN NULL; END IF;
 observed:=clock_timestamp();
 -- Enrollment lock serializes selection; a committed in-flight token has NO
 -- timeout/reclaim path. Other ordinals remain independently selectable.
 SELECT r.* INTO chosen FROM character_production.recurring_eligible(e.id) r
 LEFT JOIN character_production.recurring_selections q ON q.enrollment_id=e.id AND q.ordinal=r.ordinal AND q.phase=r.phase
 WHERE q.enrollment_id IS NULL OR (q.state='ready' AND q.next_check_at<=observed
 AND q.slot_key=r.slot_key AND q.digest=r.digest AND q.attempts<1000)
 -- Unseen work first, then oldest settled selection. Original receipt polling
 -- wins ties, but never monopolizes successive ticks over unseen eligible QA.
 ORDER BY q.last_selected_at ASC NULLS FIRST,
 CASE r.phase WHEN 'collect' THEN 0 WHEN 'qa' THEN 1 ELSE 2 END,r.ordinal
 LIMIT 1;
 IF NOT FOUND OR e.expires_at<=clock_timestamp() THEN RETURN NULL; END IF;
 INSERT INTO character_production.recurring_selections(enrollment_id,ordinal,phase,slot_key,digest,state,token,attempts,last_selected_at,next_check_at)
 VALUES(e.id,chosen.ordinal,chosen.phase,chosen.slot_key,chosen.digest,'in_flight',gen_random_uuid(),1,observed,observed)
 ON CONFLICT(enrollment_id,ordinal,phase) DO UPDATE SET
 state='in_flight',token=gen_random_uuid(),attempts=character_production.recurring_selections.attempts+1,
 last_selected_at=observed,next_check_at=observed
 WHERE character_production.recurring_selections.state='ready'
 AND character_production.recurring_selections.next_check_at<=observed
 AND character_production.recurring_selections.slot_key=EXCLUDED.slot_key
 AND character_production.recurring_selections.digest=EXCLUDED.digest
 AND character_production.recurring_selections.attempts<1000
 RETURNING * INTO s;
 IF NOT FOUND THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('enrollmentId',e.id,'manifestSha256',e.manifest_sha256,
 'ordinal',s.ordinal,'phase',s.phase,'key',s.slot_key,'digest',s.digest,
 'selectionToken',s.token,'observedAt',floor(extract(epoch FROM clock_timestamp())*1000)::bigint,'payload',chosen.payload);
END $$;
REVOKE ALL ON FUNCTION public.character_production_recurring_next(uuid) FROM PUBLIC;

-- Read back ONLY the selected identity, never the head of an unrelated queue.
-- Return NULL after revocation, completion, successor selection or changed
-- eligibility. Worker must not substitute a different due/pending/QA row.
CREATE FUNCTION public.character_production_recurring_selected(p_enrollment uuid,p_token uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE e character_production.scheduler_enrollments; s character_production.recurring_selections; r record;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RETURN NULL; END IF;
 e:=character_production.scheduler_current(p_enrollment);
 IF e.id IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO s FROM character_production.recurring_selections
 WHERE enrollment_id=e.id AND token=p_token AND state='in_flight';
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO r FROM character_production.recurring_eligible(e.id)
 WHERE ordinal=s.ordinal AND phase=s.phase AND slot_key=s.slot_key AND digest=s.digest;
 IF NOT FOUND THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('enrollmentId',e.id,'manifestSha256',e.manifest_sha256,
 'ordinal',s.ordinal,'phase',s.phase,'key',s.slot_key,'digest',s.digest,
 'selectionToken',s.token,'observedAt',floor(extract(epoch FROM clock_timestamp())*1000)::bigint,'payload',r.payload);
END $$;
REVOKE ALL ON FUNCTION public.character_production_recurring_selected(uuid,uuid) FROM PUBLIC;

-- Called only after the ORIGINAL adapter and all transports are settled. An
-- unknown outcome is held permanently. This records scheduling bookkeeping,
-- not a claim of QA/publication and never updates jobs, budgets or source rows.
CREATE FUNCTION public.character_production_recurring_finish(p_enrollment uuid,p_token uuid,p_outcome text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE e character_production.scheduler_enrollments; s character_production.recurring_selections;
 j character_production.jobs; disposition text:='held'; delay_seconds integer:=0;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RETURN NULL; END IF;
 IF p_outcome IS NULL OR p_outcome NOT IN ('settled','held') THEN RETURN NULL; END IF;
 e:=character_production.scheduler_current(p_enrollment);
 IF e.id IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO s FROM character_production.recurring_selections
 WHERE enrollment_id=e.id AND token=p_token AND state='in_flight' FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO j FROM character_production.jobs WHERE key=s.slot_key AND digest=s.digest AND slot=(SELECT c.slot FROM character_production.scheduler_candidates c WHERE c.enrollment_id=e.id AND c.ordinal=s.ordinal);
 IF p_outcome='settled' THEN
  IF s.phase='collect' AND j.state='submitted' AND s.attempts<1000 THEN
   disposition:='ready';delay_seconds:=least(3600,60*power(2,least(s.attempts-1,6))::integer);
  ELSIF s.phase='collect' AND j.state IN ('pending_qa','failed') THEN disposition:='done';
  ELSIF s.phase='generate' AND j.key IS NOT NULL THEN disposition:='done';
  ELSIF s.phase='qa' AND EXISTS(SELECT 1 FROM character_production.qa_ingestion_receipts r
   JOIN character_production.scheduler_candidates c ON c.enrollment_id=e.id AND c.ordinal=s.ordinal
   WHERE r.job_key=s.slot_key AND r.digest=s.digest AND r.promo_id=c.draft_id) THEN disposition:='done';
  END IF;
 END IF;
 UPDATE character_production.recurring_selections SET state=disposition,
 next_check_at=clock_timestamp()+make_interval(secs=>delay_seconds)
 WHERE enrollment_id=s.enrollment_id AND ordinal=s.ordinal AND phase=s.phase;
 RETURN disposition;
END $$;
REVOKE ALL ON FUNCTION public.character_production_recurring_finish(uuid,uuid,text) FROM PUBLIC;
-- Source-owner default ACLs must not accidentally add runtime access.
DO $$ DECLARE r text; BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role','character_production_generator','character_production_output_broker'] LOOP
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
 EXECUTE format('REVOKE ALL ON character_production.recurring_selections FROM %I',r);
 EXECUTE format('REVOKE ALL ON FUNCTION character_production.recurring_eligible(uuid) FROM %I',r);
 EXECUTE format('REVOKE ALL ON FUNCTION public.character_production_recurring_next(uuid), public.character_production_recurring_selected(uuid,uuid), public.character_production_recurring_finish(uuid,uuid,text) FROM %I',r);
 END IF; END LOOP;
END $$;
-- Exact owner-only baseline, including unknown inherited default-ACL roles.
-- Fail rather than silently broadening the reviewed access delta.
DO $$ DECLARE o record; own oid:='character_production_owner'::regrole; BEGIN
 FOR o IN SELECT c.relowner owner,c.relacl acl,'r'::"char" kind
 FROM pg_class c WHERE c.oid='character_production.recurring_selections'::regclass
 UNION ALL SELECT p.proowner,p.proacl,'f'::"char" FROM pg_proc p WHERE p.oid IN (
 'character_production.recurring_eligible(uuid)'::regprocedure,
 'public.character_production_recurring_next(uuid)'::regprocedure,
 'public.character_production_recurring_selected(uuid,uuid)'::regprocedure,
 'public.character_production_recurring_finish(uuid,uuid,text)'::regprocedure)
 LOOP
 IF o.owner<>own OR EXISTS(
 (SELECT * FROM aclexplode(coalesce(o.acl,acldefault(o.kind,own))) EXCEPT SELECT * FROM aclexplode(acldefault(o.kind,own)))
 UNION ALL
 (SELECT * FROM aclexplode(acldefault(o.kind,own)) EXCEPT SELECT * FROM aclexplode(coalesce(o.acl,acldefault(o.kind,own)))))
 THEN RAISE EXCEPTION 'Recurring selection exact owner-only ACL required'; END IF;
 END LOOP;
END $$;
ROLLBACK;
