# Foundation deployment plan: not applied

This document does not enable generation, billing or publication. The adjacent
preflight SQL only reads metadata. It must not be presented as a passing security
review: a human/independent reviewer still evaluates actual returned policies,
role membership, function definitions and deployment transport.

## Ordered stages and rollback

1. Record exact application/SQL revisions and read-only live inventory with
   `docs/proposals/character-production-preflight.sql`. Check the actual
   `character_production` schema, not public-table name guesses. Confirm missing
   functions individually and check existing owners/grants before installation.
2. Rehearse store, QA bridge and queue proposals against disposable PostgreSQL 17,
   including current real draft-trigger definitions with synthetic rows. Existing
   tests use a synthetic trigger fixture, not a complete production clone.
3. Choose the authenticated worker transport before granting anything. A Supabase
   service-role key bypasses ordinary row policies and is NOT a least-privilege
   implementation. Do not reuse it to claim scoped generator/QA access.
4. After separate migration/permission approval, install using a dedicated
   NOLOGIN non-superuser owner with no unrelated memberships. Keep budget, slots
   and schedules disabled/empty. No production access roles are created here.
5. Grant only the reviewed capability matrix below. Validate effective privileges
   (including PUBLIC, default ACLs and inherited memberships), not role names.
6. Provision private buckets/policies under separately reviewed authority. Confirm
   server-only credentials and private metadata access. Exercise synthetic bytes
   and rejected cross-key paths without invoking a generation provider.
7. Wire observed provider codecs, canonical audio/avatar mapping and scheduler.
   Keep disabled until exact slots, quote/cap, expiry and cadence are authorized.
8. Run one bounded authorized real slot; independently inspect video/audio/hash,
   original provider receipt and durable journal before recurring enablement.

Rollback before spending: disable scheduler, slots and budgets; revoke worker
execution/storage grants. Retain immutable jobs/receipts/reservations and private
objects for reconciliation. Never drop ledger tables, delete evidence, retry an
unknown provider write, or reset reservations as rollback.

## Capability matrix

- **Owner**: owns schema/tables/SECURITY DEFINER functions; NOLOGIN; never used by
  application runtime. Fixed `search_path=pg_catalog`, fully qualified objects.
- **Policy writer**: separately controlled authority for budgets, approved slots,
  schedules and QA targets only. No generator inheritance. No runtime self-approval.
- **Generator**: EXECUTE only on authorization, claim, submitted, unknown, pending,
  failed, output_status, output and due RPCs. No direct ledger table mutations,
  approval/delivery operations, role administration, superuser or BYPASSRLS.
- **QA ingester**: only `character_production_qa_prepare(text,text)`,
  `character_production_qa_commit(text,text,text,bigint,uuid,timestamptz,text,text)`
  and `character_production_qa_pending(integer)`. No budget/slot writes or
  publication approval. Verify exact installed signatures.
- **Ordinary app roles**: no production RPC/schema/table rights; no private object
  visibility. Test anon, authenticated and service_role explicitly.

## Storage is still an implementation dependency

`character-production-private` must be private with MP4-only bounded sizes.
Generator needs metadata read and INSERT-only at `{digest}/{sha256}.mp4`, with
paths tied to its valid claimed job and approved output. No UPDATE, DELETE, public
list/read or overwrite. Shape-only regex is insufficient authorization.
QA needs exact source read plus insert/readback for its enrolled destination in
`cafe-sativa-content`; it must not gain arbitrary private object reads. Existing
admin preview signing remains separate and must not become worker authority.

Supabase Storage integration needs a verified narrowly scoped role/claims path,
including how `getBucket` is authorized. The current adapters are interfaces, not
proof that the deployed service implements these restrictions. Until this is
resolved, report storage integration blocked rather than substitute broad keys.

## Completion evidence

Record installed function signatures/owners/revocations, effective role matrix,
private policy negative tests, rollback rehearsal, current trigger integration,
provider receipts and real private QA output. CI green alone proves none of the
live configuration. No secret values, signed URLs or personal data belong in logs.

## Offline review bundle

`node scripts/prepare-character-foundation.mjs /tmp/foundation.review.sql` only
writes a review artifact and source-hash manifest; it never connects to Postgres.
Both files must exist and match the recorded source before review. A nonzero exit
may leave a partial artifact (for example if the manifest path already exists);
that is not a certified bundle. Existing paths are never overwritten.

The role guard is an early refusal check, not permission certification. Before
application, independently inspect incoming/outgoing/transitive role memberships,
nonstandard/default ACLs, public-schema CREATE/database CREATE needed for DDL,
REFERENCES on existing promo tables, and exact QA SELECT/UPDATE/trigger access.
Confirm the complete current promo table shape. Provision owner separately and
SET ROLE only through a controlled migration identity, never application runtime.
No runtime authentication token, role membership, schema grant or storage policy
is created by this builder. Those require a separate, reviewed access change.
