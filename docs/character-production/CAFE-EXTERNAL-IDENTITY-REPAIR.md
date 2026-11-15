# Negative-only external promo identity repair

No activation, delivery, grant, new source data or publication authority. The existing helper suppresses exact media bytes at an exact brand/network/account; it validates promoId syntax but did not compare promoId. An original master or another transcode of an externally scheduled promo could therefore appear clear if its bytes differ. This change suppresses the same promo ID OR same bytes within the same exact destination. Other brands/accounts/networks remain distinct. New unrelated promo+bytes being clear is not authorization to publish.

Actual example: old Zaria promo5094636c-be48-4ac3-ae7b-80acfb729c13 private masterb2556477e31d69c7797829a74fa0bfa553327d4672a0a582fabd7306ab282475 produced external verticaldc3317c20da4378aa290e7c4dc40ceac617a0267bc11db0444b153399edfb951 in saved post428080195. Both were independently hashed locally. This is not new content or a new send request.

The SQL receipts table retains promoId in evidence JSON, not a standalone column. Preserve all22 original rows and original hash/time collision checks. Add evidence->>'promoId'=d.id::text within the exact destination predicate. Existing source identity check binds snapshot promoId to d.id.

## Upgrade scope

The original store proposal and pinned initial installer remain unchanged historical baselines. Existing installed instances require the separate cafe-metricool-external-identity-repair.sql; fresh installs require that same post-install step before activation. No claim that editing a proposal upgrades production. The complete repair requires PG17 and the actual non-superuser postgres source with exactly the existing ADMIN-only cafe_metricool_owner bootstrap from supabase_admin. It temporarily self-grants only SET (ADMIN false, INHERIT false), runs the body correction under the restricted owner, resets the source role and revokes precisely that self-issued edge in the same transaction. Full membership, role, defaultACL, schema/table ACL and RLS snapshots must match afterward. No public CREATE or runtime authority is granted. It verifies exact original body MD5fc45ae0745fcfada4b9c884c3cc7933a, owner-only ACL,22valid evidence promo identities; replaces only the predicate; checks resulting bodyMD5b851290417cceb49a25ab085e75f4765, unchanged function metadata/ACL, rows and role/defaultACL state. Unknown baseline fails and transaction rolls back. Replay intentionally fails, not silently re-applied.

Future scoped dispatch capability must pin the repaired private authorized body. Do not apply the old-body capability proposal. Actual live repair and future runtime grants remain separately reviewed actions.

## Validation

40 local TypeScript/Node regression tests passed. Disposable PostgreSQL follow-on fixture runs after existing production-like installer fixture and checks repair rollback, injected abort, wrong execution role, replay, identity/hash suppression, cross-destination independence, unrelated records, and no claim/attempt on hold. Python compilation passed; actual PG17 execution awaits CI. Synthetic fixture rows never become live evidence. No live changes by this work.
