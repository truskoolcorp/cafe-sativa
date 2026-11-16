# Existing-backend immutable audio source

`createPrivateRenderedAudioSource` implements the real installed Supabase Storage
JS streaming download and `createSignedUrl(path, expiresIn)` contracts. It uses an
injected existing backend client, not copied credentials. There are no upload,
upsert, bucket creation or public policy operations.

Every path must exist in the trusted rendered-audio receipt set, its requested
byte bound must exactly match, the live bucket must be private with an audio-only
MIME list and maximum size <=32MiB. Stream consumption is capped by receipt length,
chunk count and deadline; actual bytes must match hash/length/MP3-or-WAV header.
Signing re-reads the object, then requests only a300-second URL for the same private
path. It checks returned origin/path/token; no arbitrary URL or cached successful
read is treated as proof. Unknown SDK operations remain tracked by whenSettled;
abort reaches stream transport, but does not falsely prove SDK cancellation.

Deployment still needs the private `character-production-audio` bucket and trusted
synthesis receipts. Insert-only immutable upload policies must be established by
separate review: hashing a path alone cannot prevent privileged writers replacing
it later. The short URL may expire before delayed HeyGen retrieval. That is a hold
and reconciliation condition, not permission to re-submit a paid generation.
No synthesis, upload, signing or private read occurred during these fixture tests.

The existing admin voice diagnostic additionally calls official GET
`/v1/user/subscription`, returning only tier, character usage/limit/remaining,
reported overage entitlement and maximum credit extension. No raw invoices,
billing/card details or identity fields are returned. Missing current overage
fields stay unknown; no deprecated field is silently substituted, and quota is
not a dollar quote or spending authorization.
Reference: https://elevenlabs.io/docs/api-reference/user/subscription/get
