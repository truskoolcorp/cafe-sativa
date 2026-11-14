# Dormant Café authority writer tranche

This isolated helper is not mounted, granted, or activated. It does not create QA, change legacy v1, schedule, or publish. `enabled` defaults false. Synthetic tests exercise the existing-owner-permission path and negative fences.

## Distinct authorities

- Technical evidence: nine attributed passing observations for exact current MP4 hash, including third-party watermark; actual bounded private bytes, fresh canonical rights/voice and exact provider destination.
- Publication permission: separately verified owner-authored authorization covering the **complete platform-specific schedule digest**, including caption, hashtags, Facebook title or verified per-character Instagram collaborators and exact date. QA and connection access cannot supply it.
- Acting identity: authenticated server content admin. Recording a verified earlier owner decision does not imply the owner personally inspected media or clicked a new button.

A server-only `ownerAuthority` resolver must recover and validate the original permission, returning an opaque provenance reference, exact digest, permission timestamp and finite expiry. This tranche deliberately contains no fabricated live permissions or hardcoded approval from the truncated conversation. Scope translation must be reviewed against the actual messages before loading any registry. If a prior permission covers the exact content and chosen schedule, no new owner click is needed. If not, the helper holds.

## Exact persistence proposal (implemented offline, not installed)

`createCafeApprovalPersistence` calls the proposed `cs_record_cafe_metricool_authority` once, without retries. The SQL uses one READ COMMITTED transaction: lock parent draft, lock existing approval if present, recheck authenticated admin through the reviewed fixed boolean helper, reject any existing Café attempt, compare full `cafe_metricool_private.source_state(plan)` to passed sourceState, verify finite expiry and timestamp bounds, insert approval plus an immutable provenance record. Invoke existing `cafe_metricool_private.authorized` after insertion; failure must rollback the entire insert. Read back exact digest/expiry before returning. Unknown writes must be reconciled, not retried. The source guard and existing reservation uniqueness must remain untouched.

The proposal adds a separate owner-only provenance table referencing approval plan_id (reference, authorization timestamp, scope digest and expiry), rather than disguising a reference inside source_state or changing the complete schedule format. No grants to anon/authenticated; any backend RPC permission requires separate exact-signature review. Atomic correctness still requires the new actual PostgreSQL17 fixture to pass in CI; passing mock tests alone is insufficient.

## Required integration before activation

1. Fresh actual main baseline: PR101's local source has legacy eight-QA helper; this code deliberately does not call it or alter legacy behavior.
2. Bounded server loader returning complete SQL rows (including every column and ALL QA sorted by UUID), actual private MP4 bytes, fresh current canonical evidence and provider account mapping. Never accept these from client JSON.
3. Reviewed owner authorization resolver and per-character collaborator evidence allowlist. Verify current external receipts before writing; already externally scheduled media remains held.
4. Run the transaction/provenance proposal through real PG17 CI. The exact installer helper is `public.cs_cafe_metricool_is_admin(uuid)`, postgres-owned with EXECUTE for the dedicated owner. The proposal does not install or broaden that helper. Installation under the dedicated owner needs separately reviewed temporary CREATE authority with its restoration.
5. Admin-only same-origin bounded HTTP wrapper if a UI is needed; requests carry plan ID and expected digest only. No actor, timestamp, snapshot, QA or private signed URL accepted/returned. Prefer server continuation for previously authorized items, rather than unnecessary repetitive owner clicks.
6. Existing final-authorizer rechecks remain mandatory at dispatch. All platform plans must be authored before any claim, as the store freezes the parent's sources after the first attempt.

Approval lifetime is capped to the earliest of owner scope expiry, schedule minus60seconds and24hours from recording. Current canon/account proof expires after60seconds. The content evidence digest excludes the refreshed canonical observation time but includes canonical revision/rights and all stored source evidence. Actual SQL CAS remains the decisive defense against changes during network validation.

## Standing-policy resolver

`createCafeOwnerPolicyResolver` permits routine Café persona brand promotions on the two exact Café destinations under a verified standing owner policy. It does not demand per-caption owner approval. It requires an independent trusted semantic scope assessment bound to the exact digest, excluding paid promotion, high-impact communications and sensitive personal data. This assessment is not a new owner click or publication authorization. Uncertain classification holds rather than broadens permission. The provenance reference hashes the complete recovered policy and assessment. Their bounded canonical JSON is carried into the SAME approval transaction and stored alongside provenance. SQL independently checks its hash, schedule binding and scope exclusions. Both records roll back together; there is no separate evidence-archive RPC or grant.

Root identified relevant owner message references for recovery: recurring requests `Sentinel_11ae8ded0bf48191be467b319f2a8633`, `Sentinel_dc0a9f24e700819187b49add9a2520c6`; avoid unnecessary safeguards `Sentinel_8cd3a852db648191a5ef677c6ffb30d3`; watermark prohibition `Sentinel_5b05a26197508191a88fdbe30cec429a`; specific eight-preview approval excluding Keith Building `Sentinel_6b516f1624b4819189df506e2f67f217`; Zaria exact approval `Sentinel_674253e2c98c8191bdfe85de68dbb52d`. These are source references to verify, **not instantiated live policy data**. No inferred timestamp, owner identity or exact approved character list is inserted here. The old shared `approved-promos.json` contains scripts and obsolete watermarked file paths, not sufficient authorization provenance.
