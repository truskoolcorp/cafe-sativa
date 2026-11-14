# Inert planner installer: prerequisite-only, not activation

`prepare-planner-install.py` emits the pinned planner, read-only policy function,
and blank-draft helper under their distinct existing owners. It requires PG17,
unchanged direct source owner and the original ADMIN-only ledger-owner membership.
It grants no service-role RPC, inserts no policy/binding/job/evidence rows, and
changes no existing ledger/source rows. Temporary SET/CREATE is removed. The only
new inter-owner permissions are exact boolean draft-proof execution to the source
owner and exact blank-draft-helper execution to the ledger owner.

It snapshots and checks owner/ACL/RLS, column privileges, functions, policies,
triggers, memberships and source/ledger rows; checks exact new signatures and
ACLs; aborts on unexpected defaults. Rollback fixture includes induced failure,
data mutation, changed security mode, and unexpected privilege inheritance.

## Production prerequisites (not present in the reported baseline)

1. Reviewed recurring QA installer and source policies, including
   `qa_slot_bindings` and `character_production_qa_draft_unplanned`.
2. Reviewed actual HeyGen wallet guard installer, with the Dallas calendar helper.
   The original ceiling/reservations remain untouched. Its policy/evidence remain
   empty until separately reviewed enrollment: $20/month, existing API balance,
   no auto top-up, valid rate/credit evidence, original charges included.
3. The existing reviewed source-owned boolean administrator bridge must grant
   only its exact execute capability to the restricted planner owner. This
   installer does not broaden access to the source identity tables.

The reported production currently has only the six basic ledger/QA tables and
therefore must be rejected by this installer. Do not run raw proposals or fold
wallet installation, approval seeding and activation into this step. Synthetic
fixture identity substitution is test-only and does not establish production
source-owner identity or approval.

Local Python generation/compilation only. Disposable PG17 CI must pass before
reviewing for production application. No live apply or remote push performed.
