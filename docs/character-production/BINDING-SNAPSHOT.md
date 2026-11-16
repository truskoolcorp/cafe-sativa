# Original fresh-media binding snapshot (dormant)

The source-only SQL wrapper calls the existing planner and stores the original
binding in the SAME transaction. It never writes a second promo draft. A previous
plan without a snapshot cannot be retrofitted. No table, grant, authority row,
budget or activation is installed by this proposal.

Snapshot contains only exact account/model/aspect identity, CanonicalImageBinding
(including new RenderedAudioBinding and approved scene), original speech claim and
receipt hashes, and text occurrence/source identity. No keys, signed URLs, caller
headers or arbitrary runtime configuration. Persist original compact JSON text;
SHA256 uses those bytes in both JavaScript and PostgreSQL, not JSONB reserialization.
The planner evidenceRef must equal `binding-snapshot-sha256:<hash>`.

The trusted planning composition must first load and verify the real text attempt,
original fresh speech receipt/audio chain, current GLYPH canon, approved scene
bytes, provider account configuration, actual measured duration/quote, and owner
planning scope. `verifyBindingSnapshot` checks structural integrity and binding
hashes, not whether evidence exists. Never treat arbitrary JSON as trusted proof.
No new receipt is manufactured here. Exact current scene/audio re-verification
remains required by existing native provider preparation.

The exact selected-token reader supports only generate/collect. It delegates
current enrollment, authority and original task eligibility to the existing
selection reader and returns the original planning slot even for collection.
`createSelectedBindingReader` rejects identity changes, mismatched slot digest,
changed task/binding or revoked local gate. Call it for the selected token only,
not a new queue head. Build one per-occurrence manifest, never append multiple
bindings for the same character. Original collection uses that original snapshot,
not today's canon/config substitution.

`bindSnapshotPlannerRpc` adapts only the existing exact planner RPC to the bound
wrapper, checks the additional snapshotSha256 receipt and returns the existing
four-field planner receipt. It never retries an unknown write. Supply it to the
existing planner only after trusted evidence acquisition. Remaining integration:
derive runtime manifest from the validated reader using existing fixed provider
transport configuration and wire the selected occurrence into existing adapters.
New wrapper and reader execution are separate material access proposals; existing
plan EXECUTE does not cover them. No direct snapshot table privilege is needed.
Keep new capability owner-only until applicable review/approval and actual PG17
rehearsal. No source-only result proves a generation or publication occurred.
