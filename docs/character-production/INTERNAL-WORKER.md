# Same-server character worker (disabled)

The existing GET `/api/content/worker` already authenticates platform cron using
`cronAuthorized` / existing `CRON_SECRET`. The isolated character dispatch selects
only this branch when `CS_CHARACTER_INTERNAL_WORKER_ENABLED=true`; an unconfigured
branch returns 503 and does NOT fall through to the older Runway room worker.
Default dispatch and the existing admin POST collector are unchanged.

The internal factory composes the reviewed durable engine, exact due-slot reader,
private output broker and bounded Supabase streaming adapter inside one backend.
No MP4 request body, public upload capability, worker login or extra shared secret
is needed. The existing privileged backend remains privileged: this is NOT
restricted database isolation. No keys are read or copied by the dormant entry.

Each invocation collects one original provider task before scanning one exact due
slot and attempting at most one submission. A held collection prevents submission.
The existing database unique nonreclaimable claim and cumulative budget ledger
remain the paid-write concurrency fence, including multiple serverless instances.
There is no schedule cloning, unknown-write retry, QA approval or publication.
The worker now has a 45-second hard response deadline and propagates cancellation
through its scoped existing SDK fetch, provider requests and canonical reads.
Backend operations have an 8-second headers/body deadline. RPC builders explicitly
use `retry(false)` and the tick signal. Unresolved transports retain local admission
until settling; abort never proves a paid operation was cancelled. SQL claims remain
nonreclaimable after uncertainty. A serverless process termination is not proof of
successful submission, so collect receipts and the ledger before any next action.

The server-only composition uses existing `createAdminClient`, `liveGlyphCharacters`
and `normalizePromoCanon`, and couples exact immutable image/audio receipts with
`createCanonicalImageRuntimeProvider`. It never uses a connector envelope as native
provider inventory. It calls only the ten reviewed production RPCs, but still runs
under the existing privileged service role, not a new restricted database identity.

## Concrete activation dependencies
- Production foundation was reported installed (10 RPCs, owner/generator/broker
  roles, empty rows); this implementation does not presume service-role EXECUTE
  grants. Inspect exact deployed signatures and grant only reviewed required
  calls to the actual backend identity. No migration/grants run here.
- Verify private `character-production-private` bucket, MIME/size constraints,
  server-only access and no public policies. The two-phase upload-intent schema
  and HTTP output route are NOT required by this same-server path.
- Seed separately approved exact slots and provider/month budget; empty tables
  mean no generation. Actual provider quote and spending approval are required.
- Supply the reviewed manifest: exact current canonical revision, image bytes/hash,
  audio/script/voice/model/synthesis receipt, direct account username and provider
  binding revision. No names, guessed receipt IDs, or substitute native voices.
  Private input importer/readback is a separate prerequisite.
- Replace the deliberately null deployment configuration only after integration
  tests with real read-only account inventory and private storage. Validate live
  timeout/cancellation behavior, readback, QA handoff and monitoring separately.

This is an executable tested composition with a deliberately unconfigured entry,
not a claim that autonomous production is running. No new cron schedule, environment
change, paid request, credential access or live schema mutation occurred.
