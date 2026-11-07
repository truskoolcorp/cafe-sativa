# Private monthly catalog suggestions

The existing authenticated content cron now calls `planPrivateProgramming` before its other content stages. It uses the current `America/Chicago` month, from the shared content policy date helper, and the same deterministic inventory logic as the admin recommendation endpoint. No cron schedule or permissions change is needed.

## Scope and safeguards

- Read only the existing THE Verse Alkemist release inventory, ordered by release title and ID. The selection is deterministic, not a streaming or engagement analysis. Empty or unusable inventory creates nothing.
- Insert at most one inventory-keyed private music draft per month. A proposal has a proposed month, never an invented performance date or time.
- At preflight read time, automatic runs skip any existing music proposal for that month, including rejected proposals. They also preserve an inventory proposal with that permanent month key if the owner has moved or reclassified it. A rejection in a different month is not a permanent catalog-source ban. Reads and inserts are not a serializable transaction: a newly inserted, owner-created rejected proposal arriving after the preflight read does not occupy the active-month index and can coexist with that run’s new draft. Existing rows are never reopened or modified; strict exclusion of that concurrent edge would require a separate database change.
- Never update, upsert, approve, reopen, or delete a proposal. The permanent `proposal_key` unique constraint and existing active-music/month unique index arbitrate concurrent inserts. A unique conflict is reported as existing only after reading the winning proposal; unverified conflicts fail visibly.
- Source evidence retains catalog/streaming verification status. Inventory presence is not verification of releases, rights, mastered assets, artist commitments, or performance readiness.
- The private planner has no public event, payment, rendering, publishing, or messaging operation. Other existing content cron stages, including the previously guarded site publisher, retain their own behavior and permissions.

The authenticated same-origin manual endpoint keeps its selected-month behavior: an active music proposal blocks another, a rejected owner-created concept can be followed by an explicit manual inventory suggestion, and a permanent inventory-month key cannot be recreated after rejection. Admin copy explains this difference.

## Results and failures

Cron success includes `privateProgramming.status` (`created`, `existing`, or `empty_catalog`), the proposed month, and a summary for an existing/created private proposal. An independent private-planning failure does not block the existing media/site pipeline. When those stages finish, cron returns HTTP 503 with `partialFailure: true`, the private-planning stage/detail, and completed content results. If an existing stage also fails, its stage and the private-planning result are both retained. Other cron failures return HTTP 503 with the failed `stage` and `completedStages`. A later stage failure does not roll back an earlier draft; retrying will preserve it. Provider error messages and credentials are not returned.

This is not a transaction across cron stages. A backend timeout after insertion can have an uncertain outcome; inspect/retry through the idempotent planner rather than assuming no write occurred. Database constraints must already exist from `20261020130000_private_programming_proposals.sql`.

## Offline checks

- `node --test tests/private-programming.test.cjs`
- `node tests/content-planning.cjs`
- `node --test tests/*.test.cjs`
- `npx tsc --noEmit --incremental false`

Tests execute the real helper, manual endpoint, and cron route with a stateful offline database double, both uniqueness rules, and blocked network/unexpected dependencies. They cover empty inventory, actual source evidence, all existing statuses, owner edits, repeat/concurrent runs, conflict verification, Chicago month boundaries, backend failures, authorization, and separation from publishing/rendering/event writes. No production cron or production write is used for validation.
