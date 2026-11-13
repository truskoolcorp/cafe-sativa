# Persistence review contract

Proposal SQL is deliberately outside automatic migrations. Default function/table access is revoked from PUBLIC and common application roles. No worker role or approval is provisioned. Review least-privilege deployment grants and role membership separately.

Trusted server approvals bind exact slots/digests; independent provider/month budgets enforce cumulative reservation under locks. Expiry and UTC period are rechecked after lock waits. Claims and uncertain submissions are never reclaimed or refunded automatically. Full original slot and provider binding are immutable. Provider task uniqueness and output hash/byte compare-and-swap reject reinterpretation.

QA ingestion must require exact current approved slot equality with the job snapshot, a server-enrolled target, an unapproved matching draft and exact prepared timestamp/destination. Receipts cannot themselves approve publication. Production draft trigger compatibility is checked only with synthetic dependent tables, not a complete production schema clone.

The disposable PostgreSQL harness includes sequential ACL/budget/transition tests and actual concurrent lock-wait scenarios. A mock or single-user run does not prove concurrency. Consult the exact commit's CI result before claiming concurrent tests passed.
