# Future metadata-only receipt durability (offline)

## Incident observation

The existing frozen occurrence and its one-use recovery claim remain immutable.
Provider-side logs can show a completed request even when the application retains
no response, provider ID or usage. Such metadata is not a finalized billing record
and cannot reconstruct lost generated text. No further generation is authorized
by this proposal.

The old pipeline writes receipt metadata only after parsing, editorial validation
and duplicate checks. It returns a generic held status on failure. Therefore an
otherwise successful response can be lost before persistence. Provider logs expose
metadata, not the generated text. The exact failure stage cannot be reconstructed.

## Proposed dormant boundary

A one-shot wrapper validates a tightly allowlisted metadata receipt and persists it
before returning the response to any editorial parser. The sink receives provider
message/request IDs, fixed model, stop reason, bounded token usage and a content
digest only. No prompt, raw generated text, header, credentials, arbitrary exception
message or error cause is exposed. Diagnostics are fixed enum codes.

The SQL proposal supplies an append-only receipt table tied to the exact existing
attempt key/token/source digest. It neither changes attempt state nor releases
budget, approves output, resets a claim or permits generation. The frozen November
16 Zaria key is excluded. Identical receipt readback is idempotent; changed evidence
is rejected. Runtime wiring is prepared behind a default-off flag; no live grants or activation have been applied.

Metadata-only evidence cannot reconstruct lost text or cryptographically attest
provider origin. A future recoverable-body design is a different storage/access
scope requiring separate review and approval. Neither proposal repairs the lost
current output or permits a replacement sample.

## Deployment boundary

Keep all production flags off. Before live installation, recheck the reviewed sink implementation,
deadline/hosted drainage, role graph, scoped grants and metadata retention.
This scope adds metadata evidence, not a durable failure-stage event log. Apply no DDL or new
security capability without required action-time approval. Do not publish this
proposal as if it were an active fix or a recovered current receipt.

## Proposed integration and approval boundary

The future runtime integration is fail-closed behind the additional
`CS_CHARACTER_TEXT_RECEIPT_EVIDENCE_ENABLED` flag. This flag defaults off and is
not a generation authorization. Existing source, finite lease, budget, dispatch,
occurrence and provider gates still apply. A receipt-capability check must pass
before dispatch, and response metadata must be durably accepted before editorial
parsing. A missing sink or unknown persistence result must hold the operation,
never retry or release its reservation. All transports share the original bounded
operation and its cancellation/drain lifecycle; no detached receipt writes.

The proposed database functions are persistent infrastructure, not a renewal of
the expired private test. Their evidence scope includes matching existing and
future text attempts except the expressly frozen November 16 Zaria key, rather
than only Zaria. Privileged backend callers who know an attempt key, token and
source digest can submit metadata. This is application-observed evidence, not
cryptographically authenticated provider proof: a malicious privileged first
write can poison the append-only record. No raw response or prompt is stored.

Code deployment with the new flag absent/off is separate from approving the
new database capability. Installation needs reviewed action-time approval of
exact functions, grants and effective principals. Runtime enablement and any new
generation remain separate decisions. The current lost script stays lost and
its claim/reservation stays frozen.

Retention: retain append-only receipt metadata alongside its parent attempt;
there is no automatic deletion or expiry in this proposal. Any future retention
cleanup needs a separately reviewed procedure, not a weakening of the existing
immutability guards.

### Durability limits

A provider/network/body failure can occur before a valid response envelope is
available. A host deadline, abort, or database failure can prevent its metadata
from being persisted. Readiness checks reduce missing-capability failures; they
cannot guarantee a later write. The fix deliberately does not extend execution
or generation authority to obtain evidence after cancellation. It must not be
described as guaranteed recovery, exactly-once provider execution, or a repair
of prior missing content.

The runtime additionally refuses native provider dispatch unless at least 25
seconds remain in its own operation deadline. This is conservative headroom, not
a persistence guarantee: the existing provider transport is bounded to 8 seconds,
the backend transport to 8 seconds, and an inherited parent/host deadline may
expire sooner than the locally known deadline. No abort signal is extended.
