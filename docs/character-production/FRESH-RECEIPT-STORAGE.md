# Original fresh speech Storage recovery (dormant)

`createFreshSpeechReceiptReader` supplies the missing read-only Storage composition
for `verifyFreshIncludedSpeechReceipt`. Its input must come from the actual trusted
saved daily text attempt: daily Zaria key, original text claim token, source digest,
and exact script SHA256. It derives the fresh speech key using the same formula as
the original binder. It accepts no owner lease, operation, arbitrary key or URL.

Only existing private paths are read:
- `cafe-sativa-characters/production-speech-operations/<derived-key>/claim.json`
- the same directory's `provider-receipt.json` and `receipt.json`
- `character-production-audio/audio/<original-provider-audio-hash>.mp3`

JSON is capped at 16 KiB; audio at its exact original receipt length and at the
existing 1 MiB maximum. Bucket metadata must match existing private policies.
Downloads use the supplied finite signal, no-store, redirect:error and bounded
stream cancellation. The SDK interface has no upload, signing, listing or provider
method. No new Storage path, grant, database object, route or activation is added.

Call `recover()` once and always drain `whenSettled()` before releasing admission.
Draining permanently closes new recovery admission without interrupting an already
admitted recovery. The reader applies a 30-second default (85-second maximum) shared deadline, checks
the local gate before actual queued SDK calls and after reads, and cancels a late
stream on abort. An SDK metadata call has no abort parameter; drain intentionally
waits for its original completion rather than pretending that abort settled it.

Recovery verifies the stored original operation and scope plus the full claim,
provider receipt, final receipt and actual audio/duration chain. Expired original
authority remains valid historical evidence, not permission to generate again:
`currentAuthorityVerified` remains false. Missing snapshots are not reconstructed;
changed identities, claims and audio fail closed. Current planning/speech authority
must be checked separately by the trusted caller. Caller identity is not accepted
from public request data. These fixture tests do not prove a production run.
