# Concrete Café read-only source loader

No route, approvals, grants, plan edits, provider creation, scheduling or activation. `createCafeSourceReader` is a lazy server composition using existing backend credentials without reading/copying them into source. It exposes only `diagnose` and `load`.

- Exact plan and draft `select('*')`; complete QA history sorted by UUID, maximum256rows, source JSON256KiB. Database response streaming capped512KiB before SDK JSON allocation. Retry explicitly off.
- Wrong Tru Skool/personal destination and incomplete nine-check QA stop before private media or provider session use. `diagnose` never reports full readiness without external checks.
- Separate private Storage streaming adapter verifies private bucket, bounded35MiB MP4 and exact hash/path. Never returns a signed URL.
- Existing live GLYPH normalization requires actual canonical rights/voice proof. Existing authorized Metricool session lists brands read-only; the new loader independently requires Café7605217, exact Facebook105363501666032 / Instagramcafesativainc, user4174093 and America/Chicago. The existing connection-owner and token constraints are not relaxed; missing/stale stored session blocks.
- Server-owned platform metadata must match plan ID, promo, current video hash, caption, exact scheduled time and network. No default hashtags/title/collaborators are guessed. The full schedule is validated against the separate verified collaborator list.
- Full source rows are reread after external proof and compared. Raw timestamp spelling is preserved for SQL source-state CAS; only schedule timestamp is normalized losslessly to UTC milliseconds. Microsecond schedule values are held, not silently rounded.
- Server composition imposes a55second abort scope. Optional abort propagation added to existing Metricool transport without changing its default behavior or allowed operations; still no refresh/retry.

## Actual blockers as of the parent read-only inventory

Seven stored plans are on old personal/Tru Skool destinations, not Café. Current observed QA contains three categories, not all nine. This loader will truthfully hold them. It does not widen those plans or fabricate the missing six checks. Correct new Café plans, real current-video QA/approvals, server editorial metadata and collaborator evidence must exist before load succeeds. Known external scheduling receipts continue to suppress duplicate dispatch downstream.

The authority writer dependency remains dormant PR104. This branch changes its schedule-time comparison only to lossless normalization, so raw full rows remain suitable for SQL CAS. Legacy v1 source mapping and approval behavior are unchanged.
