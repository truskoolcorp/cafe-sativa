# Initial delivery plans: dormant source

The source reuses the immutable association already recorded by the bound planner:
`planning_records.promo_id → slot_key/digest → binding_snapshots.speech` contains
`textAttemptKey`, `textAttemptToken`, and `textSourceDigest`. It does not match
scripts or dates to guess the source. A narrow production-owner bridge returns
only the exact saved editorial and verification handles for that bound draft.
The draft's script and recorded audio script hash must match the saved output.

The Café-owner function resolves the existing QA-gated standing publication target
and inserts the Facebook/Instagram plan pair in one database transaction. Existing
plans without this exact immutable sidecar are held, never adopted, edited or
replayed. Repeating preparation returns the original exact pair; it cannot add a
third destination. Future target choice remains in the already reviewed resolver.
The immutable sidecar preserves original Facebook title, hashtags, collaborators,
source attempt identity and media snapshot digest. The editorial adapter checks
that actual plan/draft values match this evidence before using it.

The finite server operation calls these exact SQL functions with no retry and
reads both persisted editorial results. The initial-standing composition now
passes these exact saved rows to the existing editorial adapter, verifies current
source candidates, and invokes the existing semantic/standing-authority path for
each destination. Its separate semantic lease and collaborator mapping are
snapshotted at construction; an absent authorized lease holds before preparation. Cancellation/unknown writes are held;
original RPC work remains joined. Preparation alone is not publication or semantic approval and performs no paid
inference, generation or provider write. The standing composition can invoke
semantic assessment only under its separately authorized lease; neither path
dispatches a social post.

Future reviewed installation needs EXECUTE on the narrow production-owner bridge
for `cafe_metricool_owner`, INSERT on only the named delivery-plan columns plus a
scoped INSERT RLS policy, and finite runtime EXECUTE on prepare/read functions.
The known Storage-admin indirect path applies if runtime capability uses service_role.
None are granted by this rollback-only source. No private-table SELECT expansion.

Still required before activation: PG17 contract tests and independent review,
concrete trusted enrolled-QA route selection, scoped installed capabilities,
standing policy/cadence and genuine QA-approved fresh media. No end-to-end success
or live publishing is claimed.
