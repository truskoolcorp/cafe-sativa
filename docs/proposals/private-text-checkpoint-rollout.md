# Private content checkpoint rollout (offline)

This is prepared code and reviewed SQL, not an applied migration or permission to
run another provider request. The original frozen occurrence/budget stay intact.

## Data and capability

Store canonical provider content JSON, up to 256KiB, with exact claim identity,
metadata and SHA256. This is not raw HTTP bytes. Exclude outer request/system
prompt, headers, credentials and arbitrary exception text. Generated content can
itself echo supplied context; this is not semantic secret redaction.

The write RPC atomically records existing allowlisted metadata plus content before
editorial parsing. A second RPC reads exact key/token/source-digest content,
metadata, parser version and original stored source snapshot (canon, programming,
recent scripts). Two non-grantable EXECUTE grants go to existing service_role.
Database admins and indirect assumers, including authenticator and managed Storage
admins, share this capability. No anon/authenticated EXECUTE or direct runtime
TABLE grants. The new table is private, append-only and excludes the frozen key.
This remains backend-reported evidence, not independent provider authentication.

Installation temporarily permits postgres to assume character_production_owner
and permits that owner to CREATE in public. During the transaction that owner can
control character-production objects. The installer verifies exact old memberships
and ACLs, removes both temporary permissions before commit, and rejects drift.
All-or-nothing rollback applies before commit. Post-install flag disable stops
application use; separately approved capability revocation preserves stored data.

## Runtime

Require additional CS_CHARACTER_TEXT_CHECKPOINT_ENABLED plus existing evidence
and generation flags; absent/default-off. Negative checkpoint capability probes
precede both outer occurrence and provider-budget claims. Atomic checkpoint save
precedes parsing. Shared original bounded signal, no retry, no detached write.
A private internal read operation (not a public route) can reconstruct/reparse
stored bytes, verify source digest and fixed parser version, and return only a
historical unapproved draft. It never calls a paid provider, writes accepted
output, claims, generates speech, approves QA or publishes. Later promotion needs
separate reviewed current-authority logic.

Content never received from the provider cannot be checkpointed. Abort, malformed
transport or uncertain database acknowledgment can still leave a hold. Readback
can recover a committed checkpoint after acknowledgment loss without regenerating.

## Retention and approval

Review private content after 30 days. There is no automatic purge; append-only
content remains until a separate owner-approved cleanup migration. Request
explicit approval of provider-content retention, original-context read access,
exact grants/effective principals and temporary installer privileges. Code-only
deployment leaves all flags off; database install does not authorize generation.

The prepared finite day/test and additional spend still require final
review, exact-date authority and approval. See the next-day finite
test design. This checkpoint rollout alone does not prove recurring readiness.
