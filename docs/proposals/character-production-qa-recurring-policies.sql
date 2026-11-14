-- DORMANT companion; must be executed by original source table owner under a
-- separately reviewed installer with temporary namespace access restored.
-- No source ownership, column privilege or existing policy changes.
BEGIN;
CREATE POLICY character_production_qa_prebinding_read ON public.cs_character_promo_drafts
 FOR SELECT TO character_production_owner USING (EXISTS (
 SELECT 1 FROM character_production.qa_slot_bindings b WHERE b.promo_id=id AND b.enabled=true));
CREATE POLICY character_production_qa_prebinding_lock ON public.cs_character_promo_drafts
 FOR UPDATE TO character_production_owner USING (EXISTS (
 SELECT 1 FROM character_production.qa_slot_bindings b WHERE b.promo_id=id AND b.enabled=true)) WITH CHECK(false);
COMMIT;
