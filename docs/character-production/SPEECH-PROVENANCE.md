# Independent speech reservation and provenance (disabled)

The HeyGen video reservation does not authorize ElevenLabs synthesis. This isolated
tranche adds separately provisioned speech budgets, exact authorization rows and
nonreclaimable unique job keys. Explicit account/month caps and positive conservative
cent quotes are mandatory even when an account has prepaid characters. No free or
zero-cost default, guessed rate, quota-to-dollar conversion or shared video budget.

State flow: reserved → rendered → pending_qa; interrupted/uncertain submissions
remain unknown, with budget retained. Duplicate key or exhausted cap cannot call
provider again. A second current canonical check follows durable claim; every
provider error or missing receipt is unconfirmed rather than retryable. The paid
adapter uses existing server key accessor and exact voice/model/script at official
POST `/v1/text-to-speech/{voice_id}?output_format=mp3_44100_128`, no write retries,
fixed bounds and required provider `request-id` response header. No production
key was read and no request was made during implementation.

The exact response bytes produce a manifest containing script/audio hashes,
canonical portrait/revision, exact voice/model/avatar and provider receipt. SQL
stores that receipt before insert-only private MP3 upload. Exact readback precedes
SQL attestation; current budget and authorization must still match while locked.
Only then does the engine return a pending-QA manifest. This does not approve or
publish audio/video. Header sniff/hash proves bytes and provenance association,
not perceptual quality; listening and canonical QA remain separate.

The storage adapter uses the installed Supabase SDK contracts, verifies live
private audio-only bounded bucket metadata, calls upload with upsert:false once,
and uses bounded exact-key streaming hash readback. Unknown writes are not retried;
original SDK work remains tracked until settlement. Recovery from rendered/unknown
requires deliberate provider/storage reconciliation, not another synthesis call.

Migration is review-only and grants nobody execute/table access. Production owner
installation, exact backend grants, private bucket and approved speech rows/budgets
remain explicit deployment steps. No route or cron is mounted. Client-supplied
manifests are not trusted synthesis receipts: only this validated backend path may
attest; no generic public attestation endpoint is provided.

Official contracts: https://elevenlabs.io/docs/api-reference/text-to-speech/convert
and https://github.com/elevenlabs/skills/blob/main/text-to-speech/SKILL.md (response
request-id and x-character-count guidance). Character-cost headers are not used as
permission to exceed the preauthorized conservative monetary reservation.

Storage capability is preflighted before claiming cost and again immediately before
POST. Each exact authorization includes maxAudioBytes; provider streaming, engine,
SQL manifest attestation and live bucket limit must agree. A planned8MiB bucket
therefore requires an authorized≤8MiB speech cap rather than silently accepting32MiB.
A later storage outage remains possible after preflight and is a reconciliation
hold, never automatic regeneration.
