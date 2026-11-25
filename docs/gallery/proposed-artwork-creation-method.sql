-- Proposed additive migration. Apply in an isolated database before enabling
-- NEXT_PUBLIC_GALLERY_ARTWORK_METHOD. NULL means Not declared, not No AI used.
BEGIN;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS artwork_creation_method text
  CHECK (artwork_creation_method IN ('no_ai', 'ai_assisted', 'primarily_ai_generated'));

-- Preserve existing public columns, publication/approval filters, and RLS behavior.
-- Expose affirmative disclosures only. This is not the private provenance store.
CREATE OR REPLACE VIEW public.gallery_v WITH (security_invoker = true) AS
SELECT p.id,
       p.slug,
       p.title,
       p.description,
       p.kind,
       p.price_cents,
       p.currency,
       p.primary_image_url,
       p.stock_count,
       p.created_at,
       a.id AS artist_id,
       a.slug AS artist_slug,
       a.display_name AS artist_name,
       a.avatar_url AS artist_avatar,
       CASE WHEN p.artwork_creation_method IN ('ai_assisted', 'primarily_ai_generated')
            THEN p.artwork_creation_method END AS declared_ai_creation_method
FROM public.products p
JOIN public.artists a ON a.id = p.artist_id
WHERE p.status = 'published'::public.product_status AND a.is_approved = true;

COMMIT;
