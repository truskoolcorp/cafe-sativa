-- LOCAL PREPARATION ONLY. No live quota, public messages, provider credentials,
-- generated text, or review proofs are stored here. One batch consumes BOTH
-- fixed synthetic fixtures before spending, even if the process then crashes.
BEGIN;

CREATE TABLE public.cs_youtube_rehearsal_budget (
  event_id uuid PRIMARY KEY CHECK (event_id = '00e7d9c6-61b9-4af9-827e-b6d13310b762'),
  fixture_runs integer NOT NULL DEFAULT 0 CHECK (fixture_runs IN (0, 2)),
  claimed_at timestamptz,
  CHECK ((fixture_runs = 0 AND claimed_at IS NULL) OR (fixture_runs = 2 AND claimed_at IS NOT NULL))
);
ALTER TABLE public.cs_youtube_rehearsal_budget ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cs_youtube_rehearsal_budget FROM PUBLIC, anon, authenticated, service_role;
INSERT INTO public.cs_youtube_rehearsal_budget(event_id)
VALUES ('00e7d9c6-61b9-4af9-827e-b6d13310b762');

-- No reset/refill/delete path, even for an accidental privileged ordinary write.
CREATE FUNCTION public.cs_youtube_rehearsal_no_refill()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.fixture_runs = 0 AND NEW.fixture_runs = 2
      AND NEW.event_id = OLD.event_id AND OLD.claimed_at IS NULL AND NEW.claimed_at IS NOT NULL THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'rehearsal_budget_immutable';
END $$;
CREATE TRIGGER cs_youtube_rehearsal_no_refill
  BEFORE UPDATE OR DELETE ON public.cs_youtube_rehearsal_budget
  FOR EACH ROW EXECUTE FUNCTION public.cs_youtube_rehearsal_no_refill();
CREATE TRIGGER cs_youtube_rehearsal_no_truncate
  BEFORE TRUNCATE ON public.cs_youtube_rehearsal_budget
  FOR EACH STATEMENT EXECUTE FUNCTION public.cs_youtube_rehearsal_no_refill();

CREATE FUNCTION public.cs_reserve_youtube_rehearsal()
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  budget public.cs_youtube_rehearsal_budget%ROWTYPE;
  at_time timestamptz;
BEGIN
  -- Every instance serializes on the same permanent one-off event row.
  SELECT * INTO budget FROM public.cs_youtube_rehearsal_budget
    WHERE event_id = '00e7d9c6-61b9-4af9-827e-b6d13310b762'::uuid FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  at_time := clock_timestamp();
  IF at_time >= '2026-11-11T06:30:00Z'::timestamptz OR budget.fixture_runs <> 0 THEN
    RETURN false;
  END IF;
  UPDATE public.cs_youtube_rehearsal_budget SET fixture_runs = 2, claimed_at = at_time
    WHERE event_id = budget.event_id;
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION public.cs_youtube_rehearsal_no_refill() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cs_reserve_youtube_rehearsal() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cs_reserve_youtube_rehearsal() TO service_role;
COMMIT;
