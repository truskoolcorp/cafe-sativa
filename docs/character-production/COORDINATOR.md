# Exact-slot queue coordinator (disabled integration proposal)

The coordinator closes the **library-level orchestration gap**, not production
activation. It is not imported by any live route, and changes no cron, environment,
credential, grant, database or storage configuration.

## What it does

1. Collect at most five original provider tasks into private pending-QA storage.
2. Stop new spending if any collection is held/uncertain.
3. Read at most 25 explicitly enabled, pre-authorized scheduled slots.
4. Validate bound slot digests, provider/model, exact expiry and duplicate keys.
5. Process due slots in deterministic timestamp/key order; submit at most five
   (recommended one) per invocation through the existing durable engine.
6. Stop on held/unknown submission, expiry, period rollover or elapsed tick budget.

No scripts, approvals, future slots or calendar dates are synthesized. A recurring
cadence requires the owner-policy layer to authorize **each exact slot** in advance.
The worker cannot auto-retry failed, unknown or already-claimed slots. The proposed
read queue excludes every existing job state, including pending QA. Cross-process
idempotency remains the engine's durable unique-key claim, not the in-process busy
flag. Private output still needs separate media QA and release approval.

`notAfter` must equal the slot's authorization expiry so engine revalidation also
enforces expiry if provider/canonical checks take time. Disabling a schedule stops
future queue selection, not already-read work; immediate cancellation must revoke
the exact slot authorization, which the engine rechecks before provider submission.

`maxTickMs` is checked **between awaited operations**, not an interrupt guarantee.
Each deployment adapter must bound provider/storage/DB operations independently.
The coordinator never races a timeout against a paid write and then retries it.

## Still required before real recurring production

- Review/apply the existing production-store SQL and this separate queue proposal
  with dedicated owner versus worker roles. The proposals grant nothing.
- Create and verify the private production bucket and narrowly scoped ACLs.
- Supply observed provider receipt/status codecs and approved live avatar/voice/
  portrait mappings; no guessed provider HTTP contract is added here.
- Wire the current canonical source, normalization and exact spending authority.
- Populate bounded exact slots, budgets and schedules from real owner approval,
  using new keys for revisions rather than reclaiming old jobs.
- Add an authenticated server-only scheduler route with explicit deployment scope,
  a deployment-appropriate duration budget and observable run receipts.
- Verify private output playback and QA handoff, then independently activate
  distribution only after its separate account/caption/media approvals.

Do not describe this change, an empty queue, or a passing synthetic test as a live
video, successful automation run, or published social post.

## Validation

`node --test tests/character-production-*.test.mjs`

`node node_modules/typescript/bin/tsc --strict --noEmit --skipLibCheck --allowImportingTsExtensions --target ES2022 --module nodenext --moduleResolution nodenext --typeRoots node_modules/@types lib/content/character-production-*.ts`

The queue SQL is a review proposal, not an applied migration. Its server behavior
must be tested against the isolated PostgreSQL foundation before activation.
