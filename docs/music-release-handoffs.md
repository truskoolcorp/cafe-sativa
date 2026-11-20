# Suno music release handoffs

An approved music release schedules its distinct public teaser through the existing Tru Skool Metricool Facebook + Threads connection, registers its full master in the existing private VIP replay library, and supplies a campaign landing page linked to the existing membership checkout. Initial paid membership checkouts retain verified release attribution; this is not net revenue, refund reconciliation or recurring-revenue reporting.

## Use

1. Finish the Suno sequence and download the owner-selected master. No generation or download-credit purchases occur in this integration.
2. Store the reviewed public teaser and separate full master in private Supabase storage (MP4, each at most 50 MB). Calculate SHA-256 on the exact final files. The same master cannot be used as the public teaser.
3. Open `/admin/music-releases`, or submit the same manifest to `POST /api/admin/music-releases` with `action: prepare` using an authenticated content-admin session and same-origin request. Preparing is draft-only and verifies media bytes. This API is the production-to-release handoff; no external generation service is given admin credentials.
4. Review the private previews, caption including campaign URL, exact Facebook + Threads destinations, public teaser consent, membership archive and dates. Approval binds the exact manifest digest and makes only the teaser publicly fetchable for provider ingestion. Social scheduling must be at least 30 minutes ahead; VIP release cannot precede social schedule.
5. `/api/music/worker` runs at minutes 11,26,41,56 using existing `CRON_SECRET`. It registers the private master with a deterministic replay ID, schedules one queued release per invocation, and reconciles provider receipts. Existing OAuth/account verification and dispatch switch remain authoritative. No new OAuth scopes or account destinations are introduced.
6. Campaign pages `/music/<slug>` appear at the approved social time. VIP playback remains controlled by the existing current-membership check and release timestamp, and verifies the stored music master against approved bytes before issuing a temporary playback URL. The campaign CTA points to `/membership?release=<slug>`; attribution survives the sign-in round trip. Only verified released slugs can enter Stripe metadata.
7. Signed Stripe webhook processing records initial positive USD paid checkout receipts after existing membership synchronization. Duplicate session IDs do not duplicate conversions. No prices, subscriptions, customer charges, payouts or entitlements are created by the worker.

## Resume and failure rules

- Paid generation stays paused; no credit purchase/refill is implemented.
- Approved manifests are immutable. Use a new draft/slug for editorial changes. Do not mutate stored reviewed bytes.
- Unapproved or digest-mismatched releases cannot dispatch. An expired social time or matching existing schedule blocks a new submission.
- Claim before provider write. Timeout, interrupted submission or ambiguous receipt becomes `unknown`; no automatic resubmission. Inspect the provider before reconciling manually. `scheduled` is distinct from confirmed publication, which requires both approved networks and provider-issued public URLs.
- Private VIP registration is independently retryable and never overwrites another replay. Missing/mutated/public master storage fails closed.
- Separate generation approval, editorial approval and external publication review remain required; the Laviche pilot is not registered or approved by installing this code.

## Installation

Apply `scripts/music-release-handoffs.sql` to the verified Café Sativa production database, then deploy the branch. Tables are service-only with RLS enabled; no public grants or policies. Verify migration and zero unintended approved rows before deployment. Existing Vercel production variables supply Supabase, `CRON_SECRET`, Stripe and Metricool; no new credential is needed.

Local validation: TypeScript check, production Next build, release contract/worker tests, membership checkout and synchronization tests, Stripe webhook regression and social publication receipt tests. Live acceptance still needs an owner-approved release, provider schedule/publication receipts and a separately authorized test purchase; mock tests are not evidence of a real post or payment.

## Handoff manifest

Fields: `slug`, `title`, `description`, `songId`, `sequenceId`, `teaser:{bucket,path,sha256}`, `master:{bucket,path,sha256}`, `caption`, `scheduledAt`, `releaseAt`. Dates are absolute ISO timestamps. The service appends the canonical campaign URL and UTM parameters. Admin desk dates are entered in the browser's local time and shown as UTC in inventory.

GET `/api/admin/music-releases` supplies manifests, operational states, provider receipts and initial paid checkout receipts. It never supplies OAuth credentials or signed master URLs. Public teaser endpoint exposes only the approved teaser, never the full master.
