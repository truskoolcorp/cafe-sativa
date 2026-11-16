# Legacy venue media watermark fence (not deployed)

Scope: cs_content_jobs private venue MP4s, public item/pilot playback, website feature visibility/publication, and legacy social variant export. This complements, not duplicates, character promo ninth QA.

No previous general QA or owner visual override is treated as watermark evidence. A current exact job/path/SHA review is required, with a verified reviewer identity and full-clip evidence; known marked hashes are always rejected. Owned ecosystem marks may be described in evidence as authorized. This is not an automatic detector. No review rows are created/backfilled by this patch.

Private table proposal grants only server SELECT. A reviewed administrative evidence-writing workflow is still required before enabling any existing clip. Missing schema/review fails closed. Text-only articles and independently approved venue cover images are unchanged, not claimed watermark-audited.

Public routes verify whole bounded private MP4 and return a chunked stream of those exact bytes, including range responses; they never sign and re-fetch a potentially replaced object. Bucket metadata must be private and file size cap <=50MiB. This buffers up to50MiB in server memory before streaming, and SDK download must settle before response; target deployment needs concurrency/latency verification. No claim of production load readiness. Variant export requires separate exact variant review; transcoding or cached output is not proof. A missing variant review can leave a private generated variant, but does not sign or submit it.

Remaining uncovered: static/public files and hardcoded external embeds, approved canonical cover images, direct manual/provider scheduling outside this backend, and posts already queued externally. Existing queued deliveries require separate inventory/hold. These are not silently declared safe. This patch changes no existing approval or schedule records and performs no paid generation.

## Hardening update
Source reads use native fetch streaming with20s abort deadline and50MiB actual-byte counter (not SDK Blob download). Two per-process read admissions stay occupied until orphan operations settle. Public responses have separate two-per-process admissions retained through stream close/cancel; item route does not download twice. This is per-process, not distributed rate limiting. Range request still needs full source integrity verification.

Variants no longer rebuild on generic cached-read failure or upsert mutable recipe paths: encoded-byte SHA is part of new derivative path and upload is insert-only. Signing is60seconds only after exact derivative review. Duplicate/unknown upload errors fail, never retry. Privileged backend retains ability to overwrite/delete outside this code; immutable naming is not a cryptographic Storage enforcement claim. Existing client update/delete policies need live read-only audit before rollout.

Admin POST /api/content/watermark-review requires fresh server-controlled app_metadata admin, exact origin, bounded4KiB body, fullClipReviewed=true, actual hash matching submitted hash, user evidence and result. Narrow SQL RPC rechecks actor and job revision under parent row lock, compares expected prior review timestamp, denies known marked pass. It grants no editorial/publishing approval. SQL proposal and fixtures still require actualPG17 review/CI; no rows or grants applied.

Official deployment references checked: https://vercel.com/docs/functions/limitations and https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions (4.5MB nonstreamed response limit; streaming recommended). Supabase https://supabase.com/docs/guides/storage/uploads/standard-uploads documents default insert-only conflict behavior. No assumption that larger function memory or API billing was enabled.
