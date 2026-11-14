-- Source-owner-only proposal; separate installer must preserve exact owner/ACL.
-- No grants here. Only production_owner may EXECUTE after review.
BEGIN;
CREATE FUNCTION public.character_production_new_blank_draft(p_id uuid,p_slot jsonb,p_digest text,p_theme text)
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE stamp timestamptz;
BEGIN
 IF p_id IS NULL OR p_slot IS NULL OR p_digest IS NULL OR p_digest !~ '^[a-f0-9]{64}$'
 OR p_slot->>'characterId' IS NULL OR p_slot->>'script' IS NULL OR p_theme IS NULL
 OR length(btrim(p_slot->>'script')) NOT BETWEEN 1 AND 5000
 OR (p_slot->>'durationSeconds')::integer NOT BETWEEN 8 AND 45 THEN RETURN NULL; END IF;
 -- Fixed boolean bridge reads only exact planner intent, not arbitrary source
 -- records. Source owner receives no private schema/table rights.
 IF public.character_production_planned_draft(p_id,p_slot,p_digest,p_theme) IS DISTINCT FROM true THEN RETURN NULL; END IF;
 INSERT INTO public.cs_character_promo_drafts(id,character_id,promo_key,specialty,title,spoken_script,visual_brief,intended_channel,duration_seconds,status,evidence,linked_event_id,actual_social_account,audio_asset_path,video_asset_path,voice_approved_at,video_qa_approved_at,publication_approved_at)
 VALUES(p_id,p_slot->>'characterId','generated-qa-'||p_id::text,'Canonical Café host','Generated Café promotion: private QA candidate',p_slot->>'script','Exact canonical production binding '||(p_slot->>'providerBindingRevision')||'; no new scene or likeness inferred.','private_qa_only',(p_slot->>'durationSeconds')::integer,'draft',jsonb_build_object('source','trusted_recurring_production_planner','slotKey',p_slot->>'key','slotDigest',p_digest,'theme',p_theme,'publicationApproved',false),NULL,NULL,NULL,NULL,NULL,NULL,NULL)
 RETURNING updated_at INTO stamp;
 RETURN stamp;
END $$;
REVOKE ALL ON FUNCTION public.character_production_new_blank_draft(uuid,jsonb,text,text) FROM PUBLIC, anon, authenticated, service_role, character_production_generator, character_production_output_broker;
COMMIT;
