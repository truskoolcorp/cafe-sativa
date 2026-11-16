# Fresh text to included speech (dormant source)

`bindFreshIncludedSpeech` accepts an exact persisted replenishment receipt,
current normalized GLYPH canon and a separately trusted, revocable owner scope.
It performs no I/O and does not authorize itself. Only Zaria Solenne's already
bounded voice/model/portrait is accepted. Script limit remains 250 Unicode
codepoints, duration ceiling 30 seconds. Text longer than this is held intact,
never truncated or silently synthesized. The text generator's broader 600-char
limit therefore does not imply every draft is currently speech eligible.

The operation key hashes original text cadence key, claim token and exact script
hash. Policy renewal cannot change that key. Existing insert-only speech claims
therefore prevent replay, including unknown outcomes. A real new occurrence
requires a new real text receipt; this module never creates one.

The provider's admission/expiry check now runs inside the deferred request
callback immediately before its fetcher is invoked. Existing server passes
native fetch. Future tracking wrappers must preserve this final-native-boundary
property, not add unchecked asynchronous preparation after the guard.

## Required sustainable authority and integration (not installed here)

- Trusted exact stored text-attempt reader, never caller JSON or preview; current
  owner scope reader with revocation/expiry, limited to routine Zaria Gallery
  organic speech. No fresh per-post click is required within approved standing
  scope, but this module does not fabricate that scope or current permission.
- Re-read current live canon/scope and exact bound attempt before every operation
  phase and ensure actual POST admission honors revocation/expiry. Preserve same
  stable operation key; never regenerate to recover an unknown attempt.
- Included quota/provider inventory must remain valid, no automatic overage or
  top-up. Current quota reads are not a cross-consumer atomic credit reservation.
- Save original request receipt, private exact bytes, measured duration and
  script/voice/canon binding using existing machinery. Bind those NEW verified
  receipts into the fresh production slot. No reuse of old intro audio.
- No route, cron, scope row, grant or provider call accompanies this source.
  Private speech output still requires video, QA and publication authority.

## Concrete dormant source/operation

`character-production-fresh-speech-source.sql` proposes two owner-only private
relations: immutable included-speech scopes and one named Zaria binding. Binding
removal/disable/retarget revokes old scope. A scope requires an actual content
admin, attributable owner-message references, explicit expiry at most31days,
and disabled default. No rows are supplied. One public security-definer read
RPC returns only today's exact saved Zaria attempt and current speech authority;
no listing, arbitrary persona/model/script, resets or scope writes.

`createFreshSpeechOperation` derives today's Dallas key, loads this RPC through
existing service_role transport, reads live GLYPH and binds exact receipt.
Each stage rereads current authority and immutable source fingerprint. Permanent
claim, original provider receipt, byte hashes and measured audio use existing
operation/storage code. Awaited final POST checks re-read authority/canon; a final
synchronous enabled/deadline guard executes at native fetch. Database revocation
is observed at the last read, not claimed atomic with the external provider.
The operation is single-use, finite, defaults disabled, drains original work,
independent GLYPH work and provider/storage transports before releasing admission.

New access approval would need exactly
`public.character_production_fresh_speech_source(text)` EXECUTE for service_role,
including Storage admin's existing indirect SET ROLE path. This is additional to
the three text-generation capabilities. No table access is needed or proposed.
Private scope provisioning and enabling the new flag are separate material steps,
not authorized by merging source or supplying a text-generation budget. No live
installation, scope enrollment, route/cron, provider call or activation occurs here.
