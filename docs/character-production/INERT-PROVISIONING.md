# Inert first-stage provisioning (review only)

Run the offline builder to produce a private `.review.sql` bundle and source hash
manifest. It combines only the store, queue and broker-authorization proposals in
one guarded transaction. It never connects to a DB; generated SQL is not placed
in the automatic migration directory. No runtime credentials or LOGINs exist.

## Exact scope

Creates fresh `character_production_owner`, `character_production_generator` and
`character_production_output_broker`, all NOLOGIN, NOINHERIT, non-superuser,
NOCREATEROLE, NOCREATEDB, NOREPLICATION and NOBYPASSRLS. No existing role is reused.
Owner owns the new schema/tables/functions. Generator receives seven exact public
RPC signatures; output broker receives only output_status, output and
broker_authorized. Neither worker has direct ledger table or private schema
rights. PUBLIC/anon/authenticated/service_role receive no production RPC rights.
No budget/approved slot/schedule rows are inserted and all enabled defaults are
false. No Storage bucket/policy, provider key, grant to a login, cron, route or
runtime enablement is included.

**QA bridge deliberately excluded.** No privileges or changes are made to
existing promo drafts. A later separately reviewed QA tranche must establish
exact draft-column/trigger permissions before it can ingest approved output.

## Installer and PG17 membership handling

Requires a direct reviewed PG17 session with CREATEROLE and grantable CREATE on
the current database plus grantable USAGE/CREATE on public schema. It refuses
existing production roles/schema/RPCs and refuses PUBLIC CREATE instead of
changing unrelated global rights. Does not require SUPERUSER.

In PostgreSQL 17, non-superuser CREATEROLE creators receive bootstrap-granted
ADMIN TRUE / SET FALSE / INHERIT FALSE memberships in roles they create. These
admin-only edges cannot be removed by the non-superuser creator. See official
[role attributes](https://www.postgresql.org/docs/17/role-attributes.html).

The bundle explicitly disables automatic self-inherit/set grants, adds a
self-granted temporary SET-only owner membership, grants temporary CREATE for
installation, SET ROLEs to owner, sets closed owner defaults, installs exact
sources and applies exact RPC grants. It resets role and revokes temporary
CREATE and self-granted owner membership before commit. Postconditions allow only
installer ADMIN-only incoming edges; reject outgoing memberships, SET/INHERIT
edges, unsafe role flags, lingering CREATE and incorrect object ownership/RLS.

This is not a claim that the installer loses administration rights. It already
has CREATEROLE and retains documented ADMIN-only edges. No runtime login receives
any role membership. A later credential/transport provisioning step must be
explicitly reviewed and constrained; do not substitute an existing service key.

## Evidence and rollback

Disposable CI executes the exact generated SQL under non-superuser
`provision_installer`, first rollback then commit; verifies exact allowed/denied
RPCs and actual denied table/function calls, no LOGINs or lingering SET authority,
QA absence and refusal of reapplication. It touches only an explicitly local
`character_ci_provision` database. Tests are not live-install evidence.

Production execution must wait for successful disposable CI, independent review,
and action-time approval where required for permission changes. Record source
hashes and actual effective privilege inventory. On error the single transaction
rolls back all role/schema/grant creation. After success, pause rather than drop
ledger evidence or re-run this fresh-only bundle; reconcile revisions explicitly.
