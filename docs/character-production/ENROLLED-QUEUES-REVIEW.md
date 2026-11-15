# Scoped production queue proposal
Offline only. No existing due/pending body, grants, table state or live enrollment
is changed. Main queue contracts were fetched from GitHub: globally limited due
(provider,model,limit<=25), pending (provider,model,limit<=5). They have no
key/cursor/enrollment argument. Filtering their result after LIMIT can starve an
enrolled slot behind foreign rows; repeated scans are not a safe solution.

Two new read RPCs use existing scheduler_current, preserving binding, current
admin, policy snapshot/revision, immutable candidate snapshot and finite expiry.
They join enrolled exact slot/digest to authoritative schedules/jobs BEFORE
ordering/limiting. Due also matches actual schedule time and retains current
budget/period/authorization/time predicates. Pending retains submitted state and
exact stored job slot/digest. Invalid/revoked enrollment returns null, not an
empty-success claim. Raw queue APIs stay unchanged.

Existing scheduler_current takes row locks for policy/enrollment validation;
"read" here means no persistent mutation, not lock-free operation. Automatic
collection after enrollment expiry is intentionally blocked. A separate
reviewed recovery scope is needed; never renew enrollment or replay generation
silently. No claim/spend occurs in these read functions.

Adapter receives code-owned enrollment and 1..32 unique key/digest scopes. It
rewrites only due/pending RPC names and adds enrollment, validates returned
membership/digests, and leaves exact write enforcement to restrictProductionRpc.
No generic RPC fallback, caller-supplied scope, new credentials or implicit
service grant. Caller must still authenticate cron and supply the reviewed
client. Adapter is not authentication.

PG17 fixture runs chained real foundation/principal in a fresh local disposable
database, supplies explicit synthetic service-role grants ONLY in fixture,
seeds40foreign rows (30due and10submitted) before owned due/pending rows, checks
owned rows are selected, null on revocation, and unchanged foreign job snapshot.
Proposal revokes runtime execute permissions. Production installation and exact
future grant approval remain separate. No live apply or SQL execution occurred
during local development: psql unavailable here. Python syntax and Node tests
passed; PG results require CI, and must not be described as passing yet.

Next integration after green CI/review: explicit reviewed enrollment worker
composition (not expired canary), using this adapter plus existing atomic claim
and broker. Exact-key QA bridge ingest is already available and need not scan
global QA queue. QA pass and authorized delivery remain separate; this patch
does not make the entire pipeline autonomous.

Use createEnrolledServerProductionRpc with a reviewed ProductionServerRpcClient,
not createServerProductionRpc: the latter intentionally does not admit the new
scoped read names. The new factory permits exactly the two scoped reads and
existing fenced write/authorization operations, attaches abort and retry(false),
and exposes only the outer finite-enrollment adapter. No arbitrary RPC passthrough.
Twelve unit tests pass, including revoked/null/malformed reads, real SDK shape,
abort/no retry and absence of production grants/raw function replacement.
CI path triggers cover foundation proposals, chained fixture scripts and adapter
dependencies; the workflow runs the adapter unit tests before disposable PG17.
