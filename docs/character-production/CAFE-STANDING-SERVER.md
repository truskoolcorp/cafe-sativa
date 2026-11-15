# Dormant standing-authority server composition

`createCafeStandingServer` connects the existing genuine source/media/QA/account reader, the separately budgeted semantic review, and only `cs_record_enrolled_cafe_authority`. It creates no route, scheduler, credentials, policy, budget, grants or provider request by construction. `record` defaults to disabled; enabling the argument is a trusted server decision, not a query parameter or request-body option. No endpoint is added by this change.

Trusted configuration contains frozen editorial metadata and verified collaborator mappings, a cancellation signal, a separately reviewed scoped RPC client and semantic spending lease. The existing source reader still resolves actual live source bytes/QA/canon/account mapping; metadata is not substituted for evidence. The composition does not accept a caller's assessment or actor. Only the genuine semantic-review issuance passes through the enrolled writer's validation. The existing database guard rechecks current policy/enrollment/revocation on recording and dispatch.

One composition instance consumes at most one attempt, with no retry after failure or uncertain completion. Durable inference and publication uniqueness are still enforced in SQL across process instances. All capability RPCs use `retry(false)` and abort propagation. An unconfirmed write stays unconfirmed; recorded authority is neither a scheduled nor published post. Actual dispatch and receipt reconciliation remain separate.

## Access and expense boundary

No grant is installed by importing or creating this composition. A future production use needs exactly reviewed execution of the enrolled-authority wrapper and semantic reservation/receipt wrappers, plus the proposed narrow cross-owner generation-membership bridge. Existing owner-only raw authority writer must stay owner-only. Existing scheduler/dispatch capabilities must remain unchanged. The installer evidence and role-path disclosure must cover inherited authenticator/Storage access before any new grant.

Semantic inference is Anthropic, not HeyGen. Keith's $20 monthly HeyGen cap does not authorize this spending. No default semantic allowance is supplied. An approved account, rate evidence, counting permission, verified token ceiling, finite expiry and conservative durable budget are required. No new Anthropic call, HeyGen generation or top-up is made by this patch.

## Verification

Provider-free unit tests cover default denial, missing capability/lease/expiry, pre-abort, frozen inputs, exact no-retry scoped RPC, one-shot concurrency, cancellation and uncertain-result preservation. These composition tests mock adapters; they do not establish production permission, eligible content, paid-provider success or end-to-end publishing. Full production TypeScript and the expanded existing Café regression suite are also checked. Live installation, finite enrollment, fresh content QA and a verified actual run remain outstanding.
