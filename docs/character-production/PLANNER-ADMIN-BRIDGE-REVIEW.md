# Narrow genuine administrator bridge, offline proposal

Matches the existing content-admin predicate in `persona-qa-observation.sql` and
`persona-approval-gates.sql`: exact JSON boolean true at
`auth.users.raw_app_meta_data.cafe_sativa_admin` for the supplied UUID. String
"true", user-editable metadata, absent identity and null input are not admin.
It grants no owner consent, does not inspect profiles flags, and creates no users
or claims. Actor IDs must still originate in trusted current server identity.

The direct existing source owner must already have auth schema USAGE and SELECT
on the exact two required columns. No such privilege is granted by this installer.
It creates one VOLATILE SECURITY DEFINER boolean function, fixed pg_catalog search
path, and grants only its exact EXECUTE to the restricted ledger owner (plus its
own implicit owner privilege). The ledger owner gains no auth/table access.
Existing function, schema/table/column ACLs, owners, RLS, policies and membership
are checked unchanged. Existing overload or unexpected default grant aborts.
No ownership transfer, activation, policy enrollment, or production writes.

Disposable tests exercise the genuine predicate against synthetic identities,
revocation, string-vs-boolean and app-vs-user metadata, missing identity, restricted
ACLs, rollback, unexpected defaults, and changed security mode. Python compilation
passes; actual PG17 CI is still required. Fixture role names/data are never
production substitutions. Separate files from the planner installer PR.
