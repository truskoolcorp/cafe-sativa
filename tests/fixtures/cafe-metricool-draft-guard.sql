-- Synthetic PG fixture: exact reviewed dormant Café guard from store560aba6.
CREATE FUNCTION cafe_metricool_private.guard_source() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE promo uuid;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'READ COMMITTED required'; END IF;
 IF TG_TABLE_NAME='cs_character_promo_drafts' THEN promo:=OLD.id;
 ELSE
  IF TG_OP='UPDATE' AND NEW.promo_id IS DISTINCT FROM OLD.promo_id THEN RAISE EXCEPTION 'Promo ownership immutable'; END IF;
  IF TG_OP='DELETE' THEN promo:=OLD.promo_id; ELSE promo:=NEW.promo_id; END IF;
 END IF;
 PERFORM 1 FROM public.cs_character_promo_drafts WHERE id=promo FOR UPDATE;
 IF EXISTS(SELECT 1 FROM cafe_metricool_private.attempts a JOIN public.cs_character_promo_delivery_plans p ON p.id=a.plan_id WHERE p.promo_id=promo) THEN RAISE EXCEPTION 'Café claimed source frozen; reconcile manually'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
