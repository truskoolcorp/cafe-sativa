# Owner-only Café authority writer installer

Review-only generated wrapper; no live apply by this patch. Base a30fb41. Reuses the unchanged `cafe-metricool-authority-writer.sql`, pinned SHA256 6852385f5523369c8df99657750555c73e4a0eee62f187b784959e89cb61d61f. It does not implement a second persistence path or change the authority policy.

## Exact persistent scope
- One empty private owner_authority_provenance table, FK to existing private approvals.
- One private canonical_json(jsonb) function.
- One public cs_record_cafe_metricool_authority(uuid,jsonb,text,text,text,jsonb,uuid,timestamptz,timestamptz,jsonb) function.
- All three owned by existing inert cafe_metricool_owner. Functions/table owner-only; no runtime EXECUTE, backend grants, approvals, flags, media generation or provider requests.

The table's FK adds internal constraint triggers to the existing approvals table. Existing triggers must remain byte-identical. The existing source guards, policies, table/column ACLs, function bodies/owners/ACLs, role attributes, memberships, default ACLs and schema ACLs are snapshotted and compared. Existing empty approvals/attempts and all 22 negative receipts must remain unchanged.

## Preflight and temporary installation authority
Eight exact installed dependency definitions and owners are captured in tests/sql/cafe-authority-installed-baseline.json. This includes the actual volatile p_actor admin bridge, not the older absent-helper template. Require precise existing helper ACL (postgres + character_production_owner + cafe_metricool_owner) and owner-only store RPC/helper ACLs. Require absent writer objects and correct owner/schema. Unknown changes stop rather than replace.

Read-only live evidence: owner has exactly one membership edge, cafe_metricool_owner to postgres, grantor supabase_admin, ADMIN true / INHERIT false / SET false; owner itself belongs to no roles. No owner default ACLs exist. Installer requires that exact topology and no owner defaults. Existing postgres managed defaults on public/storage remain untouched and are not used to create permanent objects.

Temporary self-issued SET membership and CREATE on public are used to install as the existing dedicated owner, then removed. No CREATE on database/auth, no role creation, no auth-table rights and no lasting SET are added. This installation has to receive scoped review/authorization independently of code merge.

## Tests and limits
Existing production-like non-superuser store fixture invokes the new writer installer fixture before inserting synthetic approvals. It tests full rollback, injected abort, dependency drift, unknown function/table default grants, committed empty owner-only install, denied runtime access and refusal to replay. Existing store concurrent claims and parent-row locks still run afterward. The isolated test maps postgres installer to metricool_installer and managed bootstrap supabase_admin to fixture's postgres; no production assumption is broadened.

Local Python compilation and generator equality are checks only. Actual PG17 execution is required in the existing Café Metricool workflow. This fixture proves installation mechanics; the separate existing authority-writer behavioral fixture continues testing digest/QA/authority semantics. Neither is proof of production scheduling or publication.
