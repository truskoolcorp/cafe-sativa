# Dormant Dallas-month HeyGen budget guard

Owner authorization: `Sentinel_3acee78ce7e48191abcd48706735bd28`. Café character videos only; USD20 each Dallas calendar month, original35-cent canary included; existing API wallet only, no new subscription or automatic top-up. This proposal neither seeds policy/evidence nor changes a budget or enables production.

The existing slot+budget row locking and unique nonreclaimable job claim remain the reservation mechanism. A fixed provider calendar helper uses America/Chicago for HeyGen and UTC for other providers, including queue and NULL-receipt prewrite checks. No refunds or retries are introduced. Non-null actual receipt evidence remains retainable after expiry or revocation without granting more spending.

An owner policy pins the existing API account and an immutable verified snapshot pins photo Avatar IV pricing, dollar-wallet cents, existing-credit-only/no-auto-top-up and evidence digest. Wallet evidence expires within60seconds; rate evidence within24hours; future timestamps fail. Exact slot/digest evidence binding is mandatory. Conservative integer-duration quote is at least `ceil(rate_cents_per_minute * duration_seconds / 60)`. The snapshot lock serializes cross-month reservations. Available wallet headroom deducts every ledger reservation across all months, including completed and failed jobs, excluding only the same validated already-reserved job for its prewrite check. Double-counting uncertainty is intentional; it cannot create extra headroom. Completion is not proof of debit reflection. Without a separately reviewed immutable debit-reflection mechanism, historical reservations may conservatively stop work before the monthly ceiling. No reflection is inferred from provider task completion.

Provider/account settings still need independent confirmation. A snapshot cannot prevent unrelated external wallet spending; insufficient funds must hold, not top up. Evidence is explicitly USD api_wallet with an integer cents-per-minute rate. No premium-credit field is accepted. Backend/generator roles cannot write policy/evidence or execute private guard functions.

## Integration still pending

An audited same-server verifier must eventually refresh snapshots through narrowly scoped, account-bound authority, not manual approval per item or arbitrary generator evidence writes. That registration and finite planner are not included here. The TS runtime uses the same60second wallet/24hour rate limits. No evidence freshness assertion alone proves recurring production.

Existing November budget is40c with35reserved. A separate ROLLBACK-only template permits exact reviewed ceiling update to2000 while preserving original35, all job/slot history and expired original authority. No alternate budget key may omit the original35. A safe installer must preserve exact original RPC owners/ACLs and restore any temporary owner/DDL privileges; this source proposal is not that installer.

`validate_heygen_budget.py` supplies disposable PG17 contract tests: Dallas winter/summer/month/DST boundaries, other-provider UTC, stale/future/revoked wallet/rate, conservative quote, prewrite versus late evidence, concurrent cap claims, unknown/duplicate denial, original35 preservation and no runtime evidence grants. SQL generator pins the reviewed original three function sources. No tests call a provider.
