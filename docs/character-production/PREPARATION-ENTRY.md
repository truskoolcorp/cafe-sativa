# Original fresh preparation entry (dormant)

The no-argument server factory runs one real finite phase per call: existing
bounded text replenishment, exact saved-text-bound included speech, or read-only
original speech receipt recovery. It does not create synthetic content or receipts.
An owner-provisioned immutable lane supplies the existing trusted source scope and
separately approved text budget. The original Dallas daily key is retained in a
single occurrence. Later calls do not advance to another day, replay a claim, or
replace its identity. Phase admission is once-only; unknown outcomes remain held.

A real saved text row is joined using its original key, budget, token, source digest
and exact script hash. Previously existing daily output is not adopted. Speech
admission additionally requires the existing current included-speech scope. An
expired/current-day-mismatched occurrence can only recover its original private
receipt; recovery explicitly does not prove current authorization. New finite
text and speech operations recheck lane configuration/revocation at native provider
boundaries. Original work and underlying transports are drained before admission
release, including aborts.

Two new owner-only RPCs are proposed: `character_production_preparation_context()`
(reads/provisions the one original occurrence) and
`character_production_preparation_claim(uuid,text)` (claims text/speech once).
There is no direct runtime table access, role membership, RPC grant, owner row,
route, cron, activation or provider call in this patch. Runtime EXECUTE and any
known Storage-admin indirect service-role access need their own reviewed approval.
The separate existing text/speech permissions and owner scopes remain necessary.
The master preparation flag and existing provider flags default off.

This completes only the first original text/speech preparation chain. It does NOT
implement a sustainable successor, assign a generation slot, enroll a new production
candidate, create FB/IG plans or publish. Those next steps must use genuine original
speech receipts and existing immutable binding snapshots, preserve current canon,
wallet pricing and the $20 HeyGen monthly limit, and wait for positive publication
completion before retargeting an existing enrollment. No paid test was run.

Pending operational constraints include the existing speech limit of 250 script
characters versus text parser's 600 maximum. Oversized saved text is held, never
truncated or regenerated. Explicit owner-configured source scope and provider
budget/rate evidence must exist; this code does not invent either.
