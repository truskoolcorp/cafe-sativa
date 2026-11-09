# Dormant fixed public reply attestation, v1

Local design only. No deployment, public projection approval, canonical pin approval,
public reply artifact approval, or permission to post is implied by this patch.
GET /api/public/chat-readiness/v1 returns generic HTTP 503 while dormant. Runtime
approval is deliberately literal null. The original baseline used null providers;
the resource-controlled revision now constructs a disabled fixed-server singleton
and forwards only Request.signal. Import, construction and disabled requests perform
zero environment reads and zero network I/O. See
[resource controls and remaining gates](public-chat-readiness-resources-local.md).
No environment changes, new
credentials, SQL, grants, service-role reads, or existing admin route changes.

## Contract

`cafe-fixed-public-replies/v1` attests only that a fresh canonical snapshot matched
an independently approved private pin, while the exact free public Hit Em event
remained scheduled/live. It binds that result to a separately reviewed immutable
public reply artifact SHA-256. It does not expose a general persona, synthesize a
persona, grant posting permission, prove identity to third parties, or authorize
unreviewed variants. The public response contains only version/scope/readiness,
fixed public event ID/video/start, public artifact hash, and observation interval.
No private digest, context, voice ID, source records, authentication material,
headers, prompts, memberships or email is returned or logged. All failures share
one body and status. Unknown observation/config/event fields are rejected; every
canonical row field, including unknown future fields, is included in the private
snapshot digest, so a row change requires new independent approval. All input trees
are restricted to plain JSON data with dense arrays and own enumerable data
properties. Undefined/unsupported values, nonfinite numbers, negative zero, custom
prototypes, accessors, symbols, hidden properties, cycles and shared object aliases
are rejected. Limits per input tree are depth 32, 10,000 nodes and 262,144 serialized
UTF-16 code units. Status must be the exact string scheduled or live.

The private pin uses SHA-256 over recursively key-sorted JSON for the complete
reviewed canonical character row. It is not a public identifier. Review tooling
must treat both pin and input as private. Fixtures are synthetic. No actual pins
or reply artifacts have been approved or populated. The implementation does not
hash or fetch an artifact itself: approval/config provisioning must verify exact
artifact bytes and digest and bind those bytes to the reviewed canonical snapshot.
A consumer separately verifies its local fixed reply artifact bytes against the
public digest and must never insert private canonical prose into replies.

## Required activation review

1. Obtain separate approval to deploy this public projection and disclose its
   narrow readiness fact, event tuple and public artifact hash. Obtain approval
   of exact fixed replies and their private canonical snapshot binding. Provision
   version 1, privateCanonicalSha256, publicReplyArtifactSha256, validFrom and
   validUntil only through trusted server-only configuration. No caller-supplied
   pins, timestamps, URLs, event IDs or host selectors are permitted. The approval
   window is explicit, finite and fail-closed. Configuration must remain private.
2. The original baseline supplied a dormant trusted adapter
   (`public-chat-attestation-adapter.ts`). The reviewed local resource revision wires
   the fixed GLYPH helper with bounded streaming/AbortSignal support and a dedicated
   anonymous event reader, rather than the cookie-aware existing event loader.
   Actual activation and the private binding still require separate approval. Read-only producer evidence confirms production GLYPH awaits
   its registry snapshot and returns `verifiedAt`, source `GLYPH live canonical
   registry`, `live: true` and characters with private/no-store headers. The Café
   live loader preserves this timestamp. The adapter validates exact envelope and
   ISO timestamp, requiring completion within the fresh request interval, no clock
   regression and less than 60 seconds duration. Pre-request/cached/future evidence
   fails closed. It conservatively uses request START as the validity anchor and
   never re-stamps returned evidence. `verifiedAt` denotes observation completion,
   not content generation/update time. Fresh registry validity does not prove that
   all profile prose was freshly database-generated: enrichment can use owner-derived
   or recovered fallback and omits that provenance in returned rows. The full
   approved Café-enriched canonical row, including portrait_url, is privately pinned;
   changing any part invalidates approval. Independent binding review must explicitly
   decide whether unknown profile fallback provenance is acceptable. If provenance
   policy requires known/no fallback, remain disabled until it can be established.
3. The original existing public loader validates the exact free scheduled/live row through
   `my_events_v` and `publicHitEmPremiere`. It does not return persisted video/public
   visibility columns. The adapter explicitly applies the versioned public page's
   fixed video and public visibility policy, not invented database fields. This
   policy adaptation requires separate review. It rejects canceled/ended/malformed
   loader results and uses the original request-start time. The new fixed anonymous
   reader applies that same projection to a bounded exact-event read from the
   verified Supabase project origin, without cookies, sessions or service-role
   access. Its deployed grants/RLS and live behavior remain unverified. Arbitrary
   injected JSON is not proof.
4. The original generic evaluator did not implement resource gates and must not
   be wired directly into an active public route. The new dormant wrapper now
   implements a 1,500 ms read deadline, one physical flight, 16 admitted waiters,
   bounded streaming/JSON parsing, failure backoff, isolated waiter cancellation
   and quarantine of ignored-abort work. It renews on demand at 30 seconds and preserves
   original observation/expiry plus monotonic cache bounds. The runtime singleton
   and Request.signal forwarding are wired, but literal null approval keeps all
   source reads disabled. Maximum validity remains 60 seconds from the earliest evidence,
   bounded by approval expiry. Invalid/regressing clocks and failed renewals fail
   closed. These are per-process controls, not deployment-wide protection. Live
   latency, synchronized clocks, deployed lifecycle and separately authorized
   global ingress/upstream concurrency limits remain activation gates. See the
   linked resource-control document for exact behavior and limitations.
5. The original raw-canon bridge expects canonical_context/voice_id and remains
   intentionally incompatible. A separate fixed-reply consumer and actual
   producer-to-consumer integration have since passed local synthetic tests;
   those results do not establish live authorization or production compatibility. Do not fabricate
   placeholder fields or loosen its old contract. Fetch this new contract only
   from the exact pinned Café HTTPS origin/path, forbid redirects, disable caching,
   validate exact schema/event/artifact and bounded timestamps, and recheck before
   use. This is unsigned JSON: caller-supplied/copied JSON is NOT proof. HTTPS
   server provenance is required. TLS does not attest YouTube posting permission.
6. Obtain separate permission to post specific replies as the authorized YouTube
   identity for the exact event. Deployment/projection approval never substitutes
   for that authorization. This patch contains no posting or generation code.

## Verification and limits

Run from repository root:

- `node --test tests/public-chat-attestation.test.cjs`
- `./node_modules/.bin/tsc -p tsconfig.public-chat-check.json`
- `./node_modules/.bin/tsc --noEmit --incremental false` (full repository type check)

Tests use injected clocks/providers and synthetic sentinels only. They make no
network calls or token reads. They cover success allowlist, secret and private-pin
non-disclosure, fallback/duplicate rejection, canonical changes and readiness,
private/paid/draft/ended/replaced events, malformed config, unknown boundary fields,
invalid/regressing/out-of-window clocks, stale upstream evidence, original expiry,
source failure and dormant route policy. These are local tests, not proof of live
upstream freshness, authorization, production deployment, integration compatibility,
full application health, or end-to-end posting safety. Failure timing and external
platform infrastructure logging are outside the pure projection's guarantees.

Original baseline validation recorded 71 combined attestation/event regression
tests. The resource-controlled revision passes 30 focused attestation/resource
tests, 517 repository CJS tests, 24 independent review tests and full repository
TypeScript checking. Independent tests verify the disabled import/construction
and normal/aborted request paths read no environment values and perform no fetches.
Full application build/lint and live integrations were not run.

## Producer evidence and remaining gates

Read-only investigation identified the production GLYPH deployment as READY
`dpl_CuSQqcDFxDKidrFUNUo7f3eXACTP`, commit
`ab465a17945a6eb506563f6bc62787ac3c0c5979` of `truskoolcorp/glyph-platform`.
No private producer source is copied into this patch. Reviewed handler behavior
establishes current registry reads followed by an observation completion timestamp;
profile fallback provenance remains unknown in returned rows. No live authenticated
read was performed for these tests. Clock synchronization between hosts must be
reviewed; conservative rejection on skew is intentional. Existing wrapper filtering
and upstream profile composition must be included in the private binding review.

Remaining activation gates: projection/config/artifact approval, private snapshot
binding and fallback-provenance policy approval, public page policy approval,
authorized live source/RLS and latency verification, and deployment-wide ingress/
concurrency protection. Resource controls, disabled request-signal wiring and
synthetic consumer compatibility are now locally implemented/reviewed, not future
code work. Posting authorization remains separate. Runtime approval remains null;
no live activation or credential provisioning occurred.
