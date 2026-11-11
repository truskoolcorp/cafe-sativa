# Reconstructed candidate review

This candidate is not byte-identical to the earlier unavailable artifact. Historical test counts do not certify it. The same 35-file, disabled, no-deployment scope is retained; canonical-audio enhancements are excluded.

Required acceptance checks: focused strict TypeScript; synthetic provider/canonical/engine/storage/QA tests; actual PostgreSQL proposal/ACL/draft-trigger tests; multi-session lock-wait tests in isolated CI; independent review of the final files. No full application build, live provider generation or production rollout is claimed.

Open production gates: exact provider/voice/look mappings, creation and pending codecs, current canonical transport, trusted immutable approval enrollment, approved budgets/cadence, private storage ACLs, least-privilege worker access, scheduler wiring and separately authorized publishing destinations. In particular, canonical ElevenLabs IDs must not be assumed equivalent to HeyGen voice IDs.

## Fresh independent reconstruction checks

The current reconstruction passed **112 synthetic JavaScript tests** with the repository-compatible Storage SDK 2.104.0 supplied, plus focused strict TypeScript checking of all eight production modules. These are newly run results, not inherited from the unavailable artifact. Reviewed fresh PostgreSQL 17.11 stand-alone logs report passing ledger, QA and draft-guard tests. The new multi-session harness remains unexecuted locally and must pass isolated CI; serial tests do not prove concurrent lock behavior.

Independent review found and fixed three regressions before sign-off:

- The engine now snapshots its durable claim before asynchronous final validation, preserving the original token for receipt and unknown-outcome updates.
- Canonical validation snapshots both authorization reads so mutation of a reused response object cannot conceal a changed authorization epoch.
- Provider dispatch now rechecks monotonic timeout, wall-clock expiry/rollback and abort state inside the queued action immediately before calling the transport. A caller blocking the event loop cannot cause an expired queued paid request to start.

Regression tests exercise both claim persistence outcomes, reused authorization mutation, queued expiry, monotonic overrun and clock rollback. No additional blocker was found for the disabled draft-PR scope. The feature is not approved for live activation, paid generation, migration application, permission changes or publication.

Synthetic CI has read-only repository permissions, no application/provider secrets and an ephemeral PostgreSQL service. Vercel suppression is limited to the exact proposed branch, without a main or wildcard override. Publish only the explicit reviewed 35-file list; exclude generated evidence, caches, private inventory and unchanged upstream dependencies.

## Fresh verification of reconstructed candidate

- 112 synthetic tests pass with repository-compatible Storage SDK 2.104.0.
- Focused strict TypeScript passes.
- Fresh PostgreSQL 17.11 stand-alone ledger, QA bridge and captured draft-trigger suites pass.
- Python syntax and workflow permissions/timeouts validated.
- Concurrent PostgreSQL harness is prepared but has not run locally; the exact commit's isolated CI must verify it.

Independent review found and corrected mutable claim/auth snapshot races and a queued provider-call deadline race. Regression tests cover those fixes. No production files, credentials or private inventory are included. This remains a draft, not a live engine or publishing acceptance.
