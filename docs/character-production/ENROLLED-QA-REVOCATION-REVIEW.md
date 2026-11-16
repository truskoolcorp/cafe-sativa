# Scoped QA discovery and revocation contract
Offline proposal, no runtime grant or activation. New scheduler_qa_ready uses
existing scheduler_current and copies qa_ready_slots predicates from exact main
15230fadea9810a55c6bc7860f4f9d5cbca422d7, adding candidate slot/digest enrollment
join BEFORE LIMIT. Ordering is explicit both inside and outside aggregation.

Use ready-slot discovery rather than raw qa_pending: fresh generation has a
qa_slot_binding but may not yet have a materialized qa_target. Existing
qa_materialize creates that exact target; existing bridge then prepares/copies/
hash-checks/commits private unapproved video. New adapter admits only scoped
discovery and exact key/digest materialize/prepare/commit calls through reviewed
SDK with abort and retry(false). It cannot approve QA or publish content.
Null enrollment is an error, not idle success.

New PG17 fixture seeds ten foreign pending-QA records before the owned record,
checks owned discovery and denied disabled binding/revoked enrollment, and
proves the discovery reads do not create targets or ingestion receipts.
No actual generated media is used in this isolated synthetic fixture.

Separate deterministic discovery/revoke/claim fixture:
- obtains an owned due row, validates raw claim in a rolled-back positive control;
- starts explicit operational revoke and waits for the open transaction barrier;
- starts raw claim and observes its actual database Lock wait;
- commits revoke, asserts null claim, no job and no reserved budget.
It uses a synthetic non-HeyGen provider to isolate lock semantics; it is not
proof of HeyGen wallet accounting. It does not assert revocation cancels a
provider POST already issued or a claim that committed first.

Admin removal is DIFFERENT: scheduler_current denies subsequent discovery, but
an already cached slot can still pass raw claim unless operationally revoked.
The fixture demonstrates that separation in a rollback transaction rather than
claiming broader protection. Activation needs a reviewed operational revocation
path; discovery validation alone is not atomic downstream revocation.

All changes remain inert. Six Node tests, strict TypeScript and Python syntax
checks pass locally. New PostgreSQL tests await actual disposable CI execution.
