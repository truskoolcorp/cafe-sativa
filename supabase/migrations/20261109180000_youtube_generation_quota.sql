-- LOCAL PREPARATION ONLY. Review and explicitly apply before enabling the route.
-- A reservation is consumed before any model call, including failed or uncertain
-- calls. There is intentionally no release, reset, retry, or message-text column.
BEGIN;

CREATE TABLE public.cs_youtube_generation_budget (
  event_id uuid PRIMARY KEY CHECK (event_id = '00e7d9c6-61b9-4af9-827e-b6d13310b762'),
  video_id text NOT NULL CHECK (video_id = 'ZYA0r9JM6eA'),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 30),
  last_reserved_at timestamptz
);
CREATE TABLE public.cs_youtube_generation_reservations (
  event_id uuid NOT NULL REFERENCES public.cs_youtube_generation_budget(event_id),
  source_message_id text NOT NULL CHECK (char_length(source_message_id) BETWEEN 1 AND 256 AND source_message_id ~ '^[A-Za-z0-9_.-]+$'),
  author_channel_id text NOT NULL CHECK (author_channel_id ~ '^UC[A-Za-z0-9_-]{22}$'),
  reserved_at timestamptz NOT NULL,
  PRIMARY KEY (event_id, source_message_id)
);
CREATE INDEX cs_youtube_generation_author_cooldown
  ON public.cs_youtube_generation_reservations(event_id, author_channel_id, reserved_at DESC);
ALTER TABLE public.cs_youtube_generation_budget ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cs_youtube_generation_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cs_youtube_generation_budget FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.cs_youtube_generation_reservations FROM PUBLIC, anon, authenticated, service_role;

INSERT INTO public.cs_youtube_generation_budget(event_id, video_id)
VALUES ('00e7d9c6-61b9-4af9-827e-b6d13310b762', 'ZYA0r9JM6eA');

CREATE FUNCTION public.cs_reserve_youtube_generation(
  p_event_id uuid, p_video_id text, p_source_message_id text, p_author_channel_id text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  budget public.cs_youtube_generation_budget%ROWTYPE;
  at_time timestamptz;
BEGIN
  IF p_event_id IS DISTINCT FROM '00e7d9c6-61b9-4af9-827e-b6d13310b762'::uuid
    OR p_video_id IS DISTINCT FROM 'ZYA0r9JM6eA'
    OR p_source_message_id IS NULL OR char_length(p_source_message_id) NOT BETWEEN 1 AND 256 OR p_source_message_id !~ '^[A-Za-z0-9_.-]+$'
    OR p_author_channel_id IS NULL OR p_author_channel_id !~ '^UC[A-Za-z0-9_-]{22}$'
    OR p_author_channel_id = 'UCM1i1Mu2gOFyAYJfuWSxO0A' THEN RETURN false; END IF;

  -- All instances serialize on the one event row. Re-read the database clock
  -- after acquiring the lock, so a queued request cannot cross the end boundary.
  SELECT * INTO budget FROM public.cs_youtube_generation_budget
    WHERE event_id = p_event_id AND video_id = p_video_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  at_time := clock_timestamp();
  IF at_time < '2026-11-11T06:00:00Z'::timestamptz
    OR at_time >= '2026-11-11T06:30:00Z'::timestamptz
    OR budget.attempts >= 30
    OR (budget.last_reserved_at IS NOT NULL AND at_time < budget.last_reserved_at + interval '10 seconds')
    OR EXISTS (SELECT 1 FROM public.cs_youtube_generation_reservations
      WHERE event_id = p_event_id AND source_message_id = p_source_message_id)
    OR EXISTS (SELECT 1 FROM public.cs_youtube_generation_reservations
      WHERE event_id = p_event_id AND author_channel_id = p_author_channel_id
      AND reserved_at > at_time - interval '60 seconds') THEN RETURN false; END IF;

  INSERT INTO public.cs_youtube_generation_reservations
    (event_id, source_message_id, author_channel_id, reserved_at)
    VALUES (p_event_id, p_source_message_id, p_author_channel_id, at_time);
  UPDATE public.cs_youtube_generation_budget SET attempts = attempts + 1, last_reserved_at = at_time
    WHERE event_id = p_event_id;
  RETURN true;
END $$;

-- Readiness cannot reserve, refill, release or disclose usage/identity details.
CREATE FUNCTION public.cs_youtube_generation_available()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT current_timestamp >= '2026-11-11T06:00:00Z'::timestamptz
    AND current_timestamp < '2026-11-11T06:30:00Z'::timestamptz
    AND EXISTS (SELECT 1 FROM public.cs_youtube_generation_budget
      WHERE event_id = '00e7d9c6-61b9-4af9-827e-b6d13310b762'::uuid
      AND video_id = 'ZYA0r9JM6eA' AND attempts < 30
      AND (last_reserved_at IS NULL OR current_timestamp >= last_reserved_at + interval '10 seconds'));
$$;
REVOKE ALL ON FUNCTION public.cs_reserve_youtube_generation(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cs_youtube_generation_available() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cs_reserve_youtube_generation(uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.cs_youtube_generation_available() TO service_role;
COMMIT;
