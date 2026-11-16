# Four dispatch capabilities, separate authority writer

Offline proposal only, base 2a2c42d. No live grant, route enablement, scheduling, provider request, credentials or data changes. Independent review and explicit scoped approval are required before application. Merging this proposal does not authorize its use.

## Minimum capability split
The existing dispatch path needs four RPCs: cs_preflight_cafe_metricool, cs_claim_cafe_metricool, cs_identity_cafe_metricool and cs_finish_cafe_metricool. Preflight validates already recorded authority; claim atomically reserves it; identity and finish retain receipt/reconciliation state. All four are necessary for the current adapter. None records new authority.

The separate cs_record_cafe_metricool_authority RPC remains owner-only. It accepts p_actor UUID and policy/evidence JSON. A UUID identifying an existing admin is NOT authentication of the database caller, and caller-supplied policy strings are NOT independent evidence of owner consent. Granting writer and dispatch together to service_role would let the same credential establish and consume authority. This proposal deliberately refuses that exposure.

Dispatch is constrained by pre-existing exact schedule digest, source-state CAS, final QA, destination/media reservation keys, allowed Café FB/IG mappings and expiry. It is NOT scoped to one specific plan by the service credential: service callers can operate any approval that meets these installed predicates. Identity/finish also trust the holder of the claimed token to report real provider results. Server-side external media/canonical/account validation and receipt verification remain necessary. SQL does not contact Metricool or independently verify provider evidence.

## Effective callers, not merely direct ACLs
The sole new direct ACL is non-grantable service_role EXECUTE on four existing SECURITY DEFINER functions. Existing dedicated owner retains EXECUTE. No writer/private-schema/table grant.

Reviewed effective path includes postgres, authenticator -> service_role SET, and supabase_storage_admin -> authenticator -> service_role SET. Storage admin does not inherit service role USAGE but can SET into it; this remains a real capability exposure and must be disclosed. Existing superusers can already bypass ACLs. The proposal pins service/authenticator attributes, exact service memberships, exact Storage attributes/sole membership edge and rejects any other non-superuser effective SET/USAGE path. It creates no new role edges or credentials.

Temporary SET into cafe_metricool_owner is removed. No temporary CREATE is needed. Catalog/role/membership/default/ACL/policy/trigger/source/private-data snapshots verify the only persistent delta is the four exact grants. Full expected post-repair definitions and owner-only baseline ACLs of all ten Café functions are pinned, including the authority writer. Replay/partial grants fail rather than normalize unknown state.

## Smallest legitimate path to routine unattended publishing
For the initial finite batch, a separately reviewed owner-authorized recording operation can invoke the owner-only writer with the exact immutable candidate snapshots, actual authenticated actor and recoverable owner-message scope. It need not grant service_role authority creation. The existing bounded dispatcher can then consume only those recorded finite approvals. Expiry and changed source require a new legitimate recording, not bypasses or retries.

For ongoing unattended authority recording, use the existing trusted authenticated admin transport / reviewed finite enrollment and server-owned policy assessment. Before granting any recording capability, the implementation must establish the authenticated principal server-side and bind it to the exact approved owner scope; a generic service-role RPC accepting arbitrary actor/policy is insufficient. No new framework or broad credential is proposed here. This separate recording path is not enabled by these four grants.

## Disposable tests
The existing non-superuser store/writer fixture completes first, including its original concurrency tests. The separate negative-only identity repair fixture then runs. This grant requires the repaired authorized() body (prosrc MD5 b851290417cceb49a25ab085e75f4765) and refuses the old hash/time-only predicate. Its baseline JSON intentionally represents the required post-repair state, not a claim the repair is already live. New tests exercise exact effective proxy topology, rejected unknown direct and indirect callers, Storage drift, owner membership drift, dependency/ACL drift, accidental writer grant, full rollback, injected abort and wrong-target grant. After committed synthetic grants, runtime roles remain denied except service_role dispatch; service_role cannot call writer, has no private schema access, and a nonexistent plan cannot gain approval merely because the capability exists. Replay fails.

Fixture's synthetic provider grantor uses explicit ADMIN on authenticator but no SET/INHERIT, reproducing only the observed edge. Local Python compilation and generator equality are not PG17 proof; actual CI must pass. Tests do not publish posts or establish production readiness.


## Prospective provider-grantor hardening (base bb825274)
The already-applied installation and its successful verification remain historical evidence; this change does not replay or normalize that live installation. Future installation preflight now requires the bootstrap edge's grantor to be exactly `supabase_admin`, not merely a matching non-self grantor. Service membership grantors remain tied to that exact checked bootstrap.

The disposable fixture maps this exact bootstrap provider to its existing `postgres` grantor, while retaining the distinct synthetic `supabase_admin` Storage grantor. A negative transaction replaces all three matching bootstrap/service edges with a different synthetic superuser grantor and must fail `Bootstrap membership mismatch` before any capability grant. Its rollback must restore the full snapshot. This is test-only topology, never a production role change. Generator reproduction/Python compilation alone are not PostgreSQL17 execution evidence; the revised fixture requires CI.
