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

On explicit invocation, two distinct synthetic JSON contenders use one configured attempt
`production-speech-operations/storage-probe-<uuid>/claim.json` object, upsert:false.
Requires exactly one success and one recognized duplicate conflict (400 Asset Already Exists or 409 ResourceAlreadyExists/exact duplicate message), then exact winner hash
readback. Two writes are the deliberate race, not retries. A generic error or ambiguous
response is never accepted as conflict proof; no rerun/overwrite. Result includes
known path for read-only reconciliation. Tiny synthetic marker remains private as
evidence; no delete, real claim, audio, bucket configuration or permission change.

One verified probe demonstrates observed behavior for this runtime/bucket/prefix,
not a guarantee against future policy changes or global account concurrency. The new route
must be reviewed/deployed and the finite probe flag enabled to invoke POST. No extra grants required
if the existing runtime SDK already has the exact needed access; otherwise stop.

24 local mocked tests and strict TypeScript pass. No live probe was executed.

### Finite configured attempt (PR137 review correction)
Enabled POST additionally requires server-owned
`CS_CHARACTER_SPEECH_STORAGE_PROBE_ATTEMPT_ID` (UUID) and
`CS_CHARACTER_SPEECH_STORAGE_PROBE_EXPIRES_AT` (finite future timestamp).
Neither is accepted from request data. The attempt is captured before auth,
rechecked after auth, and its expiry bounds the entire abort deadline.
Every instance and repeat uses the SAME marker key for that configured UUID.
Storage create-if-absent, not the process-local busy latch, bounds creation to
one marker. A repeat sees conflicts and is unverified, never fresh successful
evidence; reconcile the known object read-only instead of changing the UUID.
Changing configuration to a new UUID represents a separately authorized probe.
No global request lock is claimed: repeated requests may attempt conflicting
uploads, but cannot create additional objects for the same attempt.
GET remains read-only, independent of this POST configuration.
Tests cover replay, cross-instance concurrency, late auth, timeout and
process-local settlement latching. No live Storage probe was run by these tests.


Duplicate recognition follows [Supabase standard uploads](https://supabase.com/docs/guides/storage/uploads/standard-uploads)
and [Storage error codes](https://supabase.com/docs/guides/storage/debugging/error-codes).
Installed storage-js StorageApiError exposes message, numeric HTTP status and
string service statusCode. Thus statusCode may be ResourceAlreadyExists, not a
numeric HTTP status. Generic 400/409 errors are rejected, not treated as proof.
