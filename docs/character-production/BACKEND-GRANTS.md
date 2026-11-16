# Existing backend exact RPC grant review

The review transaction grants only ten existing owner-held production functions to
the existing service_role. It adds no table/schema access, LOGIN, new credential,
Storage policy, budget, slot, schedule or activation. Backend remains privileged;
this is not a claim of isolated generator credentials.

PG17 bootstrap creator membership has its original grantor (often a platform
bootstrap superuser), not necessarily the current installer. Require exactly one
ADMIN-only, non-INHERIT/non-SET edge per production role from that original grantor
and no self-grant. Snapshot those exact edges before adding a temporary owner SET
edge explicitly GRANTED BY the current installer. Remove only that temporary edge,
then compare the complete snapshot including original grantor. Do not revoke or
rewrite the original bootstrap grant.

Postconditions check all ten effective grants, exact function ACL delta (owner
issued, no grant option), unchanged table/sequence/schema ACLs, unchanged scoped
memberships, no owner SET remaining, and no anon/authenticated access. Missing one
grant aborts the transaction. Existing grants or a nonempty ledger reject replay.

Disposable PG17 CI reuses the isolated non-superuser provisioning database, applies
a rollback first, injects a missing-grant failure, then commits and tests actual
service-role RPC access plus denied ledger/owner-role access. Only the installer
name differs in the fixture. Production application is NOT performed by tests.
