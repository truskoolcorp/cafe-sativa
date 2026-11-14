# Empty scheduler-principal installer review

Offline generated proposal only. No connection, runtime grant, enrollment, route,
credential, candidate manifest or production activation is included.

Files: prepare-scheduler-principal-install.py emits the hash-pinned scheduler
proposal inside exact restricted-owner setup and verification. The generated SQL
is character-production-scheduler-principal-install.sql. Separate disposable
fixture/workflow validate this emitted artifact, not merely raw proposal SQL.

Requires direct PG17 source owner postgres, existing restricted NOLOGIN/NOINHERIT
ledger owner and exact bootstrap ADMIN-only membership, source drafts owner/RLS,
reviewed recurring QA/wallet/admin/planner foundations. Planner public RPC owner,
SECURITY DEFINER/search_path and ACL baseline are explicitly checked. Unexpected
prior scheduler objects or temporary authority are rejected.

Snapshots preserve existing source and every ledger table's rows, memberships,
default ACLs, namespace/table/column owner and ACL, RLS, policy and trigger metadata,
and existing function definitions. Auth-owned objects are included in metadata
snapshots; distinct auth owner is not replaced. Existing owner evidence rows are
preserved, never translated into invented scheduler enrollment.

Temporarily enables only source owner SET to ledger owner and ledger public CREATE,
creates three empty owner-only RLS tables and six functions, then removes temporary
rights and verifies original baselines. Expected three triggers, exact function
signatures/search paths/security and owner-only ACLs are verified. Unexpected
default grants abort; they are not silently erased or normalized.

Fixture includes rollback, injected abort, security-mode and row-write sabotage,
unexpected defaults, no runtime EXECUTE, empty tables, privilege cleanup and
reapplication refusal. Python compiles and emitter pins verify locally. Actual
PG17 CI remains required; no successful database test is claimed for this new
installer until that run completes.

Persistent permission delta: none for runtime roles. Any later EXECUTE grants to
scoped wrappers, genuine enrollment/provisioning, cron activation and downstream
production capabilities require separate reviewed changes.
