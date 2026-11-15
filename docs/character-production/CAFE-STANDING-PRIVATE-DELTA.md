# Private expected-catalog derivation

`scripts/derive-cafe-standing-expected.py` creates a **candidate overlay**, not proof
that the production schema was replayed. It has no database connector and performs
no SQL, installation, provider request, grant, activation or publishing.

Inputs: separately reviewed SHA-256-bound live-before, disposable-before and
disposable-after manifests. The latter two must be actual captures of the exact
reviewed contracts in an isolated PostgreSQL17 rehearsal. Unit-test placeholders
are not valid operational evidence. The helper verifies delta structure and access
shape, not the authenticity of a supplied manifest or approval of its contents.
Independent review must establish the fixture provenance and exact new definitions.

Only five new table/index trees and ten named contract functions may be added.
New function ACLs exclude runtime roles; only the generation projection includes
the new café-owner EXECUTE grant. Existing catalog entries cannot be removed or
changed except the exact `authorized(uuid,text)` definition conjunct. Both fixture
and live old authority bodies must match the known repaired MD5 pin; each keeps its
original owner and ACL. Existing six/four runtime grants, memberships, unrelated
objects and schema permissions are copied unchanged. Duplicate identities,
preexisting target objects, missing targets, other changes or grants fail closed.

Outputs must be outside the repository and use mode 0600. The console reports only
a SHA-256, change counts and `private_candidate_overlay_not_live_replay`; it does not
print private definitions. Do not commit, upload or publish live manifests.

This does **not** assert that other live function bodies, source tables, extensions,
data rows or effective policy behavior were executed in the disposable cluster.
A generated candidate can feed the rollback-only installer guard for further
review, but cannot replace actual schema rehearsal, required access approval or a
production application decision. The installer still rejects any exact catalog
mismatch. No commit mode is introduced.

Six provider-free unit tests exercise unchanged extra live entries, rejection of
runtime grants, repaired authority pin, unrelated changes, existing targets and
duplicate identities. Real isolated capture derivation must be reported separately.

## Genuine disposable-server evidence export

After all wrapper tests succeed, the PG17 fixture exports only the target-delta
projections: before rows actually changed/removed and after rows changed/added.
It asserts `derive(fullBefore, projectedBefore, projectedAfter) == fullAfter` first.
No identity is fabricated for this export. Logs tagged
`CAFE_STANDING_SYNTHETIC_MANIFEST_V1` contain base64 chunks, per-projection SHA-256,
chunk count, exact source-file hashes and `synthetic=true`, `projection=true`.
Validate all chunks, checksums and source pins before using the private helper.
These projections omit unchanged synthetic catalog rows and contain no live data.
This proves target-delta reconstruction against the disposable server, not execution
of unrelated live source definitions or a replay of the whole production schema.
