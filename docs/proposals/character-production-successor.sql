-- OFFLINE DRAFT ONLY. No install, runtime grants, rows, credentials or activation.
-- Requires separate reviewed EXECUTE on cs_cafe_publication_terminal(uuid) from
-- cafe_metricool_owner to character_production_owner. No grant is made here.
BEGIN;
DO $$ BEGIN IF current_user<>'character_production_owner' THEN RAISE EXCEPTION 'Restricted owner required'; END IF; END $$;
CREATE TABLE character_production.successor_standing(
 id uuid PRIMARY KEY,root_lane uuid NOT NULL UNIQUE REFERENCES character_production.preparation_lanes(id),
 root_snapshot jsonb NOT NULL,config_snapshot jsonb NOT NULL,
 owner_message_ids text[] NOT NULL CHECK(cardinality(owner_message_ids) BETWEEN 1 AND 20),
 authorized_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,enabled boolean NOT NULL DEFAULT false,
 CHECK(expires_at>authorized_at AND expires_at<=authorized_at+interval '31 days')
);
CREATE TABLE character_production.successor_edges(
 standing_id uuid NOT NULL REFERENCES character_production.successor_standing(id),
 day date NOT NULL,prior_lane uuid PRIMARY KEY REFERENCES character_production.preparation_lanes(id),
 prior_occurrence uuid NOT NULL UNIQUE REFERENCES character_production.first_admission_records(occurrence_id),
 prior_enrollment uuid NOT NULL UNIQUE REFERENCES character_production.scheduler_enrollments(id),
 prior_draft uuid NOT NULL UNIQUE,
 next_lane uuid NOT NULL UNIQUE REFERENCES character_production.preparation_lanes(id),
 next_occurrence uuid NOT NULL UNIQUE REFERENCES character_production.preparation_occurrences(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(standing_id,day)
);
ALTER TABLE character_production.successor_standing ENABLE ROW LEVEL SECURITY;
ALTER TABLE character_production.successor_edges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON character_production.successor_standing,character_production.successor_edges FROM PUBLIC;
CREATE FUNCTION character_production.successor_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 IF TG_TABLE_NAME='successor_standing' AND TG_OP='UPDATE' THEN
  IF OLD.enabled AND NOT NEW.enabled AND to_jsonb(OLD)-'enabled'=to_jsonb(NEW)-'enabled' THEN RETURN NEW; END IF;
 END IF;
 RAISE EXCEPTION 'Succession evidence immutable';
END $$;
CREATE TRIGGER successor_standing_immutable BEFORE UPDATE OR DELETE ON character_production.successor_standing FOR EACH ROW EXECUTE FUNCTION character_production.successor_immutable();
CREATE TRIGGER successor_edge_immutable BEFORE UPDATE OR DELETE ON character_production.successor_edges FOR EACH ROW EXECUTE FUNCTION character_production.successor_immutable();
CREATE FUNCTION character_production.successor_revoke() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF OLD.enabled AND NOT NEW.enabled THEN
  UPDATE character_production.preparation_lanes SET enabled=false WHERE enabled AND (id=OLD.root_lane OR id IN(SELECT next_lane FROM character_production.successor_edges WHERE standing_id=OLD.id));
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER successor_standing_revoke AFTER UPDATE ON character_production.successor_standing FOR EACH ROW EXECUTE FUNCTION character_production.successor_revoke();
-- Root config revocation also closes descendant standing authority. Automatic
-- predecessor lane retirement does NOT revoke the standing configuration.
CREATE FUNCTION character_production.successor_root_revoke() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF OLD.enabled AND NOT NEW.enabled THEN UPDATE character_production.successor_standing SET enabled=false WHERE root_lane=OLD.lane_id AND enabled; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER successor_root_config_revoke AFTER UPDATE ON character_production.first_admission_config FOR EACH ROW EXECUTE FUNCTION character_production.successor_root_revoke();
-- Exact predecessor exception only. Does not accept any other dormant binding.
CREATE FUNCTION character_production.successor_admission_prior(p_lane uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE e character_production.successor_edges;s character_production.successor_standing;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RETURN false; END IF;
 SELECT * INTO e FROM character_production.successor_edges WHERE next_lane=p_lane;
 IF e.prior_lane IS NULL THEN RETURN false; END IF;
 SELECT * INTO s FROM character_production.successor_standing WHERE id=e.standing_id FOR SHARE NOWAIT;
 IF NOT coalesce(s.enabled AND s.authorized_at<=clock_timestamp() AND s.expires_at>clock_timestamp(),false) THEN RETURN false; END IF;
 RETURN EXISTS(SELECT 1 FROM character_production.scheduler_binding b JOIN character_production.scheduler_enrollments x ON x.id=b.enrollment_id WHERE b.name='cafe-character-planner' AND b.enrollment_id=e.prior_enrollment AND NOT b.enabled AND NOT x.enabled)
 AND public.cs_cafe_publication_terminal(e.prior_draft) IS TRUE
 AND EXISTS(SELECT 1 FROM character_production.preparation_binding WHERE lane_id=p_lane)
 AND EXISTS(SELECT 1 FROM character_production.first_admission_records r WHERE r.occurrence_id=e.prior_occurrence AND r.lane_id=e.prior_lane AND r.enrollment_id=e.prior_enrollment AND r.draft_id=e.prior_draft AND r.manifest_text IS NOT NULL);
END $$;
CREATE FUNCTION public.character_production_successor_context() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE standing character_production.successor_standing;root character_production.preparation_lanes;prior character_production.preparation_lanes;cfg character_production.first_admission_config;pol character_production.planning_policies;budget character_production.text_replenishment_budgets;rec character_production.first_admission_records;occ character_production.preparation_occurrences;
 bound uuid;newlane uuid;newocc uuid;stamp timestamptz;today date;expiry timestamptz;k text;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RETURN NULL; END IF;
 SELECT lane_id INTO bound FROM character_production.preparation_binding WHERE name='zaria-gallery-preparation';
 IF (SELECT count(*) FROM character_production.successor_standing s WHERE s.root_lane=bound OR EXISTS(SELECT 1 FROM character_production.successor_edges e WHERE e.standing_id=s.id AND e.next_lane=bound))<>1 THEN RETURN NULL; END IF;
 SELECT s.* INTO standing FROM character_production.successor_standing s WHERE s.root_lane=bound OR EXISTS(SELECT 1 FROM character_production.successor_edges e WHERE e.standing_id=s.id AND e.next_lane=bound) FOR UPDATE OF s NOWAIT;
 IF standing.id IS NULL THEN RETURN NULL; END IF;
 stamp:=clock_timestamp();today:=(stamp AT TIME ZONE 'America/Chicago')::date;
 IF NOT standing.enabled OR standing.authorized_at>stamp OR standing.expires_at<=stamp OR EXISTS(SELECT 1 FROM unnest(standing.owner_message_ids) m WHERE m IS NULL OR m!~'^Sentinel_[a-f0-9]{32}$') THEN RETURN NULL; END IF;
 SELECT * INTO root FROM character_production.preparation_lanes WHERE id=standing.root_lane;
 SELECT * INTO cfg FROM character_production.first_admission_config WHERE lane_id=standing.root_lane;
 IF cfg.enabled IS DISTINCT FROM true OR to_jsonb(root)-'enabled' IS DISTINCT FROM standing.root_snapshot-'enabled' OR to_jsonb(cfg)-'enabled' IS DISTINCT FROM standing.config_snapshot-'enabled' THEN RETURN NULL; END IF;
 SELECT * INTO pol FROM character_production.planning_policies WHERE id=cfg.policy_id FOR UPDATE NOWAIT;
 SELECT * INTO prior FROM character_production.preparation_lanes WHERE id=bound FOR UPDATE NOWAIT;
 IF prior.id IS NULL OR pol.id IS NULL OR prior.enabled IS DISTINCT FROM true OR NOT EXISTS(SELECT 1 FROM character_production.first_admission_config WHERE lane_id=bound AND enabled) OR prior.actor_id<>root.actor_id OR public.cs_cafe_metricool_is_admin(root.actor_id) IS DISTINCT FROM true OR NOT pol.enabled OR pol.revision<>cfg.policy_revision OR to_jsonb(pol) IS DISTINCT FROM cfg.policy_snapshot OR pol.period<>to_char(today,'YYYY-MM') OR pol.expires_at<=stamp THEN RETURN NULL; END IF;
 SELECT * INTO occ FROM character_production.preparation_occurrences WHERE lane_id=bound;
 SELECT * INTO rec FROM character_production.first_admission_records WHERE lane_id=bound FOR UPDATE NOWAIT;
 -- Incomplete or current-day original remains the sole work item, never replay.
 IF rec.manifest_text IS NULL OR occ.text_key>='daily:'||today::text||':zaria-solenne' THEN RETURN jsonb_build_object('status','current_occurrence','context',public.character_production_preparation_context()); END IF;
 IF rec.occurrence_id IS DISTINCT FROM occ.id THEN RETURN NULL; END IF;
 -- Actual predecessor planning history, not merely old text, must be prior-day.
 IF NOT EXISTS(SELECT 1 FROM character_production.planning_records r WHERE r.promo_id=rec.draft_id AND r.policy_id=pol.id AND r.policy_revision=pol.revision AND r.slot_key='first:'||occ.id::text AND r.dallas_day<today)
 OR EXISTS(SELECT 1 FROM character_production.planning_records WHERE dallas_day=today)
 OR (SELECT count(*) FROM character_production.planning_records WHERE policy_id=pol.id)>=pol.max_slots
 OR (SELECT coalesce(sum(quote_cents),0) FROM character_production.planning_records WHERE policy_id=pol.id)+(cfg.quote->>'cents')::bigint>pol.cap_cents THEN RETURN NULL; END IF;
 IF EXISTS(SELECT 1 FROM character_production.successor_edges WHERE prior_lane=bound OR (standing_id=standing.id AND day=today)) THEN RETURN NULL; END IF;
 IF NOT EXISTS(SELECT 1 FROM character_production.scheduler_binding b JOIN character_production.scheduler_enrollments e ON e.id=b.enrollment_id JOIN character_production.scheduler_candidates c ON c.enrollment_id=e.id WHERE b.name='cafe-character-planner' AND b.enrollment_id=rec.enrollment_id AND b.enabled AND e.enabled AND c.ordinal=0 AND c.draft_id=rec.draft_id) THEN RETURN NULL; END IF;
 IF NOT has_function_privilege(current_user,'public.cs_cafe_publication_terminal(uuid)','EXECUTE') THEN RETURN NULL; END IF;
 IF public.cs_cafe_publication_terminal(rec.draft_id) IS DISTINCT FROM true THEN RETURN NULL; END IF;
 SELECT * INTO budget FROM character_production.text_replenishment_budgets WHERE id=root.budget_id FOR SHARE NOWAIT;
 expiry:=least(standing.expires_at,budget.expires_at,pol.expires_at);
 IF budget.id IS NULL OR budget.enabled IS DISTINCT FROM true OR budget.period<>to_char(today,'YYYY-MM') OR expiry<=stamp+interval '5 minutes'
 OR (cfg.quote->>'observedAt')::numeric>extract(epoch FROM stamp)*1000 OR (cfg.quote->>'expiresAt')::numeric<=extract(epoch FROM stamp+interval '5 minutes')*1000 OR (cfg.quote->>'expiresAt')::numeric>(cfg.quote->>'observedAt')::numeric+86400000 THEN RETURN NULL; END IF;
 k:='daily:'||today::text||':zaria-solenne';
 IF EXISTS(SELECT 1 FROM character_production.preparation_occurrences WHERE text_key=k) OR EXISTS(SELECT 1 FROM character_production.text_replenishment_attempts WHERE key=k) THEN RETURN NULL; END IF;
 -- Recheck the exact bound predecessor under lock before changing anything.
 PERFORM 1 FROM character_production.preparation_binding WHERE name='zaria-gallery-preparation' AND lane_id=bound FOR UPDATE NOWAIT;
 IF NOT FOUND THEN RETURN NULL; END IF;
 newlane:=gen_random_uuid();newocc:=gen_random_uuid();
 INSERT INTO character_production.preparation_lanes VALUES(newlane,root.actor_id,'successor:'||standing.id::text||':'||today::text,standing.owner_message_ids,root.source_scope,root.budget_id,stamp,expiry,true);
 INSERT INTO character_production.preparation_occurrences(lane_id,id,text_key) VALUES(newlane,newocc,k);
 INSERT INTO character_production.first_admission_config SELECT newlane,policy_id,policy_revision,policy_snapshot,theme,image,account,quote,rights_evidence_ref,true FROM character_production.first_admission_config WHERE lane_id=standing.root_lane;
 INSERT INTO character_production.successor_edges(standing_id,day,prior_lane,prior_occurrence,prior_enrollment,prior_draft,next_lane,next_occurrence) VALUES(standing.id,today,bound,occ.id,rec.enrollment_id,rec.draft_id,newlane,newocc);
 UPDATE character_production.scheduler_binding SET enabled=false WHERE name='cafe-character-planner' AND enrollment_id=rec.enrollment_id;
 UPDATE character_production.preparation_binding SET lane_id=newlane WHERE name='zaria-gallery-preparation' AND lane_id=bound;
 UPDATE character_production.preparation_lanes SET enabled=false WHERE id=bound;
 RETURN jsonb_build_object('status','successor_prepared','priorOccurrenceId',occ.id,'occurrenceId',newocc,'context',public.character_production_preparation_context());
END $$;
REVOKE ALL ON FUNCTION character_production.successor_immutable(),character_production.successor_revoke(),character_production.successor_root_revoke(),character_production.successor_admission_prior(uuid),public.character_production_successor_context() FROM PUBLIC;

DO $patch$ DECLARE d text; BEGIN
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='character_production.preparation_immutable()'::regprocedure)<>'cc80ee3dec508b941b851412590361a4' THEN RAISE EXCEPTION 'Unexpected reviewed source: character_production.preparation_immutable()'; END IF;
 SELECT pg_get_functiondef('character_production.preparation_immutable()'::regprocedure) INTO d;
 IF (length(d)-length(replace(d,$old$ IF TG_TABLE_NAME='preparation_lanes' AND TG_OP='UPDATE' THEN$old$,'')))/length($old$ IF TG_TABLE_NAME='preparation_lanes' AND TG_OP='UPDATE' THEN$old$)<>1 THEN RAISE EXCEPTION 'Patch site mismatch'; END IF;
 d:=replace(d,$old$ IF TG_TABLE_NAME='preparation_lanes' AND TG_OP='UPDATE' THEN$old$,$new$ IF TG_TABLE_NAME='preparation_binding' AND TG_OP='UPDATE' THEN
  IF OLD.name=NEW.name AND OLD.lane_id<>NEW.lane_id AND EXISTS(
   SELECT 1 FROM character_production.successor_edges e
   JOIN character_production.successor_standing s ON s.id=e.standing_id
   JOIN character_production.scheduler_binding b ON b.enrollment_id=e.prior_enrollment
   JOIN character_production.scheduler_enrollments x ON x.id=b.enrollment_id
   WHERE e.prior_lane=OLD.lane_id AND e.next_lane=NEW.lane_id
   AND s.enabled AND s.authorized_at<=clock_timestamp() AND s.expires_at>clock_timestamp()
   AND NOT b.enabled AND NOT x.enabled
   AND public.cs_cafe_publication_terminal(e.prior_draft) IS TRUE
  ) THEN RETURN NEW; END IF;
 END IF;
 IF TG_TABLE_NAME='preparation_lanes' AND TG_OP='UPDATE' THEN$new$);
 EXECUTE d;
END $patch$;

DO $patch$ DECLARE d text; BEGIN
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.character_production_first_admission_context()'::regprocedure)<>'bcf08518d51fb1edaebb4ebf4d57522f' THEN RAISE EXCEPTION 'Unexpected reviewed source: public.character_production_first_admission_context()'; END IF;
 SELECT pg_get_functiondef('public.character_production_first_admission_context()'::regprocedure) INTO d;
 IF (length(d)-length(replace(d,$old$OR EXISTS(SELECT 1 FROM character_production.scheduler_binding) THEN RETURN NULL;$old$,'')))/length($old$OR EXISTS(SELECT 1 FROM character_production.scheduler_binding) THEN RETURN NULL;$old$)<>1 THEN RAISE EXCEPTION 'Patch site mismatch'; END IF;
 d:=replace(d,$old$OR EXISTS(SELECT 1 FROM character_production.scheduler_binding) THEN RETURN NULL;$old$,$new$OR (EXISTS(SELECT 1 FROM character_production.scheduler_binding) AND NOT character_production.successor_admission_prior(l.id)) THEN RETURN NULL;$new$);
 IF (length(d)-length(replace(d,$old$IF EXISTS(SELECT 1 FROM character_production.scheduler_binding b WHERE b.enrollment_id<>r.enrollment_id OR NOT b.enabled) THEN active:=false;$old$,'')))/length($old$IF EXISTS(SELECT 1 FROM character_production.scheduler_binding b WHERE b.enrollment_id<>r.enrollment_id OR NOT b.enabled) THEN active:=false;$old$)<>1 THEN RAISE EXCEPTION 'Patch site mismatch'; END IF;
 d:=replace(d,$old$IF EXISTS(SELECT 1 FROM character_production.scheduler_binding b WHERE b.enrollment_id<>r.enrollment_id OR NOT b.enabled) THEN active:=false;$old$,$new$IF EXISTS(SELECT 1 FROM character_production.scheduler_binding b WHERE b.enrollment_id<>r.enrollment_id OR NOT b.enabled) AND NOT character_production.successor_admission_prior(l.id) THEN active:=false;$new$);
 EXECUTE d;
END $patch$;

DO $patch$ DECLARE d text; BEGIN
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.character_production_first_admit(uuid,text)'::regprocedure)<>'2a6848d0a14de1253ba09009ae46f8b7' THEN RAISE EXCEPTION 'Unexpected reviewed source: public.character_production_first_admit(uuid,text)'; END IF;
 SELECT pg_get_functiondef('public.character_production_first_admit(uuid,text)'::regprocedure) INTO d;
 IF (length(d)-length(replace(d,$old$OR EXISTS(SELECT 1 FROM character_production.scheduler_binding) THEN RETURN NULL;$old$,'')))/length($old$OR EXISTS(SELECT 1 FROM character_production.scheduler_binding) THEN RETURN NULL;$old$)<>1 THEN RAISE EXCEPTION 'Patch site mismatch'; END IF;
 d:=replace(d,$old$OR EXISTS(SELECT 1 FROM character_production.scheduler_binding) THEN RETURN NULL;$old$,$new$OR (EXISTS(SELECT 1 FROM character_production.scheduler_binding) AND NOT character_production.successor_admission_prior(r.lane_id)) THEN RETURN NULL;$new$);
 IF (length(d)-length(replace(d,$old$INSERT INTO character_production.scheduler_binding VALUES('cafe-character-planner',r.enrollment_id,true);$old$,'')))/length($old$INSERT INTO character_production.scheduler_binding VALUES('cafe-character-planner',r.enrollment_id,true);$old$)<>1 THEN RAISE EXCEPTION 'Patch site mismatch'; END IF;
 d:=replace(d,$old$INSERT INTO character_production.scheduler_binding VALUES('cafe-character-planner',r.enrollment_id,true);$old$,$new$INSERT INTO character_production.scheduler_binding VALUES('cafe-character-planner',r.enrollment_id,true) ON CONFLICT(name) DO UPDATE SET enrollment_id=EXCLUDED.enrollment_id,enabled=true WHERE character_production.successor_admission_prior(r.lane_id);
 IF NOT FOUND THEN RAISE EXCEPTION 'Exact successor binding changed'; END IF;$new$);
 EXECUTE d;
END $patch$;
DO $$ DECLARE r record;own oid:='character_production_owner'::regrole; BEGIN
 FOR r IN SELECT relowner owner,relacl acl FROM pg_class WHERE oid IN('character_production.successor_standing'::regclass,'character_production.successor_edges'::regclass)
 UNION ALL SELECT proowner,proacl FROM pg_proc WHERE oid IN('character_production.successor_immutable()'::regprocedure,'character_production.successor_revoke()'::regprocedure,'character_production.successor_root_revoke()'::regprocedure,'character_production.successor_admission_prior(uuid)'::regprocedure,'public.character_production_successor_context()'::regprocedure)
 LOOP IF r.owner<>own OR EXISTS(SELECT 1 FROM aclexplode(r.acl) WHERE grantee<>own) THEN RAISE EXCEPTION 'Owner-only succession required'; END IF; END LOOP;
END $$;
ROLLBACK;
