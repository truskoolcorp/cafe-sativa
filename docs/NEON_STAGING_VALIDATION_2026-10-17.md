# Café Sativa isolated Neon staging — verified 2026-10-17

## Isolated resources (not production)

- Neon organization `org-holy-hall-91382416`, dedicated project `cafe-sativa-staging` (`twilight-dream-09426151`), region `aws-us-east-2`, PostgreSQL 17.
- Branch `staging` (`br-long-forest-b5wk52ne`), database `cafe_sativa_stage`; 0.25 CU with five-minute idle suspension.
- Recovery branch `recovery-validation-20261017` (`br-plain-bread-b5fpue7q`) copied from staging at parent LSN `0/197A700`.
- Live Supabase remains `nwfxvhqbjtfvoopcadff`. No Vercel routing or write-path change, customer-data copy, Stripe transaction or external post.

## Read-only production schema evidence

- `cs_ticket_reservations`: primary id; unique Stripe session and payment-intent IDs; positive amount; finite `held`/`fulfilled`/`payment_attention` states; foreign keys to event, ticket and profile.
- `tickets`: unique `(event_id,user_id)` and redemption code.
- `orders`: unique Stripe checkout session and payment intent.
- `cs_social_deliveries`: unique provider UUID and content item; constrained ledger states `queued`, `submitting`, `scheduled`, `submission_unknown`, `blocked`, `canceled`. `published` is not a valid state.
- Supabase-managed `auth.users`, RLS, custom enums, RPC functions, grants, storage and auth token verification are dependencies; no claim of full schema portability or app runtime parity.

## Validation harness (synthetic, not the live application)

Created separate `cs_validation` schema inside Neon staging, with:
- `payment_receipts`: unique Stripe session, intent, reservation, and event/user, positive amount, state constraint.
- `social_receipts`: unique provider UUID and content item, matching allowed state constraint.
- Inserted synthetic receipt with session `cs_test_session_1` and amount 1500 cents; replayed same session with a new row using `ON CONFLICT DO NOTHING`. Result: **one stored receipt**, distinct sessions = 1, stored test total = 1500 cents.
- Created separate recovery branch and read both branches. Each held one synthetic receipt and 1500 cents, confirming branch creation copied the staging test snapshot.

**Limits of this evidence:** These are representative constraint tests, not tests against production `cs_record_ticket_payment` or `cs_record_gallery_payment` RPCs. Branch copy is not a Supabase backup or automatic database failover. No full production schema or customer records have been transferred. No refund, webhook race, RLS/auth compatibility, application read/write or failback test has passed.

## Next gated work

1. Generate an authorized **schema-only** export of the complete live PostgreSQL database including types, extensions, defaults, triggers, policies, service-only RPCs and role dependencies. Review auth/storage handling and portability; migrate schema to a fresh isolated Neon branch using direct connections and versioned migrations. Protect production.
2. Reproduce all payment RPCs in a dedicated test namespace with fabricated event/customer/reservation objects; exercise concurrent duplicate webhooks, interrupts, refunds, and inventory fences; verify rights and service-only execution.
3. Audit RLS, Supabase-issued token verification, profile relations, storage/media references and the website's current Supabase SDK dependencies; separate durable Postgres data migration from managed Auth/Storage.
4. Perform controlled **synthetic** mutation and recovery on a new branch, record replication checkpoint, consistency, RPO/RTO, rollback/failback, and costs. Do not assert Neon-primary / Supabase-backup is implemented.
5. Require owner approval and a tested rollback before production routing, CDC, client credential or authorization changes. Preserve exactly-one writer and do not duplicate external side effects.

Cost: the staging project and recovery branch may accrue Neon compute/storage usage subject to account pricing. Confirm actual billing; they are configured for minimum 0.25 CU and five-minute idle suspension, not guaranteed zero cost.

## Update — completed isolated public-schema reconstruction and execution

The earlier baseline above describes the *first* synthetic harness. Subsequent work expanded the same dedicated `staging` database `cafe_sativa_stage` (`twilight-dream-09426151`, branch `br-long-forest-b5wk52ne`) from an empty application database to a **schema-only reconstructed copy of all production application objects in `public`**. Production Supabase `nwfxvhqbjtfvoopcadff` was queried only for catalog metadata, SQL definitions and counts. No production rows, password material, OAuth credentials, personal records or Stripe credentials were copied.

| Object inventory | Production `public` | Isolated Neon staging |
|---|---:|---:|
| Base application tables | 28 | 28 |
| Custom enum types | 12 | 12 |
| Constraints (including 9 auth.users FKs) | 112 | 112 |
| Indexes | 94 | 94 |
| Source functions | 12 | 12 |
| Triggers | 10 | 10 |
| Row-level security policies | 35 | 35 |
| Views | 3 | 3 |
| Column defaults | 106 | 106 |

**Scope and security caveats:** Matching object counts and compiled definitions are *not* complete functional/security equivalence. Neon staging uses a clearly artificial `auth.users` table (with synthetic fixture identities), non-login `anon`, `authenticated`, and `service_role` roles, and test-only `auth.uid()`/`auth.role()` helpers sourced from session settings, not actual Supabase Auth or verified JWTs. These substitutes are not safe to deploy to production. No Supabase-managed Auth, Storage, Vault, `pg_net`, or authentication/session-service records have been migrated. The original passport welcome-email function and trigger definitions exist in staging, but the **welcome-email trigger is DISABLED** to prohibit accidental external messages. External provider tool credentials/URLs were not configured for staging execution. Public schema/table access and public function execution were revoked from PUBLIC, except minimal role grants needed to test RLS. The current production views were inspected as `security_invoker=true`.

The source `tickets.redemption_code` default (6 cryptographic bytes encoded as hex) was initially missing in the generated table skeleton, exposed by a failed test, and corrected before rerunning. Source catalog comparison subsequently confirmed all 106 defaults present. This catch is evidence that the validation exposed a real migration-compatibility issue.

### Actual production-function execution with synthetic staging fixtures

- `cs_record_ticket_payment`: first valid, fabricated receipt returned `created: true` and a valid ticket; exact replay returned `created: false` and the same ticket ID. Result: 1 valid ticket, 1 fulfilled reservation for that fixture.
- Concurrent replay: two overlapping calls for another synthetic held reservation produced exactly one `created: true` and one `created: false`, with the **same ticket ID**; count remained 1 for the event/user. This validates locking/idempotency on an isolated database for that scenario, not every webhook race.
- Negative ticket test: wrong payment amount was rejected with `Receipt mismatch` and did not change the prior fulfilled reservation/ticket count.
- `cs_record_gallery_payment`: first fabricated paid receipt created one order and reduced stock from 5 to 4; exact replay returned `created: false` with the same order ID and stock remained 4.
- RLS identity check using the explicitly fake staging `authenticated` role and `auth.uid()`: simulated owner saw 1 permitted profile, unmatched synthetic identity saw 0. This tests policy expression behavior only; JWT authenticity and privilege boundaries remain separate gates.

No real payment, email, social publication, Stripe API or Supabase production mutation occurred.

### Recovery and branch isolation

A new post-reconstruction Neon branch `schema-complete-recovery-20261017` (`br-shy-wildflower-b5ueoeyl`) was created from staging at parent LSN `0/1CAE0A0`. Source and recovery-branch readbacks both returned: **28 tables, 112 constraints, 35 policies, 2 synthetic tickets, 1 synthetic gallery order, and stock 4**. An earlier recovery test changed a synthetic inventory count in staging while its already-created recovery branch retained the original value, then restored staging, validating branch copy-on-write isolation. This is an intra-Neon snapshot/recovery test, **not** a demonstration of Supabase-backup replication, cross-provider failover, realistic RPO/RTO or failback.

### Remaining gates before production migration

1. Produce a reviewed, repeatable and approved database migration artifact and replay it into a **new empty database**. A proposed bulk schema-export upload to GitHub was blocked by safety checks; no unreviewed full executable dump was committed. Staging currently has the reconstructed objects, and the source definitions remain in Supabase's verified catalog.
2. Replace all test Auth shims with a secure application architecture: keep Supabase Auth (or move identity only with independent approval), validate JWTs cryptographically server-side, implement roles/permissions without forged session claims, and verify all endpoint and storage references.
3. Run gallery refund / chargeback / oversell/stock and capacity races, webhook interruption and recovery paths against isolated copies and confirm external idempotency. CI/mock tests alone are not sufficient for live certification.
4. Design and test **Neon primary to Supabase backup** data movement, including initial snapshot, CDC/lag, conflict fencing, failback and backup restoration; at most one writer and no repeated external side effects. Verify provider feature limits, pricing, and whether the proposed automatic failover is supportable.
5. Keep Supabase as sole production source and leave Vercel connection/auth configuration unchanged until migration is reviewed, production backup is verified, a maintenance/write-fencing plan and rollback are approved, and release gates pass.

Cost controls: The dedicated Neon project uses 0.25 CU and five-minute idle suspension, but additional recovery branches can accrue storage/compute costs. Review and retire obsolete validation branches *with owner approval* after preserving the needed baseline.
