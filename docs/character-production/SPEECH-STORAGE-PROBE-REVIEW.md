# Protected provider-free claim atomicity probe

Existing `/api/admin/character-promotions/storage` GET only checks metadata; its POST
provisions storage, not claim conflict semantics. Do not use old speech canary POST
as a probe. No existing dedicated atomic object probe was found in inspected code.

New helper uses existing runtime admin Storage SDK through createProductionFetch
with3second transport bounds, exact private bucket metadata, no key access or provider
calls. Authenticated same-origin bodyless POST server helper is disabled by a separate
CS_CHARACTER_SPEECH_STORAGE_PROBE_ENABLED flag on POST. The registered protected route is
`/api/admin/character-promotions/speech-storage-probe`. GET returns only sanitized
fresh Zaria canon revision/portrait/voice/rights, never the full context or secrets.

On explicit invocation, two distinct synthetic JSON contenders use one random new
`production-speech-operations/storage-probe-<uuid>/claim.json` object, upsert:false.
Requires exactly one success and one explicit409 conflict, then exact winner hash
readback. Two writes are the deliberate race, not retries. A generic error or ambiguous
response is never accepted as conflict proof; no rerun/overwrite. Result includes
known path for read-only reconciliation. Tiny synthetic marker remains private as
evidence; no delete, real claim, audio, bucket configuration or permission change.

One verified probe demonstrates observed behavior for this runtime/bucket/prefix,
not a guarantee against future policy changes or global account concurrency. The new route
must be reviewed/deployed and the finite probe flag enabled to invoke POST. No extra grants required
if the existing runtime SDK already has the exact needed access; otherwise stop.

11 local mocked tests and strict TypeScript pass. No live probe was executed.
