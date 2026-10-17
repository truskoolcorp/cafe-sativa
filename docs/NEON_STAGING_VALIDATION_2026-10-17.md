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
